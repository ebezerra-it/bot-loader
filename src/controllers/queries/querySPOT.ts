/* eslint-disable no-nested-ternary */
/* eslint-disable camelcase */
/* eslint-disable no-restricted-syntax */
import { DateTime } from 'luxon';
import TelegramBot, { TUserType } from '../../bot/telegramBot';
import Query from './query';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { TCountryCode } from '../tcountry';
import { QueryFactory } from '../../db/queryFactory';

interface IContract {
  code: string;
  firstTradeDate: DateTime | undefined;
  dateBeginVigency: DateTime;
  lastTradeDate: DateTime;
  dateExpiry: DateTime;
}

interface ISpotProjections {
  positive: number[];
  spot: number;
  frp0: number;
  frp0_multiplier: number;
  negative: number[];
}

/* interface IPoint {
  spot: number;
  projections: ISpotProjections | undefined;
} */

interface ISpot {
  date: DateTime;
  high: number;
  low: number;
  close: number;
  vwap: number;
  frp0: { today: number; calculated: number | undefined };
  volume: number;
}

interface ISpotSettleDate {
  priorDays: ISpot[];
  today: ISpot;
}

export default class QuerySPOT extends Query {
  public async process(
    params: {
      dateRef: DateTime;
      dateRefFRP: boolean;
      spotProjectionsQtty: number;
      spotProjectionsMultiplier: number;
      chatId?: number;
      messageId?: number;
    },
    today = false,
  ): Promise<boolean> {
    let spot: any;
    let msgHeader;
    if (today) {
      spot = await this.calculateSpotToday(params.dateRef);
      msgHeader = `SPOT TODAY USD - Date: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )}\n`;
    } else {
      spot = await this.calculateSpotForSettleDate(
        params.dateRef,
        params.dateRefFRP,
      );
      if (spot)
        spot.vwapProjectionsD1 = this.getSPOTProjections(
          spot.priorDays[1].vwap,
          spot.priorDays[1].frp0.today,
          params.spotProjectionsQtty,
          params.spotProjectionsMultiplier,
        );
      msgHeader = `SPOT SETTLE DATE USD - Date: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )}\n`;
    }

    let botResponse;
    if (spot) botResponse = TelegramBot.printJSON(spot);
    else botResponse = 'Not enought data.';

    if (!params.chatId) {
      this.bot.sendMessageToUsers(
        TUserType.DEFAULT,
        botResponse,
        {},
        false,
        msgHeader,
      );
    } else {
      this.bot.sendMessage(
        params.chatId,
        `${msgHeader}${botResponse}`,
        params.messageId
          ? { reply_to_message_id: params.messageId }
          : undefined,
      );
    }

    return !!spot;
  }

