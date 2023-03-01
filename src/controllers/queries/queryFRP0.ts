/* eslint-disable camelcase */
import { DateTime } from 'luxon';
import BaseBot, { TUserType } from '../../bot/baseBot';
import Query from './query';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { TCountryCode } from '../tcountry';
import { QueryFactory } from '../../db/queryFactory';

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

/* enum TFRPCalculationType {
  SETTLE_D1 = 'SETTLE_D1',
  CLOSE_D1 = 'CLOSE_D1',
  OPEN_D0 = 'OPEN_D0',
} */

interface IFRP {
  contract: IContract;
  traded: { vwap: number; pmo: number } | undefined;
  calculated: {
    settle_d1: number | undefined;
    close_d1: number | undefined;
  };
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
      const resFRP0: IFRP | undefined = await this.getFRP0(
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

  private async getFRP0(
    dateRef: DateTime,
    prefD1FRP1: boolean,
    contractType: TContractType,
  ): Promise<IFRP | undefined> {
    return QueryFRP0.getFRP0(
      this.queryFactory,
      dateRef,
      prefD1FRP1,
      contractType,
    );
  }

  public static async getFRP0(
    queryFactory: QueryFactory,
    dateRef: DateTime,
    prefD1FRP1: boolean,
    contractType: TContractType,
  ): Promise<IFRP | undefined> {
    let tradedFRP: { vwap: number; pmo: number } | undefined;
    let qFRP: any | undefined;

    qFRP = await queryFactory.runQuery(
      `SELECT 
      "timestamp-open"::DATE date,
      (MAX(high) + MIN(low))/2 pmo, 
      (stddev_combine(volume, vwap, sigma)).mean vwap  
      FROM "b3-ts-summary" 
      WHERE asset = 'FRP1' AND "timestamp-open"::DATE<$1 
      GROUP BY "timestamp-open"::DATE
      ORDER BY "timestamp-open"::DATE DESC
      LIMIT 1`,
      {
        dateRef: dateRef.toJSDate(),
      },
    );
    if (
      qFRP &&
      qFRP.length > 0 &&
      DateTime.fromJSDate(qFRP[0].date).startOf('day').toMillis() ===
        (
          await ReportLoaderCalendar.subTradeDays(
            queryFactory,
            dateRef,
            1,
            TCountryCode.BR,
          )
        )
          .startOf('day')
          .toMillis()
    ) {
      tradedFRP = { vwap: Number(qFRP[0].vwap), pmo: Number(qFRP[0].pmo) };
    }

    if (!tradedFRP || !prefD1FRP1) {
      qFRP = await queryFactory.runQuery(
        `SELECT 
        "timestamp-open"::DATE date,
        (MAX(high) + MIN(low))/2 pmo, 
        (stddev_combine(volume, vwap, sigma)).mean vwap  
        FROM "b3-ts-summary" 
        WHERE asset = 'FRP0' AND 
        "timestamp-open"<$1 AND "timestamp-open"::DATE=$1::DATE
        GROUP BY "timestamp-open"::DATE
        ORDER BY "timestamp-open"::DATE DESC
        LIMIT 1`,
        {
          dateRef: dateRef.toJSDate(),
        },
      );

      if (qFRP && qFRP.length > 0)
        tradedFRP = { vwap: Number(qFRP[0].pmo), pmo: Number(qFRP[0].vwap) };
      else {
        qFRP = await queryFactory.runQuery(
          `SELECT 
          datetime::DATE date, (high + low)/2 pmo, vwap
          FROM "b3-assetsquotes" 
          WHERE asset='FRP0' AND datetime::DATE=$1::DATE AND datetime<$1
          ORDER BY datetime DESC
          LIMIT 1`,
          {
            dateRef: dateRef.toJSDate(),
          },
        );
        if (qFRP && qFRP.length > 0)
          tradedFRP = { vwap: Number(qFRP[0].vwap), pmo: Number(qFRP[0].pmo) };
      }
    }

    let contract = await QueryFRP0.getContractCode(
      queryFactory,
      dateRef,
      contractType,
    );
    if (
      dateRef.startOf('day').toMillis() >=
      contract.lastTradeDate.startOf('day').toMillis()
    )
      contract = await QueryFRP0.getContractCode(
        queryFactory,
        contract.dateExpiry,
        contractType,
      );

    const contratNext = await QueryFRP0.getContractCode(
      queryFactory,
      contract.dateExpiry,
      TContractType.CURRENT,
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

    const qDI1_settle = await queryFactory.runQuery(
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
    );

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

    /* const qSPOT = await this.queryFactory.runQuery(
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
      this.queryFactory,
      contract.lastTradeDate,
      dateRef,
      TCountryCode.BR,
    ); */
    const diffDays = contract.dateExpiry.diff(dateRef, 'day').days;
    let diffBizDays = await ReportLoaderCalendar.differenceInTradeDays(
      queryFactory,
      contract.dateExpiry,
      dateRef,
      TCountryCode.BR,
    );
    // diffDays = diffDays > 0 ? diffDays - 1 : 0;
    diffBizDays = diffBizDays > 0 ? diffBizDays - 1 : 0;
    /* console.log(`diffDays=${diffDays}`);
    console.log(`diffBizDays=${diffBizDays}`); */

    const iDDI_close =
      qFRC_close && qFRC_close.length > 0
        ? 1 + (Number(qFRC_close[0].close) / 36000) * diffDays
        : undefined;
    const iDI1_close =
      qDI1_close && qDI1_close.length > 0
        ? (1 + Number(qDI1_close[0].close) / 100) ** (diffBizDays / 252)
        : undefined;

    const iDDI_settle =
      qFRC_settle && qFRC_settle.length > 0
        ? 1 + (Number(qFRC_settle[0].settle) / 36000) * diffDays
        : undefined;
    const iDI1_settle =
      qDI1_settle && qDI1_settle.length > 0
        ? (1 + Number(qDI1_settle[0].settle) / 100) ** (diffBizDays / 252)
        : undefined;

    if (
      !iDDI_close &&
      !iDI1_close &&
      !iDDI_settle &&
      !iDI1_close &&
      (!qFRP || qFRP.length === 0)
    )
      return undefined;

    return {
      contract,
      traded:
        tradedFRP && contractType === TContractType.CURRENT
          ? tradedFRP
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
}
export { IFRP, TContractType };
