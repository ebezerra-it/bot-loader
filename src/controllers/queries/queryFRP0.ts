/* eslint-disable camelcase */
import { DateTime } from 'luxon';
import BaseBot, { TUserType } from '../../bot/baseBot';
import Query from './query';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { TCountryCode } from '../tcountry';
import { QueryFactory } from '../../db/queryFactory';
import QueryPTAX from './queryPTAX';

enum TContractType {
  CURRENT = 'CURRENT',
  NEXT = 'NEXT',
}

interface IContract {
  code: string;
  firstTradeDate: DateTime | undefined;
  dateBeginVigency: DateTime;
  lastTradeDate: DateTime;
  dateExpiry: DateTime;
}

interface IFRP {
  contract: IContract;
  traded: { vwap: number; pmo: number; volume: number } | undefined;
  calculated: number | undefined;
}

interface IFRPProjections {
  positive: number[];
  levelRef: number;
  frp: number;
  frp_multiplier: number;
  negative: number[];
}

export default class QueryFRP0 extends Query {
  public async process(params: {
    dateFrom?: DateTime;
    dateTo?: DateTime;
    contractType?: TContractType;
    prefD1FRP1?: boolean;
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    const aFRP0: IFRP[] = [];

    const dateFrom =
      params.dateFrom &&
      params.dateFrom.isValid &&
      params.dateFrom.startOf('day').toMillis() <
        DateTime.now().startOf('day').toMillis()
        ? params.dateFrom
        : DateTime.now();

    let dateRef = dateFrom;

    const dateTo: DateTime =
      params.dateTo &&
      params.dateTo.isValid &&
      params.dateTo.startOf('day').toMillis() >=
        dateRef.startOf('day').toMillis()
        ? params.dateTo
        : DateTime.now();

    while (
      dateRef.startOf('day').toMillis() <= dateTo.startOf('day').toMillis()
    ) {
      const resFRP0: IFRP | undefined = await this.getFRP(
        dateRef,
        !!params.prefD1FRP1,
        params.contractType || TContractType.CURRENT,
      );
      if (resFRP0) aFRP0.push(resFRP0);

      dateRef = dateRef.plus({ days: 1 });
    }

    let botResponse;
    if (aFRP0.length > 0) botResponse = BaseBot.printJSON(aFRP0);
    else botResponse = 'Not enought data.';

    const msgHeader = `FRP0 - Date From: ${dateFrom.toFormat(
      'dd/MM/yyyy',
    )} - Date To: ${dateTo.toFormat('dd/MM/yyyy')}\n`;

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
    }
    return !!(aFRP0.length > 0);
  }

  private async getFRP(
    dateRef: DateTime,
    prefD1FRP1: boolean,
    contractType: TContractType,
  ): Promise<IFRP | undefined> {
    return QueryFRP0.getFRP(
      this.queryFactory,
      dateRef,
      prefD1FRP1,
      contractType,
    );
  }