  public async calculateSpotToday(
    dateRef: DateTime,
  ): Promise<ISpot | undefined> {
    if (
      dateRef.startOf('day').toMillis() !==
      DateTime.now().startOf('day').toMillis()
    )
      return undefined;

    let qFRP0: any[];
    let frp0 = 0;
    qFRP0 = await this.queryFactory.runQuery(
      `SELECT (MAX(price) + MIN(price))/2 as frp0 
      FROM "intraday-trades" 
      WHERE "ts-trade"::DATE = $1::DATE AND asset='FRP0'`,
      { date: dateRef.toJSDate() },
    );
    if (!qFRP0 || qFRP0.length === 0) {
      // consider frp0 d0 = frp1 d-1
      qFRP0 = await this.queryFactory.runQuery(
        `SELECT q0.date, COALESCE(q0.pmo, 0) frp0, COALESCE(q1.pmo, 0) frp1 FROM 
        (SELECT "timestamp-open"::DATE date, MAX(high) h, MIN(low) l, (MAX(high) + MIN(low))/2 pmo FROM "b3-ts-summary" bts WHERE asset = 'FRP0' AND "timestamp-open"::DATE<$1::DATE GROUP BY "timestamp-open"::DATE order by "timestamp-open"::DATE desc limit 1) q0
        LEFT JOIN
        (SELECT "timestamp-open"::DATE date, MAX(high) h, MIN(low) l, (MAX(high) + MIN(low))/2 pmo FROM "b3-ts-summary" bts WHERE asset = 'FRP1' AND "timestamp-open"::DATE<$1::DATE GROUP BY "timestamp-open"::DATE order by "timestamp-open"::DATE desc limit 1) q1
        ON q0.date = q1.date`,
        { date: dateRef.toJSDate() },
      );
      if (qFRP0 && qFRP0.length > 0) frp0 = +Number(qFRP0[0].frp1).toFixed(2);
    } else frp0 = +Number(qFRP0[0].frp0).toFixed(2);

    const qSpot = await this.queryFactory.runQuery(
      `SELECT spot.tcam as tcam, spot.volume as volume, q.high, q.low
      FROM 
      (SELECT tcam, ROUND("total-finVol"/50000, 2) as volume from "b3-spotexchange-intraday" WHERE date::DATE=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) spot, 
      (select max(h) high, min(l) low from (
      select h, l from (select "time08-high" h, "time08-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time09-high" h, "time09-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union 
      select h, l from (select "time10-high" h, "time10-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time11-high" h, "time11-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time12-high" h, "time12-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time13-high" h, "time13-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time14-high" h, "time14-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time15-high" h, "time15-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time16-high" h, "time16-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time17-high" h, "time17-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time18-high" h, "time18-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time19-high" h, "time19-low" l  from  "b3-spotexchange-intraday" where date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q
      ) q) q`,
      {
        date: dateRef.toJSDate(),
      },
    );

    if (qSpot && qSpot.length > 0) {
      return {
        date: dateRef,
        high: +(Number(qSpot[0].high) * 1000).toFixed(2),
        vwap: +(Number(qSpot[0].tcam) * 1000).toFixed(2),
        low: +(Number(qSpot[0].low) * 1000).toFixed(2),
        close: +(Number(qSpot[0].close) * 1000).toFixed(2),
        frp0: {
          today: frp0,
          calculated: await QuerySPOT.calculateFRP0(this.queryFactory, dateRef),
        },
        volume: +Number(qSpot[0].volume).toFixed(),
      };
    }
    return undefined;
  }

