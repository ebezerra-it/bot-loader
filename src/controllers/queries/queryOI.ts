/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
/* eslint-disable no-return-assign */
import { DateTime } from 'luxon';
import Query from './query';
import { IAssetWeight } from './queryPlayers';
import BaseBot, { TUserType } from '../../bot/baseBot';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { TCountryCode } from '../tcountry';

enum TOIPoint {
  ROLL = 'ROLL',
  FRP0 = 'FRP0',
  FRP1 = 'FRP1',
  VWAPDATE = 'VWAPDATE',
  VWAP = 'VWAP',
}

interface IOIPoint {
  type: TOIPoint;
  level: number;
  volume: number;
  highSD: number;
  lowSD: number;
}

interface IOIDate {
  date: DateTime;
  openInterest: number;
  points: IOIPoint[];
  vwap: IOIPoint | undefined;
}

interface IUpdatedOIDate {
  date: IOIDate;
  updatedOIPoint: IOIPoint | undefined;
}

interface IOIDateRange {
  assets: IAssetWeight[];
  contract: string;
  dateFrom: DateTime;
  dateTo: DateTime;
  OIDates: IUpdatedOIDate[];
}

class QueryOI extends Query {
  public async process(params: {
    contract: string;
    assets: IAssetWeight[];
    dateFrom?: DateTime;
    dateTo?: DateTime;
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    const dateTo = params.dateTo ? params.dateTo : DateTime.now();
    const { resOI, firstDate, lastDate } = await this.calculate(
      params.contract,
      params.assets,
      dateTo,
      params.dateFrom,
    );

    let botResponse: any;
    if (resOI)
      botResponse = BaseBot.printJSON(resOI.OIDates[resOI.OIDates.length - 1]);
    else botResponse = 'Not enought data.';

    const msgHeader = `OI - Date From: ${
      firstDate ? firstDate.toFormat('dd/MM/yyyy') : 'First contract date'
    } - To: ${
      lastDate ? lastDate.toFormat('dd/MM/yyyy') : 'Last contract date'
    } - Assets: ${params.assets.map(a => a.asset).join(', ')}\n`;

    if (!params.chatId) {
      this.bot.sendMessageToUsers(
        TUserType.DEFAULT,
        botResponse,
        undefined,
        false,
        msgHeader,
      );
    } else {
      this.bot.sendMessage(`${msgHeader}${botResponse}`, {
        chatId: params.chatId,
        replyToMessageId: params.messageId ? params.messageId : undefined,
      });

      if (resOI) {
        const filename = `OI_${params.assets.map(a => a.asset).join('_')}_${
          params.contract
        }_${DateTime.now().toFormat('yyyyMMddHHmmss')}.txt`;
        const stream = Buffer.from(BaseBot.printJSON(resOI), 'utf-8');
        await this.bot.sendDocument(stream, {
          chatId: params.chatId,
          replyToMessageId: params.messageId,
          extraOptions: {
            caption: msgHeader,
            filename,
          },
        });
      }
    }
    return !!resOI;
  }

  public async calculate(
    contract: string,
    assets: IAssetWeight[],
    dateTo: DateTime,
    dateFrom?: DateTime,
  ): Promise<{
    resOI: IOIDateRange | undefined;
    firstDate: DateTime | undefined;
    lastDate: DateTime | undefined;
  }> {
    const qOIFirstDate = await this.queryFactory.runQuery(
      `SELECT MIN(date)::DATE AS firstdate, MAX(date)::DATE AS lastdate 
          FROM "b3-summary" 
          WHERE "asset-code" = ANY($1) AND contract=$2 AND "asset-type"='FUTURES' AND
          COALESCE("oi-close", 0) - COALESCE("oi-open", 0) <> 0`,
      {
        assets: assets.map(a => a.asset),
        contract,
      },
    );

    if (!qOIFirstDate || qOIFirstDate.length === 0)
      return {
        resOI: undefined,
        firstDate: dateFrom,
        lastDate: dateTo,
      };
    let firstDate: DateTime;
    if (dateFrom)
      firstDate =
        dateFrom.startOf('day').toMillis() <
        DateTime.fromJSDate(qOIFirstDate[0].firstdate).startOf('day').toMillis()
          ? DateTime.fromJSDate(qOIFirstDate[0].firstdate)
          : dateFrom;
    else firstDate = DateTime.fromJSDate(qOIFirstDate[0].firstdate);

    let lastDate: DateTime;
    if (dateTo)
      lastDate =
        DateTime.fromJSDate(qOIFirstDate[0].lastdate)
          .startOf('day')
          .toMillis() < dateTo.startOf('day').toMillis()
          ? DateTime.fromJSDate(qOIFirstDate[0].lastdate)
          : dateTo;
    else lastDate = DateTime.fromJSDate(qOIFirstDate[0].lastdate);

    const resOI: IOIDateRange | undefined = await this.getOIDateRange(
      contract,
      assets,
      firstDate,
      lastDate,
    );

    return {
      resOI,
      firstDate,
      lastDate,
    };
  }

  private async getUpdatedOIPoint(
    oiDates: IOIDate[],
  ): Promise<IUpdatedOIDate[]> {
    const updatedOIPoints: IUpdatedOIDate[] = [];
    updatedOIPoints.push({
      date: oiDates[0],
      updatedOIPoint: {
        type: TOIPoint.VWAP,
        volume: oiDates[0].openInterest,
        highSD: oiDates[0].vwap!.highSD,
        level: oiDates[0].vwap!.level,
        lowSD: oiDates[0].vwap!.lowSD,
      },
    });

    for (let i = 1; i < oiDates.length; i++) {
      const updatedOIPoint: IOIPoint = this.calculateVWAP([
        /* updatedOIPoints.find(u =>
            isSameDay(u.date.date, oiDates[i - 1].date),
          )!.updatedOIPoint!, */
        // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
        updatedOIPoints[updatedOIPoints.length - 1].updatedOIPoint!,
        {
          type: TOIPoint.VWAP,
          volume: oiDates[i].openInterest,
          highSD: oiDates[i].vwap!.highSD,
          level: oiDates[i].vwap!.level,
          lowSD: oiDates[i].vwap!.lowSD,
        },
      ])!;

      updatedOIPoints.push({
        date: oiDates[i],
        updatedOIPoint,
      });
    }

    return updatedOIPoints;
  }

  private async getOIDateRange(
    contract: string,
    assets: IAssetWeight[],
    dateFrom: DateTime,
    dateTo: DateTime,
  ): Promise<IOIDateRange | undefined> {
    if (
      !dateFrom ||
      !dateTo ||
      !dateFrom.isValid ||
      !dateTo.isValid ||
      assets.length === 0 ||
      contract === ''
    )
      return undefined;

    const oiDates: IOIDate[] = [];
    let date = dateFrom;

    while (date.startOf('day').toMillis() <= dateTo.startOf('day').toMillis()) {
      const oiDate: IOIDate | undefined = await this.getOIDate(
        contract,
        assets,
        date,
      );
      if (oiDate) oiDates.push(oiDate);
      date = await ReportLoaderCalendar.addTradeDays(
        this.queryFactory,
        date,
        1,
        TCountryCode.BR,
      );
    }

    if (oiDates.length === 0) return undefined;

    return {
      assets,
      contract,
      dateFrom,
      dateTo,
      OIDates: await this.getUpdatedOIPoint(oiDates),
    };
  }

  private async getOIDate(
    contract: string,
    assets: IAssetWeight[],
    dateRef: DateTime,
  ): Promise<IOIDate | undefined> {
    const oiPoints: IOIPoint[] = await this.getPoints(
      contract,
      assets,
      dateRef,
    );

    const vwapDate: IOIPoint = oiPoints.find(
      p => p.type === TOIPoint.VWAPDATE,
    )!;

    const oiDate = vwapDate.volume;
    const adjOiDateVolume =
      vwapDate.volume -
      oiPoints.reduce(
        (accumulator, p) =>
          p.type !== 'VWAPDATE' ? (accumulator += p.volume) : accumulator,
        0,
      );
    vwapDate.volume = adjOiDateVolume;

    return {
      date: dateRef,
      openInterest: oiDate,
      points: oiPoints,
      vwap: this.calculateVWAP(oiPoints),
    };
  }

  private async getPoints(
    contract: string,
    assets: IAssetWeight[],
    dateRef: DateTime,
  ): Promise<IOIPoint[]> {
    const points: IOIPoint[] = [];
    let point: IOIPoint | undefined;

    // Rolling
    point = await this.getRollPoint(contract, assets, dateRef);
    if (point) points.push(point);

    if (assets.find(a => a.asset === 'DOL')) {
      // Check if date is in FRP0 range for contract
      const { firstFPR0Date, lastFPR0Date, firstFPR1Date, lastFPR1Date } =
        await this.getContractDates(contract);
      if (
        dateRef.startOf('day').toMillis() >=
          firstFPR0Date.startOf('day').toMillis() &&
        dateRef.startOf('day').toMillis() <=
          lastFPR0Date.startOf('day').toMillis()
      ) {
        point = await this.getFRP0Point(dateRef);
        if (point) points.push(point);
      }
      // Check if date is in FRP1 range for contract
      if (
        dateRef.startOf('day').toMillis() >=
          firstFPR1Date.startOf('day').toMillis() &&
        dateRef.startOf('day').toMillis() <=
          lastFPR1Date.startOf('day').toMillis()
      ) {
        point = await this.getFRP1Point(dateRef);
        if (point) points.push(point);
      }
    }

    // OI DATE
    points.push(await this.getOIPoint(contract, assets, dateRef));

    return points;
  }

  private async getRollPoint(
    contract: string,
    assets: IAssetWeight[],
    dateRef: DateTime,
  ): Promise<IOIPoint | undefined> {
    let qRoll;

    if (
      dateRef.startOf('day').toMillis() ===
      DateTime.now().startOf('day').toMillis()
    ) {
      const aSQL: string[] = [];
      assets.forEach(a => {
        // TO DO: Implementar consulta para leitura de produtos de rolagem em b3-assetsquotes,
        // calculando o preço de rolagem
        aSQL.push(
          `SELECT vwap as level, sum(volume*${a.weight}) as volume 
          FROM "b3-assetsquotes" WHERE
          asset='${a.asset}${contract}' AND "datetime"::DATE=$1::DATE 
          ORDER BY "datetime" DESC LIMIT 1`,
        );
      });
      const sql = `select coalesce(sum(level*volume)/sum(volume), 0) as vwap, 
      coalesce(sum(volume), 0) as volume from 
      (${aSQL.join(' union all ')}) q`;
      qRoll = await this.queryFactory.runQuery(sql, {
        date: dateRef.toJSDate(),
      });
    } else {
      const aSQL: string[] = [];
      assets.forEach(a => {
        aSQL.push(
          `select level as level, size*${a.weight} as volume 
          from "b3-rollingtrades" 
          where "asset-code" = '${a.asset}' and 
          "trade-timestamp"::DATE = $1 and "contract-to" = $2`,
        );
      });
      const sql = `select coalesce(sum(level*volume)/sum(volume), 0) as vwap, 
      coalesce(sum(volume), 0) as volume from 
      (${aSQL.join(' union all ')}) q`;
      qRoll = await this.queryFactory.runQuery(sql, {
        date: dateRef.toJSDate(),
        contract,
      });
    }

    if (qRoll && qRoll.length > 0 && Number(qRoll[0].vwap) > 0) {
      return {
        type: TOIPoint.ROLL,
        volume: Number(qRoll[0].volume),
        highSD: Number(qRoll[0].vwap),
        level: Number(qRoll[0].vwap),
        lowSD: Number(qRoll[0].vwap),
      };
    }

    return undefined;
  }

  private async getFRP0Point(dateRef: DateTime): Promise<IOIPoint | undefined> {
    let sql: string;

    if (
      dateRef.startOf('day').toMillis() ===
      DateTime.now().startOf('day').toMillis()
    ) {
      sql = `SELECT (CASE WHEN coalesce(q.ptax, 0) <> 0 THEN q.ptax ELSE q.avgptax END) ptax + f.frp0 as frp0price, 
        f.volume as volume
        FROM (SELECT (MAX(price) + MIN(price))/2 AS frp0, SUM(quantity) AS volume 
        FROM "intraday-trades" WHERE "ts-trade"::DATE = $1::DATE AND asset='FRP0') f,
        (SELECT (p.p1 + p.p2 + p.p3 + p.p4)/(p.avgp1 + p.avgp2 + p.avgp3 + p.avgp4) AS avgptax, ptax 
        FROM (SELECT "bcb-ptax".date::DATE AS date, 
        "bcb-ptax"."pbrl_p1_sell" * 1000 AS p1, (CASE WHEN coalesce(pbrl_p1_sell, 0) <> 0 THEN 1 ELSE 0 END) avgp1,  
        "bcb-ptax"."pbrl_p2_sell" * 1000 AS p2, (CASE WHEN coalesce(pbrl_p2_sell, 0) <> 0 THEN 1 ELSE 0 END) avgp2,  
        "bcb-ptax"."pbrl_p3_sell" * 1000 AS p3, (CASE WHEN coalesce(pbrl_p3_sell, 0) <> 0 THEN 1 ELSE 0 END) avgp3,
        "bcb-ptax"."pbrl_p4_sell" * 1000 AS p4, (CASE WHEN coalesce(pbrl_p4_sell, 0) <> 0 THEN 1 ELSE 0 END) avgp4,
        "bcb-ptax"."pbrl_ptax_sell" * 1000 AS ptax 
        FROM "bcb-ptax" WHERE "bcb-ptax"."currency-code"='USD' AND 
        "bcb-ptax"."date"::DATE=$1) p) q`;
    } else {
      sql = `SELECT p.ptax + f.frp0 AS frp0price, f.volume FROM 
        (SELECT (MAX(high) + MIN(low))/2 AS frp0, SUM(volume) AS volume 
        FROM "b3-ts-summary" 
        WHERE "timestamp-open"::DATE = $1::DATE AND asset='FRP0') f,
        (SELECT "pbrl_ptax_sell" * 1000 AS ptax FROM "bcb-ptax" 
        WHERE date::DATE=$1 AND "currency-code"='USD') p`;
    }

    const qFRP0 = await this.queryFactory.runQuery(sql, {
      date: dateRef.toJSDate(),
    });

    if (qFRP0 && qFRP0.length > 0)
      return {
        type: TOIPoint.FRP0,
        volume: Number(qFRP0[0].volume),
        highSD: Number(qFRP0[0].frp0price),
        level: Number(qFRP0[0].frp0price),
        lowSD: Number(qFRP0[0].frp0price),
      };

    return undefined;
  }

  private async getFRP1Point(dateRef: DateTime): Promise<IOIPoint | undefined> {
    /* const sql = `SELECT p.ptax + f.frp1 AS frp1price, f.volume FROM 
        (SELECT (MAX(high) + MIN(low))/2 AS frp1, SUM(volume) AS volume 
        FROM "b3-ts-summary" 
        WHERE "timestamp-open"::DATE = $1::DATE AND asset = 'FRP1') f,
        (SELECT "pbrl_ptax_sell" * 1000 AS ptax FROM "bcb-ptax" 
        WHERE date::DATE = $2::DATE AND "currency-code" = 'USD') p`; */
    const sql = `SELECT p.ptax + f.frp1 AS frp1price, f.volume FROM 
        (SELECT (high + low)/2 AS frp1, "volume-size" AS volume 
        FROM "b3-summary" 
        WHERE date = $1::DATE AND asset = 'FRP1') f,
        (SELECT "pbrl_ptax_sell" * 1000 AS ptax FROM "bcb-ptax" 
        WHERE date::DATE = $2::DATE AND "currency-code" = 'USD') p`;

    const dtFRP1 = await ReportLoaderCalendar.subTradeDays(
      this.queryFactory,
      dateRef.minus({ months: 1 }),
      1,
      TCountryCode.BR,
    );
    const qFRP1 = await this.queryFactory.runQuery(sql, {
      dtFRP1: dtFRP1.toJSDate(),
      dtPTAX: dateRef,
    });

    if (qFRP1 && qFRP1.length > 0)
      return {
        type: TOIPoint.FRP1,
        volume: Number(qFRP1[0].volume),
        highSD: Number(qFRP1[0].frp1price),
        level: Number(qFRP1[0].frp1price),
        lowSD: Number(qFRP1[0].frp1price),
      };

    return undefined;
  }

  private async getOIPoint(
    contract: string,
    assets: IAssetWeight[],
    dateRef: DateTime,
  ): Promise<IOIPoint> {
    const aMount: number[][] = [];
    const aUnmount: number[][] = [];
    for await (const a of assets) {
      const qAsset = await this.queryFactory.runQuery(
        `SELECT COALESCE("vwap", 0) as vwap, 
        COALESCE("settle", 0) as settle,
        (COALESCE("oi-close", 0) - COALESCE("oi-open", 0))*${
          a.weight
        } as volume, 
        (COALESCE("high", 0) - COALESCE("low", 0))*${Number(
          process.env.BOT_QUERY_OI_HIGH_LOW_TO_SDEV_MULTIPLIER || '0.225',
        )} as sigma
        FROM "b3-summary" 
        WHERE date::DATE=$1::DATE AND asset=$2`,
        {
          date: dateRef.toJSDate(),
          asset: `${a.asset}${contract}`,
        },
      );

      if (qAsset && qAsset.length > 0) {
        if (Number(qAsset[0].volume) > 0)
          aMount.push([
            Number(qAsset[0].vwap) === 0
              ? Number(qAsset[0].settle)
              : Number(qAsset[0].vwap),
            Number(qAsset[0].volume),
            Number(qAsset[0].sigma),
          ]);
        else if (Number(qAsset[0].volume) < 0)
          aUnmount.push([
            Number(qAsset[0].vwap) === 0
              ? Number(qAsset[0].settle)
              : Number(qAsset[0].vwap),
            Math.abs(Number(qAsset[0].volume)),
            Number(qAsset[0].sigma),
          ]);
      }
    }

    const sql = `SELECT (sdcomb).mean as vwap, (sdcomb).qtty as volume, (sdcomb).sd as sigma FROM 
    (SELECT stddev_combine(volume, vwap, sigma) as sdcomb FROM 
    (SELECT (data)[1] as vwap, (data)[2] as volume, (data)[3] as sigma FROM
    (SELECT unnest_multidim($1::decimal[][]) as data) q1) q2) q3`;

    let qMount: any;
    let qUnmount: any;

    const aPoints: IOIPoint[] = [];
    if (aMount.length > 0) {
      qMount = await this.queryFactory.runQuery(sql, { data: aMount });
      if (!!qMount && qMount.length > 0 && Number(qMount[0].vwap) > 0)
        aPoints.push({
          type: TOIPoint.VWAPDATE,
          volume: Number(qMount[0].volume),
          highSD: Number(qMount[0].vwap) + Number(qMount[0].sigma),
          level: Number(qMount[0].vwap),
          lowSD: Number(qMount[0].vwap) - Number(qMount[0].sigma),
        });
    }

    if (aUnmount.length > 0)
      qUnmount = await this.queryFactory.runQuery(sql, { data: aUnmount });
    if (!!qUnmount && qUnmount.length > 0 && Number(qUnmount[0].vwap) > 0)
      aPoints.push({
        type: TOIPoint.VWAPDATE,
        volume: -Number(qUnmount[0].volume),
        highSD: Number(qUnmount[0].vwap) + Number(qUnmount[0].sigma),
        level: Number(qUnmount[0].vwap),
        lowSD: Number(qUnmount[0].vwap) - Number(qUnmount[0].sigma),
      });

    if (aMount.length === 0 && aUnmount.length === 0)
      return {
        type: TOIPoint.VWAPDATE,
        volume: 0,
        highSD: 0,
        level: 0,
        lowSD: 0,
      };

    return this.calculateVWAP(aPoints, TOIPoint.VWAPDATE)!;
  }

  private calculateVWAP(
    points: IOIPoint[],
    type = TOIPoint.VWAP,
  ): IOIPoint | undefined {
    if (points.length === 0) return undefined;

    const sumVolume = points.reduce(
      (accumulator, p) => (accumulator += p.volume),
      0,
    );
    const sumLevelVol = points.reduce(
      (accumulator, p) => (accumulator += p.volume * p.level),
      0,
    );
    const sumHighSDVol = points.reduce(
      (accumulator, p) => (accumulator += p.volume * p.highSD),
      0,
    );
    const sumLowSDVol = points.reduce(
      (accumulator, p) => (accumulator += p.volume * p.lowSD),
      0,
    );

    if (sumVolume === 0)
      return {
        type,
        volume: 0,
        highSD: 0,
        level: 0,
        lowSD: 0,
      };

    return {
      type,
      volume: sumVolume,
      highSD:
        (sumHighSDVol > sumLowSDVol ? sumHighSDVol : sumLowSDVol) / sumVolume,
      level: sumLevelVol / sumVolume,
      lowSD:
        (sumHighSDVol < sumLowSDVol ? sumHighSDVol : sumLowSDVol) / sumVolume,
    };
  }

  private async getContractDates(contract: string): Promise<{
    expireDate: DateTime;
    firstFPR0Date: DateTime;
    lastFPR0Date: DateTime;
    firstFPR1Date: DateTime;
    lastFPR1Date: DateTime;
  }> {
    const regEx = new RegExp(/^([FGHJKMNQUVXZ])([0-9]{1,2})$/g);
    const match = regEx.exec(contract);
    if (!match || match.length === 0)
      throw new Error(`Unknown contract code: ${contract}`);

    const code = match[1];
    const year = match[2];

    const contracts = [
      { code: 'F', month: 1 },
      { code: 'G', month: 2 },
      { code: 'H', month: 4 },
      { code: 'J', month: 4 },
      { code: 'K', month: 5 },
      { code: 'M', month: 6 },
      { code: 'N', month: 7 },
      { code: 'Q', month: 8 },
      { code: 'U', month: 9 },
      { code: 'V', month: 10 },
      { code: 'X', month: 11 },
      { code: 'Z', month: 12 },
    ];

    const d1 = DateTime.fromFormat(
      `01/${String(contracts.find(c => c.code === code)?.month).padStart(
        2,
        '0',
      )}/${year}`,
      'dd/MM/yy',
    );

    const expireDate = (await ReportLoaderCalendar.isTradeDay(
      this.queryFactory,
      d1,
      TCountryCode.BR,
    ))
      ? d1
      : await ReportLoaderCalendar.addTradeDays(
          this.queryFactory,
          d1,
          1,
          TCountryCode.BR,
        );
    const firstFPR0Date = await ReportLoaderCalendar.subTradeDays(
      this.queryFactory,
      d1.minus({ months: 1 }),
      2,
      TCountryCode.BR,
    );
    const lastFPR0Date = await ReportLoaderCalendar.subTradeDays(
      this.queryFactory,
      d1,
      3,
      TCountryCode.BR,
    );
    const firstFPR1Date = await ReportLoaderCalendar.subTradeDays(
      this.queryFactory,
      firstFPR0Date,
      1,
      TCountryCode.BR,
    );
    const lastFPR1Date = await ReportLoaderCalendar.subTradeDays(
      this.queryFactory,
      lastFPR0Date,
      1,
      TCountryCode.BR,
    );

    return {
      expireDate,
      firstFPR0Date,
      lastFPR0Date,
      firstFPR1Date,
      lastFPR1Date,
    };
  }
}

export default QueryOI;
export { IOIDateRange };
