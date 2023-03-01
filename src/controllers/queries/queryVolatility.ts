/* eslint-disable camelcase */
import { DateTime, Duration } from 'luxon';
import Query from './query';
import BaseBot, { TUserType } from '../../bot/baseBot';
import { IAssetWeight } from './queryPlayers';
import { QueryOptions, IContract } from './queryOptions';
import { TContractType } from './queryFRP0';

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
    const dateTo = params.dateRef;
    const dateFrom = dateTo.minus(params.sampleSize);
    const msgHeader = `VOLATILITY Assets: ${params.assets
      .map(a => a.asset)
      .join(', ')}  - DateFrom: ${dateFrom.toFormat(
      'dd/MM/yyyy',
    )}  - DateTo: ${dateTo.toFormat('dd/MM/yyyy')}\n`;

    let resAssetsVol: IAssetVolatility | undefined;

    if (params.assetType === TAssetType.FUTURE) {
      resAssetsVol = await this.getVolatility(params.assets, dateFrom, dateTo);
    }

    let botResponse;
    if (resAssetsVol) botResponse = BaseBot.printJSON(resAssetsVol);
    else botResponse = 'Not enought data.';

    if (!params.chatId) {
      this.bot.sendMessageToUsers(
        TUserType.DEFAULT,
        `${msgHeader}${botResponse}`,
        undefined,
        false,
        msgHeader,
      );
    } else {
      this.bot.sendMessage(`${msgHeader}${botResponse}`, {
        chatId: params.chatId,
        replyToMessageId: params.messageId ? params.messageId : undefined,
      });
    }

    return !!resAssetsVol;
  }

  public async getVolatility(
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
      TContractType.CURRENT,
    );
    if (contract) contracts.push(contract);
    contract = await QueryOptions.getContractCode(
      this.queryFactory,
      contract.lastTradeDate.plus({ months: 1 }),
      TContractType.CURRENT,
    );

    while (contract.lastTradeDate.toMillis() < dateTo.toMillis()) {
      contracts.push(contract);
      contract = await QueryOptions.getContractCode(
        this.queryFactory,
        contract.lastTradeDate.plus({ months: 1 }),
        TContractType.CURRENT,
      );
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
        WHERE asset = ANY('{${assets
          .map(a => `${a.asset}${c.code}`)
          .join(',')}}') 
        AND "timestamp-open"::DATE >= '${c.dateBeginVigency.toSQL()}' AND 
        "timestamp-open"::DATE <= '${c.lastTradeDate.toSQL()}' 
        GROUP BY "timestamp-open"::DATE ORDER BY "timestamp-open"::DATE`,
      ),
    );

    const sql = `SELECT 
    AVG(var) mean, 
    STDDEV_SAMP(var) sd, 
    percentile_disc(0.5) within group (order by var) median 

    FROM (${sqlContracts.join(' UNION ')}) q`;

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
