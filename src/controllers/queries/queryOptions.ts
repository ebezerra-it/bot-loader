/* eslint-disable camelcase */
/* eslint-disable no-nested-ternary */
import { DateTime } from 'luxon';
import Query from './query';
import TelegramBot, { TUserType } from '../../bot/telegramBot';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { TCountryCode } from '../tcountry';
import { QueryFactory } from '../../db/queryFactory';

enum TContract {
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

enum TFRPCalculationType {
  SETTLE_D1 = 'SETTLE_D1',
  CLOSE_D1 = 'CLOSE_D1',
  OPEN_D0 = 'OPEN_D0',
}

interface IFRP {
  contract: IContract;
  traded: { vwap: number; pmo: number } | undefined;
  calculated: {
    settle_d1: number | undefined;
    close_d1: number | undefined;
  };
}

interface IOIOptionsBorders {
  contract: string;
  futureCALL: number;
  spotCALL: number;
  volumeCALL: number;
  futurePUT: number;
  spotPUT: number;
  volumePUT: number;
  vwapSpotOptions: number;
  vwapFutureOptions: number;
  volumeOptions: number;
  frp0: IFRP | undefined;
}

export default class QueryOptions extends Query {
  public async process(params: {
    dateRef: DateTime;
    frpCalculationType: TFRPCalculationType;
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    const usdOpts = await this.calculateOIOptionsVWAP(
      params.dateRef,
      params.frpCalculationType,
    );
    const msgHeader = `USD OPTIONS - Date: ${params.dateRef.toFormat(
      'dd/MM/yyyy',
    )}\n`;

    let botResponse;
    if (usdOpts) botResponse = TelegramBot.printJSON(usdOpts);
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

    return !!usdOpts;
  }

  public async calculateOIOptionsVWAP(
    dateRef: DateTime,
    frpCalculationType: TFRPCalculationType,
  ): Promise<
    | {
        date: DateTime;
        currentContract: IOIOptionsBorders;
        nextContract: IOIOptionsBorders;
      }
    | undefined
  > {
    const qTradeDate = await this.queryFactory.runQuery(
      `SELECT date FROM "b3-summary" WHERE "asset-type" ='OPTIONS' AND "asset-code" = 'DOL' AND date < $1 ORDER BY date DESC LIMIT 1`,
      { dateRef: dateRef.toJSDate() },
    );
    const lastTradeDate = await ReportLoaderCalendar.subTradeDays(
      this.queryFactory,
      dateRef,
      1,
      TCountryCode.BR,
    );

    if (
      !qTradeDate ||
      DateTime.fromJSDate(qTradeDate[0].date).startOf('day') <
        lastTradeDate.startOf('day')
    )
      return undefined;

    const dateQuery = DateTime.fromJSDate(qTradeDate[0].date).startOf('day');

    // const contract = await this.getContractCode(dateRef, TContract.CURRENT);
    // const contractNext = await this.getContractCode(dateRef, TContract.NEXT);
    const frp_c1 = await this.getFRP(dateRef, dateRef, TContract.CURRENT);
    if (!frp_c1) return undefined;

    const frp_c2 = await this.getFRP(
      dateRef,
      frp_c1.contract.dateExpiry,
      TContract.CURRENT,
    );
    if (!frp_c2) return undefined;

    const { contract } = frp_c1;
    const contractNext = frp_c2.contract;

    const qOptions = await this.queryFactory.runQuery(
      `SELECT 
      COALESCE(qc.vwap, 0) vwap_call, 
      COALESCE(qc.volume, 0) vol_call, 
      COALESCE(qp.vwap, 0) vwap_put, 
      COALESCE(qp.volume,0) vol_put 
      FROM 
      (SELECT SUM(level*volume)/SUM(volume) vwap, SUM(volume) volume FROM (SELECT SUBSTRING(asset, 8, 6)::NUMERIC level,"oi-close" volume FROM "b3-summary" WHERE "asset-type" ='OPTIONS' AND "asset-code" = 'DOL' AND date=$1 AND contract=$2 AND "option-type"='CALL') q1) qc,
      (SELECT SUM(level*volume)/SUM(volume) vwap, SUM(volume) volume FROM (SELECT SUBSTRING(asset, 8, 6)::NUMERIC level,"oi-close" volume FROM "b3-summary" WHERE "asset-type" ='OPTIONS' AND "asset-code" = 'DOL' AND date=$1 AND contract=$2 AND "option-type"='PUT') q2) qp
    `,
      {
        dateRef: dateQuery.toJSDate(),
        contract: contract.code,
      },
    );

    if (!qOptions || qOptions.length === 0) return undefined;

    const vwapOptions =
      Number(qOptions[0].vol_call) > 0 && Number(qOptions[0].vol_put) > 0
        ? (Number(qOptions[0].vwap_call) * Number(qOptions[0].vol_call) +
            Number(qOptions[0].vwap_put) * Number(qOptions[0].vol_put)) /
          (Number(qOptions[0].vol_call) + Number(qOptions[0].vol_put))
        : 0;

    const frp0_c1 = frp_c1
      ? frp_c1.traded
        ? frp_c1.traded.vwap
        : frp_c1.calculated
        ? frpCalculationType === TFRPCalculationType.CLOSE_D1
          ? frp_c1.calculated.close_d1
          : frpCalculationType === TFRPCalculationType.SETTLE_D1
          ? frp_c1.calculated.settle_d1
          : 0
        : 0
      : 0;

    const frp0_c2 = frp_c2
      ? frp_c2.traded
        ? frp_c2.traded.vwap
        : frp_c2.calculated
        ? frpCalculationType === TFRPCalculationType.CLOSE_D1
          ? frp_c2.calculated.close_d1
          : frpCalculationType === TFRPCalculationType.SETTLE_D1
          ? frp_c2.calculated.settle_d1
          : 0
        : 0
      : 0;

    return {
      date: dateRef,
      currentContract: {
        contract: contract.code,
        futureCALL: Number(qOptions[0].vwap_call) + Number(frp0_c1),
        spotCALL: Number(qOptions[0].vwap_call),
        volumeCALL: Number(qOptions[0].vol_call),
        futurePUT: Number(qOptions[0].vwap_put) + Number(frp0_c1),
        spotPUT: Number(qOptions[0].vwap_put),
        volumePUT: Number(qOptions[0].vol_put),
        vwapFutureOptions: Number(vwapOptions) + Number(frp0_c1),
        vwapSpotOptions: Number(vwapOptions),
        volumeOptions:
          Number(qOptions[0].vol_call) + Number(qOptions[0].vol_put),
        frp0: frp_c1,
      },
      nextContract: {
        contract: contractNext.code,
        futureCALL: Number(qOptions[0].vwap_call) + Number(frp0_c2),
        spotCALL: Number(qOptions[0].vwap_call),
        volumeCALL: Number(qOptions[0].vol_call),
        futurePUT: Number(qOptions[0].vwap_put) + Number(frp0_c2),
        spotPUT: Number(qOptions[0].vwap_put),
        volumePUT: Number(qOptions[0].vol_put),
        vwapFutureOptions: Number(vwapOptions) + Number(frp0_c2),
        vwapSpotOptions: Number(vwapOptions),
        volumeOptions:
          Number(qOptions[0].vol_call) + Number(qOptions[0].vol_put),
        frp0: frp_c2,
      },
    };
  }

  private async getContractCode(
    dateRef: DateTime,
    contractType: TContract,
    year4digits = false,
  ): Promise<IContract> {
    return QueryOptions.getContractCode(
      this.queryFactory,
      dateRef,
      contractType,
      year4digits,
    );
  }

  public static async getContractCode(
    queryFactory: QueryFactory,
    dateRef: DateTime,
    contractType: TContract,
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
    if (contractType === TContract.CURRENT) {
      dateExpiry = dateRef.startOf('day').set({ day: 1 }).plus({ months: 1 });
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

  private async getFRP(
    dateRef: DateTime,
    dateContract: DateTime,
    contractType: TContract,
  ): Promise<IFRP | undefined> {
    const qFRP = await this.queryFactory.runQuery(
      `SELECT 
      (MAX(high) + MIN(low))/2 pmo, 
      (stddev_combine(volume, vwap, sigma)).mean vwap  
      FROM "b3-ts-summary" 
      WHERE asset = 'FRP0' AND "timestamp-open"::DATE=$1`,
      {
        dateRef: dateRef.toJSDate(),
      },
    );

    let contract = await this.getContractCode(dateContract, contractType);
    if (
      dateRef.startOf('day').toMillis() >=
      contract.lastTradeDate.startOf('day').toMillis()
    )
      contract = await this.getContractCode(contract.dateExpiry, contractType);

    const contratNext = await this.getContractCode(
      contract.dateExpiry,
      TContract.CURRENT,
    );
    const previousTradeDate = await ReportLoaderCalendar.subTradeDays(
      this.queryFactory,
      dateRef,
      1,
      TCountryCode.BR,
    );

    const qDI1_close = await this.queryFactory.runQuery(
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

    const qFRC_close = await this.queryFactory.runQuery(
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

    const qDI1_settle = await this.queryFactory.runQuery(
      `SELECT vwap settle FROM "b3-summary" WHERE "asset-code"=$1 AND contract=$2 AND date::DATE=$3`,
      {
        asset: 'DI1',
        contract: contract.code,
        dateRef: previousTradeDate.toJSDate(),
      },
    );

    const qFRC_settle = await this.queryFactory.runQuery(
      `SELECT close settle FROM "b3-summary" WHERE "asset-code"=$1 AND contract=$2 AND date::DATE=$3`,
      {
        asset: 'FRC',
        contract: contratNext.code,
        dateRef: previousTradeDate.toJSDate(),
      },
    );

    const qPTAX = await this.queryFactory.runQuery(
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
    const diffDays = contract.dateExpiry.diff(dateRef, 'day').days - 1;
    const diffBizDays =
      (await ReportLoaderCalendar.differenceInTradeDays(
        this.queryFactory,
        contract.dateExpiry,
        dateRef,
        TCountryCode.BR,
      )) - 1;

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
    };
  }
}

export {
  QueryOptions,
  TFRPCalculationType,
  TContract,
  IContract,
  IFRP,
  IOIOptionsBorders,
};
