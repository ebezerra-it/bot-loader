/* eslint-disable camelcase */
import { DateTime } from 'luxon';
import Query from './query';
import BaseBot, { TUserType } from '../../bot/baseBot';
import { IAssetWeight } from './queryPlayers';
import { IContract } from './queryOptions';
import QueryFRP0, { TContractType } from './queryFRP0';
import ReportLoaderCalendar, { TCountryCode } from '../reportLoaderCalendar';

enum TAssetType {
  FUTURE = 'FUTURE',
  SPOT = 'SPOT',
}

interface ILevel {
  level: number;
  volume: number;
}

interface IVpoc {
  vwap: ILevel;
  volumePercentage: number;
  vpoc: ILevel;
  high: number;
  low: number;
}

interface IDolVpoc {
  dateFrom: DateTime;
  dateTo: DateTime;
  assets: IAssetWeight[];
  vpocs: IVpoc[];
  vwap: ILevel;
}

export default class QueryDOLVpoc extends Query {
  public async process(params: {
    dateRef: DateTime;
    daysSampleSize: number;
    vpocSampleSize: number;
    clusterSize: number;
    rolling: boolean;
    frp0: boolean;
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    const msgHeader = `DOL VPOC - DateRef: ${params.dateRef.toFormat(
      'dd/MM/yyyy',
    )}  - Sample days: ${params.daysSampleSize}\n`;

    const resDolVpoc: IDolVpoc | undefined = await this.getDolVpocs(
      params.dateRef,
      params.daysSampleSize,
      params.vpocSampleSize,
      params.clusterSize,
      params.rolling,
      params.frp0,
    );

    let botResponse;
    if (resDolVpoc) botResponse = BaseBot.printJSON(resDolVpoc);
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

    return !!resDolVpoc;
  }

  public async calculate(
    dateRef: DateTime,
    daysSampleSize: number,
    vpocSampleSize: number,
    clusterSize: number,
    rolling = true,
    frp0 = true,
  ): Promise<IDolVpoc | undefined> {
    /*     const dateTo = dateRef;
    const dateFrom = await ReportLoaderCalendar.subTradeDays(
      this.bot.queryFactory,
      dateTo,
      daysSampleSize,
      TCountryCode.BR,
    );

    const contracts: IContract[] = [];
    const contractFrom = await QueryFRP0.getContractCode(
      this.bot.queryFactory,
      dateFrom,
      TContractType.CURRENT,
    );
    contracts.push(contractFrom);

    if (
      dateTo.startOf('day').toMillis() >
      contractFrom.lastTradeDate.startOf('day').toMillis()
    ) {
      const contractTo = await QueryFRP0.getContractCode(
        this.bot.queryFactory,
        dateTo,
        TContractType.CURRENT,
      );
      if (contractTo.code !== contractFrom.code) contracts.push(contractTo);
    }

    const assets: IAssetWeight[] = [];

    contracts.forEach(contract => {
      assets.push({ asset: `DOL${contract.code}`, weight: 1 });
      assets.push({ asset: `WDO${contract.code}`, weight: 0.2 });
    });
    if (assets.length === 0) return undefined; */

    return this.getDolVpocs(
      dateRef,
      daysSampleSize,
      vpocSampleSize,
      clusterSize,
      rolling,
      frp0,
    );
  }

  public async getDolVpocs(
    /* assets: IAssetWeight[],
    dateFrom: DateTime,
    dateTo: DateTime, */
    dateRef: DateTime,
    daysSampleSize: number,
    vpocSampleSize: number,
    clusterSize: number,
    rolling = true,
    frp0 = true,
  ): Promise<IDolVpoc | undefined> {
    const dateTo = dateRef;
    const dateFrom = await ReportLoaderCalendar.subTradeDays(
      this.bot.queryFactory,
      dateTo,
      daysSampleSize,
      TCountryCode.BR,
    );

    const contracts: IContract[] = [];
    let contract: IContract;
    contract = await QueryFRP0.getContractCode(
      this.bot.queryFactory,
      dateFrom,
      TContractType.CURRENT,
    );
    contracts.push(contract);

    contract = await QueryFRP0.getContractCode(
      this.bot.queryFactory,
      dateFrom,
      TContractType.NEXT,
    );
    contracts.push(contract);

    contract = await QueryFRP0.getContractCode(
      this.bot.queryFactory,
      dateTo,
      TContractType.CURRENT,
    );
    if (!contracts.find(c => c.code === contract.code))
      contracts.push(contract);

    contract = await QueryFRP0.getContractCode(
      this.bot.queryFactory,
      dateTo,
      TContractType.NEXT,
    );
    if (!contracts.find(c => c.code === contract.code))
      contracts.push(contract);

    const assets: IAssetWeight[] = [];
    contracts.forEach(c => {
      assets.push({ asset: `DOL${c.code}`, weight: 1 });
      assets.push({ asset: `WDO${c.code}`, weight: 0.2 });
    });

    let sql = `select level, sum(tt.volume) volume from 
      (select coalesce(q1.level, q2.level) level, coalesce(q1.volume*0.2, 0) + coalesce(q2.volume, 0) volume  from
      (select t.level, sum(t.volume) as volume from 
              (select (jsonb_array_elements("volume-profile"::JSONB)->>'level')::numeric as level, (jsonb_array_elements("volume-profile"::JSONB)->>'volume')::numeric as volume, (jsonb_array_elements("volume-profile"::JSONB)->>'quantity')::numeric as quantity from "b3-ts-summary" where asset = any($1) and "timestamp-open"::DATE>=$3 and "timestamp-open"::DATE<$4) t
              group by t.level) q1
      full outer join 
      (select t.level, sum(t.volume) as volume from 
              (select (jsonb_array_elements("volume-profile"::JSONB)->>'level')::numeric as level, (jsonb_array_elements("volume-profile"::JSONB)->>'volume')::numeric as volume, (jsonb_array_elements("volume-profile"::JSONB)->>'quantity')::numeric as quantity from "b3-ts-summary" where asset = any($2) and "timestamp-open"::DATE>=$3 and "timestamp-open"::DATE<$4) t
              group by t.level) q2
      on (q1.level = q2.level)`;

    if (rolling) {
      sql += ` union all 
          select TRUNC(level) + CEIL(MOD(level, 1.0) / 0.5) * 0.5 level, sum(size)*0.2 volume from "b3-rollingtrades" where "asset-code" || "contract-to" = any($1) and "trade-timestamp"::DATE>=$3 and "trade-timestamp"::DATE<$4 group by level
          union all
          select TRUNC(level) + CEIL(MOD(level, 1.0) / 0.5) * 0.5 level, sum(size) volume from "b3-rollingtrades" where "asset-code" || "contract-to" = any($2) and "trade-timestamp"::DATE>=$3 and "trade-timestamp"::DATE<$4 group by level`;
    }
    if (frp0) {
      sql += ` union all
          select TRUNC(level) + FLOOR(MOD(level, 1.0) / 0.5) * 0.5 level, volume from 
          (select pbrl_ptax_sell*1000+ts.vwap level, ts."volume-size" volume from "bcb-ptax" tp inner join "b3-summary" ts on tp."date" = ts."date" where ts.asset = 'FRP0' and ts."date" >= $3 and ts."date" < $4) q`;
    }
    sql += `) tt group by level order by level asc`;

    const qDolVpoc = await this.bot.queryFactory.runQuery(sql, {
      assetsDOL: assets
        .filter(a => a.asset.substr(0, 3) === 'DOL')
        .map(a => a.asset),
      assetsWDO: assets
        .filter(a => a.asset.substr(0, 3) === 'WDO')
        .map(a => a.asset),
      dateFrom: dateFrom.toJSDate(),
      dateTo: dateTo.toJSDate(),
    });

    if (!qDolVpoc || qDolVpoc.length === 0) return undefined;

    const totalVolume = qDolVpoc
      .map((vpoc: any) => Number(vpoc.volume))
      .reduce((acc: number, curr: number) => {
        return acc + curr;
      });

    let vpocs: IVpoc[] = [];

    const iClusterSize =
      clusterSize > qDolVpoc.length ? qDolVpoc.length : clusterSize;

    const iIterations =
      iClusterSize === qDolVpoc.length ? 1 : qDolVpoc.length - iClusterSize;

    for (let i = 0; i < iIterations; i++) {
      let sumLevelVol = 0;
      let sumVol = 0;
      let vpoc: ILevel = { level: 0, volume: 0 };
      for (let j = i; j < i + iClusterSize; j++) {
        if (Number(qDolVpoc[j].volume) > vpoc.volume)
          vpoc = {
            level: Number(qDolVpoc[j].level),
            volume: Number(qDolVpoc[j].volume),
          };
        sumLevelVol += Number(qDolVpoc[j].level) * Number(qDolVpoc[j].volume);
        sumVol += Number(qDolVpoc[j].volume);
      }
      vpocs.push({
        high: Number(qDolVpoc[i + iClusterSize - 1].level),
        vwap: {
          level: +Number(sumLevelVol / sumVol).toFixed(2),
          volume: +Number(sumVol).toFixed(2),
        },
        vpoc,
        low: Number(qDolVpoc[i].level),
        volumePercentage: +Number((sumVol / totalVolume) * 100).toFixed(2),
      });
    }

    // sort by vpoc volume descending
    vpocs.sort((a, b) => {
      return b.vwap.volume - a.vwap.volume;
    });

    // remove samples in same cluster
    let end = false;
    let i = 0;
    while (!end) {
      for (let j = i + 1; j < vpocs.length; j++) {
        if (
          Math.abs(vpocs[i].vwap.level - vpocs[j].vwap.level) < iClusterSize
        ) {
          vpocs.splice(j, 1);
          j--;
        }
      }
      if (++i > vpocs.length - 1) end = true;
    }

    vpocs = vpocs.slice(0, vpocSampleSize);

    // calculate vpocs vwap
    let sumLevelVol = 0;
    let sumVol = 0;
    vpocs.forEach((vpoc: { vwap: ILevel; vpoc: ILevel }) => {
      sumLevelVol += Number(vpoc.vwap.level) * Number(vpoc.vwap.volume);
      sumVol += Number(vpoc.vwap.volume);
    });

    return {
      assets,
      dateFrom,
      dateTo,
      vwap: { level: +Number(sumLevelVol / sumVol).toFixed(2), volume: sumVol },
      vpocs,
    };
  }
}
export { IDolVpoc, TAssetType };