  public async calculateSpotForSettleDate(
    dateRef: DateTime,
    dateRefFRP: boolean,
  ): Promise<ISpotSettleDate | undefined> {
    const qSpot = await this.queryFactory.runQuery(
      `(SELECT spot.date::DATE as date, spot."avgrate-d0-tcam" tcam, 
      ROUND(spot."hiringvol-d0-brlFinVol"/(spot."avgrate-d0-tcam"*50000),2) volume,
      "hiringrate-d0-low" low, "hiringrate-d0-high" high, "hiringrate-d0-close" close
      FROM "b3-spotexchange" spot
      WHERE spot."avgrate-d0-settledate"::DATE=$1 and date<>$1 ORDER BY "timestamp-load" DESC LIMIT 1)
      UNION
      (SELECT spot.date::DATE as date, spot."avgrate-d1-tcam" tcam, 
      ROUND(spot."hiringvol-d1-brlFinVol"/(spot."avgrate-d1-tcam"*50000),2) volume,
      "hiringrate-d1-low" low, "hiringrate-d1-high" high, "hiringrate-d1-close" close
      FROM "b3-spotexchange" spot
      WHERE spot."avgrate-d1-settledate"::DATE=$1 ORDER BY "timestamp-load" DESC LIMIT 1)
      UNION
      (SELECT spot.date::DATE as date, spot."avgrate-d2-tcam" tcam, 
      ROUND(spot."hiringvol-d2-brlFinVol"/(spot."avgrate-d2-tcam"*50000),2) volume,
      "hiringrate-d2-low" low, "hiringrate-d2-high" high, "hiringrate-d2-close" close
      FROM "b3-spotexchange" spot
      WHERE spot."avgrate-d2-settledate"::DATE=$1 ORDER BY "timestamp-load" DESC LIMIT 1)
      ORDER BY 1 ASC`,
      {
        date: dateRef.toJSDate(),
      },
    );

    if (!qSpot || qSpot.length < 2) return undefined;

    let qFRP0: any[];
    let aFRP0: { date: DateTime; frp0: number }[] | undefined = [];
    if (
      dateRef.startOf('day').toMillis() ===
        DateTime.now().startOf('day').toMillis() ||
      dateRefFRP
    ) {
      qFRP0 = await this.queryFactory.runQuery(
        `(SELECT "ts-trade"::DATE as date, (MAX(price) + MIN(price))/2 as frp0 
        FROM "intraday-trades" WHERE "ts-trade"::DATE = $2::DATE AND asset='FRP0'
        GROUP BY "ts-trade"::DATE) 
        UNION 
        (SELECT "timestamp-open"::DATE date, (MAX(high) + MIN(low))/2 as frp0 
        FROM "b3-ts-summary" WHERE "timestamp-open"::DATE=ANY($1) AND 
        "timestamp-open"::DATE<>$2::DATE AND asset='FRP0'
        GROUP BY "timestamp-open"::DATE ORDER BY "timestamp-open"::DATE DESC)
        ORDER BY 1 ASC`,
        {
          spotDates: qSpot.map((s: any) => s.date),
          date: dateRef.toJSDate(),
        },
      );
      aFRP0 =
        qFRP0 &&
        !dateRefFRP &&
        qSpot.every((s: any) =>
          qFRP0.find(
            f =>
              DateTime.fromJSDate(f.date).toMillis() ===
              DateTime.fromJSDate(s.date).toMillis(),
          ),
        ) &&
        qFRP0.find(
          f =>
            DateTime.fromJSDate(f.date).toMillis() ===
            dateRef.startOf('day').toMillis(),
        )
          ? qFRP0.map(q => {
              return {
                date: DateTime.fromJSDate(q.date),
                frp0: +Number(q.frp0).toFixed(2),
              };
            })
          : undefined;

      if (!aFRP0) {
        // consider frp0 d0 = frp1 d-1 if exists. Otherwise, frp0 d-1
        /* qFRP0 = await this.queryFactory.runQuery(
          `SELECT date, COALESCE(q.pmo, 0) frp0 FROM (
          SELECT "timestamp-open"::DATE date, MAX(high) h, MIN(low) l, (MAX(high) + MIN(low))/2 pmo FROM "b3-ts-summary" bts WHERE asset = 'FRP0' AND "timestamp-open"::DATE=ANY($1) GROUP BY "timestamp-open"::DATE
          UNION
          SELECT * FROM 
          (SELECT $2::DATE date, MAX(high) h, MIN(low) l, (MAX(high) + MIN(low))/2 pmo FROM "b3-ts-summary" bts WHERE asset = 'FRP1' AND "timestamp-open"::DATE<$2::DATE GROUP BY "timestamp-open"::DATE ORDER BY "timestamp-open"::DATE DESC LIMIT 1) q) q
          ORDER BY date DESC`,
          {
            spotDates: [...qSpot.map((s: any) => s.date)],
            dateRef: dateRef.toJSDate(),
          },
        ); */
        qFRP0 = await this.queryFactory.runQuery(
          `SELECT date, COALESCE(q.vwap, 0) frp0 FROM 
          (SELECT "timestamp-open"::DATE date, MAX(high) h, MIN(low) l, (MAX(high) + MIN(low))/2 pmo, (stddev_combine(volume, vwap, sigma)).mean vwap FROM "b3-ts-summary" bts WHERE asset = 'FRP0' AND "timestamp-open"::DATE=ANY($1) GROUP BY "timestamp-open"::DATE) q
          ORDER BY date DESC`,
          {
            spotDates: [...qSpot.map((s: any) => s.date)],
          },
        );
        let qFRP1 = await this.queryFactory.runQuery(
          `SELECT date, COALESCE(q.vwap, 0) frp1 FROM 
          (SELECT "timestamp-open"::DATE date, MAX(high) h, MIN(low) l, (MAX(high) + MIN(low))/2 pmo, (stddev_combine(volume, vwap, sigma)).mean vwap FROM "b3-ts-summary" bts WHERE asset = 'FRP1' AND "timestamp-open"::DATE<$1::DATE GROUP BY "timestamp-open"::DATE ORDER BY "timestamp-open"::DATE DESC LIMIT 1) q
          ORDER BY date DESC`,
          {
            dateRef: dateRef.toJSDate(),
          },
        );
        if (
          qFRP1 &&
          qFRP1.length > 0 &&
          DateTime.fromJSDate(qFRP1[0].date).startOf('day').toMillis() ===
            (
              await ReportLoaderCalendar.subTradeDays(
                this.queryFactory,
                dateRef,
                1,
                TCountryCode.BR,
              )
            )
              .startOf('day')
              .toMillis()
        )
          qFRP0.push({ date: dateRef.toJSDate(), frp0: qFRP1[0].frp1 });
        else if (
          dateRef.startOf('day').toMillis() <
          DateTime.now().startOf('day').toMillis()
        ) {
          qFRP1 = await this.queryFactory.runQuery(
            `SELECT date, COALESCE(q.open, 0) frp1 FROM 
            (SELECT "timestamp-open"::DATE date, open FROM "b3-ts-summary" bts WHERE asset = 'FRP0' AND "timestamp-open"::DATE=$1::DATE ORDER BY "timestamp-open" ASC LIMIT 1) q
            ORDER BY date DESC`,
            {
              dateRef: dateRef.toJSDate(),
            },
          );
          if (qFRP1 && qFRP1.length > 0)
            qFRP0.push({ date: dateRef.toJSDate(), frp0: qFRP1[0].frp1 });
        }

        aFRP0 =
          qFRP0 &&
          qSpot.every((s: any) =>
            qFRP0.find(
              f =>
                DateTime.fromJSDate(f.date).toMillis() ===
                DateTime.fromJSDate(s.date).toMillis(),
            ),
          ) &&
          qFRP0.find(
            f =>
              DateTime.fromJSDate(f.date).toMillis() ===
              dateRef.startOf('day').toMillis(),
          )
            ? qFRP0
                .map(q => {
                  return {
                    date: DateTime.fromJSDate(q.date),
                    frp0: +Number(q.frp0).toFixed(2),
                  };
                })
                .sort((a, b) =>
                  a.date > b.date ? -1 : a.date < b.date ? 1 : 0,
                )
            : undefined;
      }
    } else {
      qFRP0 = await this.queryFactory.runQuery(
        `SELECT "timestamp-open"::DATE date, (MAX(high) + MIN(low))/2 as frp0 
        FROM "b3-ts-summary" WHERE "timestamp-open"::DATE=ANY($1) AND asset='FRP0'
        GROUP BY "timestamp-open"::DATE 
        ORDER BY "timestamp-open"::DATE DESC`,
        { dates: [...qSpot.map((s: any) => s.date), dateRef.toJSDate()] },
      );
      aFRP0 =
        qFRP0 &&
        qSpot.every((s: any) =>
          qFRP0.find(
            f =>
              DateTime.fromJSDate(f.date).toMillis() ===
              DateTime.fromJSDate(s.date).toMillis(),
          ),
        ) &&
        qFRP0.find(
          f =>
            DateTime.fromJSDate(f.date).toMillis() ===
            dateRef.startOf('day').toMillis(),
        )
          ? qFRP0.map(q => {
              return {
                date: DateTime.fromJSDate(q.date),
                frp0: +Number(q.frp0).toFixed(2),
              };
            })
          : undefined;
    }

    if (!aFRP0) return undefined;

    const d1d2: ISpot[] = await Promise.all(
      qSpot.map(async (spot: any): Promise<ISpot> => {
        const { frp0 } = dateRefFRP
          ? aFRP0!.find(
              f =>
                f.date.startOf('day').toMillis() ===
                dateRef.startOf('day').toMillis(),
            )!
          : aFRP0!.find(
              f =>
                f.date.startOf('day').toMillis() ===
                DateTime.fromJSDate(spot.date).startOf('day').toMillis(),
            )!;
        return {
          date: DateTime.fromJSDate(spot.date),
          high: +(Number(spot.high) * 1000).toFixed(2),
          vwap: +(Number(spot.tcam) * 1000).toFixed(2),
          low: +(Number(spot.low) * 1000).toFixed(2),
          close: +(Number(spot.close) * 1000).toFixed(2),
          frp0: {
            today: frp0,
            calculated: await QuerySPOT.calculateFRP0(
              this.queryFactory,
              dateRef,
            ),
          },
          volume: +Number(spot.volume).toFixed(2),
        };
      }),
    );

    const sumVol = d1d2
      .map((d: any) => d.volume)
      .reduce((tot: number, vol: number) => tot + vol, 0);

    const sumPVVwap = d1d2
      .map((d: any) => d.vwap * d.volume)
      .reduce((tot: number, pricevol: any) => tot + pricevol, 0);

    const sumPVHigh = d1d2
      .map((d: any) => d.high * d.volume)
      .reduce((tot: number, pricevol: any) => tot + pricevol, 0);

    const sumPVLow = d1d2
      .map((d: any) => d.low * d.volume)
      .reduce((tot: number, pricevol: any) => tot + pricevol, 0);

    const sumPVClose = d1d2
      .map((d: any) => d.close * d.volume)
      .reduce((tot: number, pricevol: any) => tot + pricevol, 0);

    const frp0Today = aFRP0.find(
      f =>
        f.date.startOf('day').toMillis() === dateRef.startOf('day').toMillis(),
    )!.frp0;

    return {
      priorDays: d1d2,
      today: {
        date: DateTime.fromFormat(dateRef.toFormat('dd/MM/yyyy'), 'dd/MM/yyyy'),
        high: +Number(+(sumPVHigh / sumVol).toFixed(2)),
        vwap: +Number(+(sumPVVwap / sumVol).toFixed(2)),
        low: +Number(+(sumPVLow / sumVol).toFixed(2)),
        close: +Number(+(sumPVClose / sumVol).toFixed(2)),
        frp0: {
          today: frp0Today,
          calculated: await QuerySPOT.calculateFRP0(this.queryFactory, dateRef),
        },
        volume: +Number(sumVol).toFixed(2),
      },
    };
  }