  public static async getFRP(
    queryFactory: QueryFactory,
    dateRef: DateTime,
    prefD1FRP1: boolean,
    contractType: TContractType,
  ): Promise<IFRP | undefined> {
    if (contractType === TContractType.NEXT) {
      const contractNext = await this.getContractCode(
        queryFactory,
        dateRef,
        contractType,
      );

      const calculatedFRPNext = await QueryFRP0.calculateFRP(
        queryFactory,
        dateRef,
        contractNext,
      );
      if (!calculatedFRPNext) return undefined;

      return {
        contract: contractNext,
        traded: undefined,
        calculated: calculatedFRPNext.frp,
      };
    }

    let tradedFRP: { vwap: number; pmo: number; volume: number } | undefined;
    let qFRP: any | undefined;

    if (
      dateRef.startOf('day').toMillis() ===
        DateTime.now().startOf('day').toMillis() &&
      !prefD1FRP1
    ) {
      qFRP = await queryFactory.runQuery(
        `SELECT 
        datetime::DATE date, (high + low)/2 pmo, vwap, volume
        FROM "b3-assetsquotes" 
        WHERE asset='FRP0' AND datetime::DATE=$1::DATE
        ORDER BY datetime DESC
        LIMIT 1`,
        {
          dateRef: dateRef.toJSDate(),
        },
      );
    } else {
      const prevDate = await ReportLoaderCalendar.subTradeDays(
        queryFactory,
        dateRef,
        1,
        TCountryCode.BR,
      );

      qFRP = await queryFactory.runQuery(
        `SELECT q1.date, q1.pmo, q1.vwap, q0.volume 
        FROM
        (SELECT 
          "timestamp-open"::DATE date,
          (MAX(high) + MIN(low))/2 pmo, 
          (stddev_combine(volume, vwap, sigma)).mean vwap
          FROM "b3-ts-summary" 
          WHERE asset = 'FRP1' AND "timestamp-open"::DATE=$1 
          GROUP BY "timestamp-open"::DATE
          ORDER BY "timestamp-open"::DATE DESC) q1, 
        (SELECT 
          (stddev_combine(volume, vwap, sigma)).qtty volume 
          FROM "b3-ts-summary" 
          WHERE asset = 'FRP0' AND "timestamp-open"::DATE=$1 
          GROUP BY "timestamp-open"::DATE
          ORDER BY "timestamp-open"::DATE DESC) q0`,
        {
          dateRef: prevDate.toJSDate(),
        },
      );

      if (!qFRP || qFRP.length === 0) {
        qFRP = await queryFactory.runQuery(
          `SELECT q1.date, q1.pmo, q1.vwap, q0.volume 
          FROM
          (SELECT date, (high + low)/2 pmo, vwap  
          FROM "b3-summary" 
          WHERE asset = 'FRP1' AND date=$2) q1,
          (SELECT "volume-size" volume  
          FROM "b3-summary" 
          WHERE asset = 'FRP0' AND date=$1) q0`,
          {
            dateRef: prevDate.toJSDate(),
            nextDate: dateRef.toJSDate(),
          },
        );

        if (!qFRP || qFRP.length === 0) {
          qFRP = await queryFactory.runQuery(
            `select q1.date, q1.pmo, q1.vwap, q0.volume from 
            (SELECT datetime::DATE date, (high + low)/2 pmo, vwap
            FROM "b3-assetsquotes" 
            WHERE asset='FRP1' AND datetime::DATE=$1::DATE
            ORDER BY datetime DESC
            LIMIT 1) q1, 
            (SELECT volume
            FROM "b3-assetsquotes" 
            WHERE asset='FRP0' AND datetime::DATE=$1::DATE
            ORDER BY datetime DESC
            LIMIT 1) q0`,
            {
              dateRef: prevDate.toJSDate(),
            },
          );
        }
      }
    }

    if (qFRP && qFRP.length > 0) {
      tradedFRP = {
        vwap: Number(qFRP[0].vwap),
        pmo: Number(qFRP[0].pmo),
        volume: Number(qFRP[0].volume),
      };
    }

    const contract = await this.getContractCode(
      queryFactory,
      dateRef,
      contractType,
    );

    const calculatedFRP = await QueryFRP0.calculateFRP(queryFactory, dateRef);

    if (!tradedFRP && !calculatedFRP) return undefined;

    return {
      contract: calculatedFRP ? calculatedFRP.contract : contract,
      traded: tradedFRP,
      calculated: calculatedFRP ? calculatedFRP.frp : undefined,
    };
  }

  private async getContractCode(
    dateRef: DateTime,
    contractType: TContractType,
    year4digits = false,
  ): Promise<IContract> {
    return QueryFRP0.getContractCode(
      this.queryFactory,
      dateRef,
      contractType,
      year4digits,
    );
  }

