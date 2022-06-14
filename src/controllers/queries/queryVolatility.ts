/* eslint-disable camelcase */
import { DateTime, Duration } from 'luxon';
import Query from './query';
import TelegramBot, { TUserType } from '../../bot/telegramBot';
import { IAssetWeight } from './queryPlayers';
import { QueryOptions, IContract, TContract } from './queryOptions';

enum TAssetType {
  FUTURE = 'FUTURE',
  SPOT = 'SPOT',
}

interface IVolatility {
  mean: number;
  sd: number;
  median: number;
  mode: number;
  skewness: number; // -1 TO +1 (0 = symmetric)
}

interface IAssetVolatility {
  assets: IAssetWeight[];
  dateFrom: DateTime;
  dateTo: DateTime;
  contracts?: IContract[] | undefined;
  volatility: IVolatility;
  studies: any[];
}

export default class QueryVolatility extends Query {
  public async process(params: {
    dateRef: DateTime;
    sampleSize: Duration;
    assetType: TAssetType;
    assets: IAssetWeight[];
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    const msgHeader = `VOLATILITY Assets: ${params.assets
      .map(a => a.asset)
      .join(', ')}  - Date: ${params.dateRef.toFormat('dd/MM/yyyy')}\n`;

    const dateTo = params.dateRef.plus(params.sampleSize);

    let resAssetsVol: IAssetVolatility | undefined;

    if (params.assetType === TAssetType.FUTURE) {
      resAssetsVol = await this.getVolatility(
        params.assets,
        params.dateRef,
        dateTo,
      );
    }

    if (!resAssetsVol) {
      return false;
    }

    if (!params.chatId) {
      this.bot.sendMessageToUsers(
        TUserType.DEFAULT,
        TelegramBot.printJSON(resAssetsVol),
        {},
        false,
        msgHeader,
      );
    } else {
      this.bot.sendMessage(
        params.chatId,
        `${msgHeader}${TelegramBot.printJSON(resAssetsVol)}`,
        params.messageId
          ? { reply_to_message_id: params.messageId }
          : undefined,
      );
    }

    return !!resAssetsVol;
  }

  private async getVolatility(
    assets: IAssetWeight[],
    dateFrom: DateTime,
    dateTo: DateTime,
  ): Promise<IAssetVolatility | undefined> {
    const resVol = await this.getAssetVolatilityFutures(
      assets,
      dateFrom,
      dateTo,
    );
    if (!resVol) return undefined;

    const studies: any[] = [];
    studies.push(await this.volatilityStudyND(resVol.volatility));

    return {
      assets,
      dateFrom,
      dateTo,
      ...resVol,
      studies,
    };
  }

  private async getAssetVolatilityFutures(
    assets: IAssetWeight[],
    dateFrom: DateTime,
    dateTo: DateTime,
  ): Promise<{ contracts: IContract[]; volatility: IVolatility } | undefined> {
    const contracts: IContract[] = [];

    let contract: IContract = await QueryOptions.getContractCode(
      this.queryFactory,
      dateFrom,
      TContract.CURRENT,
    );

    contracts.push(contract);

    while (contract.lastTradeDate.toMillis() < dateTo.toMillis()) {
      contract = await QueryOptions.getContractCode(
        this.queryFactory,
        contract.dateBeginVigency.plus({ months: 1 }),
        TContract.CURRENT,
      );
      contracts.push(contract);
    }

    const sqlContracts: string[] = [];

    if (contracts.length === 0) return undefined;

    contracts.forEach(c =>
      sqlContracts.push(
        `SELECT 
        "timestamp-open"::DATE date, 
        MAX(high) high, 
        MIN(low) low, 
        MAX(high) - MIN(low) var 
        
        FROM "b3-ts-summary" 
        WHERE asset = ANY('{${assets.map(a => `${a}${c.code}`).join(',')}}') 
        AND "timestamp-open"::DATE >= ${c.dateBeginVigency.toSQL} AND 
        "timestamp-open"::DATE <= ${c.lastTradeDate.toSQL} 
        GROUP BY "timestamp-open"::DATE ORDER BY "timestamp-open"::DATE`,
      ),
    );

    const sql = `SELECT 
    AVG(var) mean, 
    STDDEV_SAMP(var) sd, 
    percentile_disc(0.5) within group (order by var) median 

    FROM (${contracts.join(' UNION ')}) q`;

    const qAssetVol = await this.queryFactory.runQuery(sql, {});
    if (!qAssetVol || qAssetVol.length === 0) return undefined;

    const mode =
      qAssetVol[0].mean && qAssetVol[0].median
        ? 3 * Number(qAssetVol[0].median) - 2 * Number(qAssetVol[0].mean)
        : 0;
    return {
      contracts,
      volatility: {
        mean: qAssetVol[0].mean ? Number(qAssetVol[0].mean) : 0,
        median: qAssetVol[0].median ? Number(qAssetVol[0].median) : 0,
        mode,
        sd: qAssetVol[0].mean ? Number(qAssetVol[0].sd) : 0,
        skewness:
          qAssetVol[0].mean && qAssetVol[0].median && qAssetVol[0].sd
            ? (3 * (qAssetVol[0].mean - qAssetVol[0].median)) /
              Number(qAssetVol[0].sd)
            : 0,
      },
    };
  }

  private volatilityStudyND(volatility: IVolatility): any {
    return {
      mean: {
        upper_2_sd: volatility.mean + volatility.sd,
        upper_1_sd: volatility.mean + 2 * volatility.sd,
        central: volatility.mean,
        lower_1_sd: volatility.mean - volatility.sd,
        lower_2_sd: volatility.mean - 2 * volatility.sd,
      },
      mode: {
        upper_2_sd: volatility.mode + 2 * volatility.sd,
        upper_1_sd: volatility.mode + volatility.sd,
        central: volatility.mode,
        lower_1_sd: volatility.mode - volatility.sd,
        lower_2_sd: volatility.mode - 2 * volatility.sd,
      },
    };
  }
}
export { IAssetVolatility, TAssetType };