  private getSPOTProjections(
    spot: number,
    frp0: number,
    qtty: number,
    multiplier: number,
  ): ISpotProjections | undefined {
    if (
      Number.isNaN(spot) ||
      Number.isNaN(frp0) ||
      Number.isNaN(qtty) ||
      Number.isNaN(multiplier) ||
      frp0 <= 0 ||
      spot <= 0 ||
      qtty <= 0 ||
      multiplier <= 0
    )
      throw new Error(
        `getSPOTProjections() - Wrong parameters - FRP0: ${frp0} - SPOT: ${spot} - QTTY: ${qtty}`,
      );

    if (qtty === 1) return undefined;

    const positive: number[] = [];
    const negative: number[] = [];
    for (let i = 1; i <= qtty; i++) {
      positive.push(+Number(spot + i * frp0).toFixed(2));
      negative.push(+Number(spot - i * frp0).toFixed(2));
    }
    return {
      positive: positive.sort().reverse(),
      spot,
      frp0,
      frp0_multiplier: multiplier,
      negative: negative.sort().reverse(),
    };
  }

  public static async getContract(
    queryFactory: QueryFactory,
    dateRef: DateTime,
    year4digits = false,
  ): Promise<IContract> {
    if (!dateRef.isValid)
      throw new Error(`getContract() - Invalid date: ${dateRef}`);

    const CONTRACTS = [
      'F',
      'G',
      'H',
      'J',
      'K',
      'M',
      'N',
      'Q',
      'U',
      'V',
      'X',
      'Z',
    ];

    const dateExpiry = dateRef
      .startOf('day')
      .set({ day: 1 })
      .plus({ months: 1 });
    const { month } = dateExpiry;
    const { year } = dateExpiry;

    const lastTradeDate = await ReportLoaderCalendar.subTradeDays(
      queryFactory,
      dateExpiry,
      2,
      TCountryCode.BR,
    );

    const idx = month - 1;
    const contract = `${CONTRACTS[idx]}${String(year).substr(2, 2)}`;

    const qFirstTrade = await queryFactory.runQuery(
      `SELECT MIN(date) date FROM (
      SELECT MIN(date) date FROM "b3-summary" WHERE asset = ANY($1) 
      UNION
      SELECT MIN("timestamp-open"::DATE) date FROM "b3-ts-summary" WHERE "asset" = ANY($1)) q1`,
      {
        assets: [`DOL${contract}`, `WDO${contract}`],
      },
    );
    const firstTradeDate =
      qFirstTrade && qFirstTrade.length > 0
        ? DateTime.fromJSDate(qFirstTrade[0].date)
        : undefined;

    const dateBeginVigency = await ReportLoaderCalendar.subTradeDays(
      queryFactory,
      dateExpiry.minus({ months: 1 }),
      2,
      TCountryCode.BR,
    );

    return {
      code: `${CONTRACTS[idx]}${
        year4digits ? year : String(year).substr(2, 2)
      }`,
      firstTradeDate:
        firstTradeDate && firstTradeDate.isValid ? firstTradeDate : undefined,
      dateBeginVigency,
      dateExpiry,
      lastTradeDate,
    };
  }