  public static async getContractCode(
    queryFactory: QueryFactory,
    dateRef: DateTime,
    contractType: TContractType,
    year4digits = false,
  ): Promise<IContract> {
    if (!dateRef.isValid)
      throw new Error(`getContractCode() - Invalid date: ${dateRef}`);

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

    let dateExpiry: DateTime;
    let lastTradeDate: DateTime;
    let month: number;
    let year: number;
    if (contractType === TContractType.CURRENT) {
      dateExpiry = dateRef.startOf('day').set({ day: 1 }).plus({ months: 1 });
      if (
        !(await ReportLoaderCalendar.isTradeDay(
          queryFactory,
          dateExpiry,
          TCountryCode.BR,
        ))
      )
        dateExpiry = await ReportLoaderCalendar.addTradeDays(
          queryFactory,
          dateExpiry,
          1,
          TCountryCode.BR,
        );

      month = dateExpiry.month;
      year = dateExpiry.year;

      lastTradeDate = await ReportLoaderCalendar.subTradeDays(
        queryFactory,
        dateExpiry,
        2,
        TCountryCode.BR,
      );
    } else {
      dateExpiry = dateRef.startOf('day').set({ day: 1 }).plus({ months: 2 });
      if (
        !(await ReportLoaderCalendar.isTradeDay(
          queryFactory,
          dateExpiry,
          TCountryCode.BR,
        ))
      )
        dateExpiry = await ReportLoaderCalendar.addTradeDays(
          queryFactory,
          dateExpiry,
          1,
          TCountryCode.BR,
        );

      month = dateExpiry.month;
      year = dateExpiry.year;

      lastTradeDate = await ReportLoaderCalendar.subTradeDays(
        queryFactory,
        dateExpiry,
        2,
        TCountryCode.BR,
      );
    }

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

  public static async calculateFRP(
    queryFactory: QueryFactory,
    dateRef: DateTime,
    _contract?: IContract,
  ): Promise<{ contract: IContract; frp: number } | undefined> {
    const prevDate = await ReportLoaderCalendar.subTradeDays(
      queryFactory,
      dateRef,
      1,
      TCountryCode.BR,
    );

    let contract =
      _contract ||
      (await QueryFRP0.getContractCode(
        queryFactory,
        dateRef,
        TContractType.CURRENT,
      ));

    if (
      contract.lastTradeDate.startOf('day').toMillis() <=
      dateRef.startOf('day').toMillis()
    )
      contract = await QueryFRP0.getContractCode(
        queryFactory,
        dateRef,
        TContractType.NEXT,
      );

    const diffDays =
      contract.dateExpiry.diff(dateRef.startOf('day'), 'day').days - 1;
    const diffBizDays =
      (await ReportLoaderCalendar.differenceInTradeDays(
        queryFactory,
        contract.dateExpiry,
        dateRef,
        TCountryCode.BR,
      )) - 1;

    const contractNext = await QueryFRP0.getContractCode(
      queryFactory,
      contract.dateExpiry,
      TContractType.CURRENT,
    );

    let ptax = await QueryPTAX.getPTAX(queryFactory, dateRef);
    if (!ptax || ptax <= 0) {
      ptax = await QueryPTAX.getPTAX(queryFactory, prevDate);
    }
    if (!ptax || ptax <= 0) return undefined;

    let qDI1 = await queryFactory.runQuery(
      `SELECT last as close FROM "b3-assetsquotes" WHERE asset = $1 AND datetime < $2 AND datetime::DATE = $2 ORDER BY datetime DESC LIMIT 1`,
      {
        asset: `DI1${contract.code}`,
        dateRef: dateRef.toJSDate(),
      },
    );
    if (!qDI1 || qDI1.length === 0) {
      qDI1 = await queryFactory.runQuery(
        `SELECT close FROM "b3-summary" WHERE asset = $1 AND date::DATE = $2`,
        {
          asset: `DI1${contract.code}`,
          dateRef: prevDate.toJSDate(),
        },
      );
    }
    if (!qDI1 || qDI1.length === 0) return undefined;

    const qFRC = await queryFactory.runQuery(
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
        asset: `FRC${contractNext.code}`,
        dateRef: prevDate.toJSDate(),
      },
    );

    if (!qFRC || qFRC.length === 0) return undefined;

    const iDDI =
      qFRC && qFRC.length > 0
        ? 1 + (Number(qFRC[0].close) / 36000) * diffDays
        : undefined;
    const iDI1 =
      qDI1 && qDI1.length > 0
        ? (1 + Number(qDI1[0].close) / 100) ** (diffBizDays / 252)
        : undefined;

    if (!iDI1 || iDI1 <= 0 || !iDDI || iDDI <= 0) return undefined;

    return {
      contract,
      frp: +Number(Number(ptax) * (iDI1 / iDDI - 1)).toFixed(2),
    };
  }

  public static getFRPProjections(
    levelRef: number,
    frp: number,
    qtty: number,
    multiplier: number,
  ): IFRPProjections | undefined {
    if (
      Number.isNaN(levelRef) ||
      Number.isNaN(frp) ||
      Number.isNaN(qtty) ||
      Number.isNaN(multiplier) ||
      frp <= 0 ||
      levelRef <= 0 ||
      qtty <= 0 ||
      multiplier <= 0
    )
      throw new Error(
        `getFRPProjections() - Wrong parameters - FRP: ${frp} - SPOT: ${levelRef} - QTTY: ${qtty}`,
      );

    if (qtty === 1) return undefined;

    const positive: number[] = [];
    const negative: number[] = [];
    for (let i = 1; i <= qtty; i++) {
      positive.push(+Number(levelRef + i * frp).toFixed(2));
      negative.push(+Number(levelRef - i * frp).toFixed(2));
    }
    return {
      positive: positive.sort().reverse(),
      levelRef,
      frp,
      frp_multiplier: multiplier,
      negative: negative.sort().reverse(),
    };
  }
}
export { IFRP, TContractType, IFRPProjections };