  private static async calculateFRP0(
    queryFactory: QueryFactory,
    dateRef: DateTime,
  ): Promise<number | undefined> {
    if (!dateRef.isValid)
      throw new Error(
        `calculateFRP0() - Invalid parameter dateRef: ${dateRef.toJSDate()}`,
      );

    let contract = await QuerySPOT.getContract(queryFactory, dateRef);
    if (
      dateRef.startOf('day').toMillis() >=
      contract.lastTradeDate.startOf('day').toMillis()
    )
      contract = await QuerySPOT.getContract(queryFactory, contract.dateExpiry);

    const contratNext = await QuerySPOT.getContract(
      queryFactory,
      contract.dateExpiry,
    );
    const previousTradeDate = await ReportLoaderCalendar.subTradeDays(
      queryFactory,
      dateRef,
      1,
      TCountryCode.BR,
    );

    const qDI1_close = await queryFactory.runQuery(
      `SELECT 
      (stddev_combine(volume, vwap, sigma)).mean vwap,
      MAX(open) FILTER(WHERE rn_asc=1) AS open, 
      MAX(close) FILTER(WHERE rn_desc=1) AS close
      FROM (
        SELECT t.*, ROW_NUMBER() OVER (PARTITION BY asset ORDER BY "timestamp-open" ASC) rn_asc, ROW_NUMBER() OVER (PARTITION BY asset ORDER BY "timestamp-open" DESC) rn_desc FROM (
          SELECT * FROM "b3-ts-summary" WHERE asset = $1 AND "timestamp-open"::DATE = $2
        ) t
      ) t`,
      {
        asset: `DI1${contract.code}`,
        dateRef: previousTradeDate.toJSDate(),
      },
    );

    const qFRC_close = await queryFactory.runQuery(
      `SELECT 
      (stddev_combine(volume, vwap, sigma)).mean vwap,
      MAX(open) FILTER(WHERE rn_asc=1) AS open, 
      MAX(close) FILTER(WHERE rn_desc=1) AS close
      FROM (
        SELECT t.*, ROW_NUMBER() OVER (PARTITION BY asset ORDER BY "timestamp-open" ASC) rn_asc, ROW_NUMBER() OVER (PARTITION BY asset ORDER BY "timestamp-open" DESC) rn_desc FROM (
          SELECT * FROM "b3-ts-summary" WHERE asset = $1 AND "timestamp-open"::DATE = $2
        ) t
      ) t`,
      {
        asset: `FRC${contratNext.code}`,
        dateRef: previousTradeDate.toJSDate(),
      },
    );

    /* const qDI1_settle = await queryFactory.runQuery(
      `SELECT vwap settle FROM "b3-summary" WHERE "asset-code"=$1 AND contract=$2 AND date::DATE=$3`,
      {
        asset: 'DI1',
        contract: contract.code,
        dateRef: previousTradeDate.toJSDate(),
      },
    );

    const qFRC_settle = await queryFactory.runQuery(
      `SELECT close settle FROM "b3-summary" WHERE "asset-code"=$1 AND contract=$2 AND date::DATE=$3`,
      {
        asset: 'FRC',
        contract: contratNext.code,
        dateRef: previousTradeDate.toJSDate(),
      },
    ); */

    const qPTAX = await queryFactory.runQuery(
      `SELECT pbrl_ptax_sell ptax FROM "bcb-ptax" WHERE date::DATE=$1`,
      {
        dateRef: previousTradeDate.toJSDate(),
      },
    );

    /* if (!qPTAX || qPTAX.length === 0 || Number(qPTAX[0].ptax) === 0)
      return undefined;
    if (
      (!qFRC_close || qFRC_close.length === 0 || Number(qFRC_close[0]) === 0) &&
      (!qDI1_settle || qDI1_settle.length === 0 || Number(qDI1_settle[0]) === 0)
    )
      return undefined;

    if (
      (!qDI1_close || qDI1_close.length === 0 || Number(qDI1_close[0]) === 0) &&
      (!qFRC_settle || qFRC_settle.length === 0 || Number(qFRC_settle[0]) === 0)
    )
      return undefined; */

    /* const qSPOT = await queryFactory.runQuery(
      `SELECT symbol, (stddev_combine(volume, vwap, sigma)).mean vwap,
      MAX(open) FILTER(WHERE rn_asc=1) AS open, 
      MAX(close) FILTER(WHERE rn_desc=1) AS close
      FROM (
        SELECT t.*, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY "timestamp-open" ASC) rn_asc, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY "timestamp-open" DESC) rn_desc FROM (
          SELECT * FROM "tradingview-summary" WHERE symbol = $1 AND exchange = $2 AND "timestamp-open"::DATE = $3
        ) t
      ) t
      GROUP BY symbol ORDER BY symbol ASC`,
      {
        symbol: `USDBRL`,
        exchange: 'ACTIVETRADERS',
        dateRef: previousTradeDate.toJSDate(),
      },
    ); */

    /* const diffDays = contract.lastTradeDate.diff(dateRef, 'day').days;
    const diffBizDays = await ReportLoaderCalendar.differenceInTradeDays(
      queryFactory,
      contract.lastTradeDate,
      dateRef,
      TCountryCode.BR,
    ); */
    const diffDays = contract.dateExpiry.diff(dateRef, 'day').days; // - 1;
    const diffBizDays = await ReportLoaderCalendar.differenceInTradeDays(
      queryFactory,
      contract.dateExpiry,
      dateRef,
      TCountryCode.BR,
    ); // - 1;

    const iDDI_close =
      qFRC_close && qFRC_close.length > 0
        ? 1 + (Number(qFRC_close[0].close) / 36000) * diffDays
        : undefined;
    const iDI1_close =
      qDI1_close && qDI1_close.length > 0
        ? (1 + Number(qDI1_close[0].close) / 100) ** (diffBizDays / 252)
        : undefined;

    /* const iDDI_settle =
      qFRC_settle && qFRC_settle.length > 0
        ? 1 + (Number(qFRC_settle[0].settle) / 36000) * diffDays
        : undefined;
    const iDI1_settle =
      qDI1_settle && qDI1_settle.length > 0
        ? (1 + Number(qDI1_settle[0].settle) / 100) ** (diffBizDays / 252)
        : undefined;

    if (!iDDI_close && !iDI1_close && !iDDI_settle && !iDI1_close)
      return undefined; */

    const frp0 =
      iDI1_close &&
      iDI1_close > 0 &&
      iDDI_close &&
      iDDI_close > 0 &&
      qPTAX[0] &&
      Number(qPTAX[0].ptax) > 0
        ? +Number(
            Number(qPTAX[0].ptax) * (iDI1_close / iDDI_close - 1) * 1000,
          ).toFixed(2)
        : undefined;

    /* return {
      contract,
      traded:
        qFRP && qFRP.length > 0 && contractType === TContract.CURRENT
          ? {
              pmo: qFRP[0].pmo,
              vwap: qFRP[0].vwap,
            }
          : undefined,
      calculated: {
        close_d1:
          iDI1_close &&
          iDI1_close > 0 &&
          iDDI_close &&
          iDDI_close > 0 &&
          qPTAX[0] &&
          Number(qPTAX[0].ptax) > 0
            ? +Number(
                Number(qPTAX[0].ptax) * (iDI1_close / iDDI_close - 1) * 1000,
              ).toFixed(2)
            : undefined,
        settle_d1:
          iDI1_settle &&
          iDI1_settle > 0 &&
          iDDI_settle &&
          iDDI_settle > 0 &&
          qPTAX[0] &&
          Number(qPTAX[0].ptax) > 0
            ? +Number(
                Number(qPTAX[0].ptax) * (iDI1_settle / iDDI_settle - 1) * 1000,
              ).toFixed(2)
            : undefined,
      },
    }; */

    return frp0;
  }
}

export { ISpot, ISpotSettleDate };
