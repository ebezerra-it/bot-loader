/* eslint-disable camelcase */
/* eslint-disable no-nested-ternary */
import { DateTime } from 'luxon';
import Query from './query';
import BaseBot, { TUserType } from '../../bot/baseBot';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { TCountryCode } from '../tcountry';
import { QueryFactory } from '../../db/queryFactory';
import QueryFRP0, { TContractType } from './queryFRP0';

interface IContract {
  code: string;
  firstTradeDate: DateTime | undefined;
  dateBeginVigency: DateTime;
  lastTradeDate: DateTime;
  dateExpiry: DateTime;
}

interface IFRP {
  contract: IContract;
  traded: { vwap: number; pmo: number } | undefined;
  calculated: number | undefined;
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
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    const usdOpts = await this.calculateOIOptionsVWAP(params.dateRef);
    const msgHeader = `USD OPTIONS - Date: ${params.dateRef.toFormat(
      'dd/MM/yyyy',
    )}\n`;

    let botResponse;
    if (usdOpts) botResponse = BaseBot.printJSON(usdOpts);
    else botResponse = 'Not enought data.';

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

    return !!usdOpts;
  }

  public async calculateOIOptionsVWAP(dateRef: DateTime): Promise<
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
    /* const frp_c1 = await this.getFRP(dateRef, dateRef, TContractType.CURRENT);
    if (!frp_c1) return undefined;

    const frp_c2 = await this.getFRP(
      dateRef,
      frp_c1.contract.dateExpiry,
      TContractType.CURRENT,
    );
    if (!frp_c2) return undefined; */
    const frp_c1 = await QueryFRP0.getFRP(
      this.queryFactory,
      dateRef,
      true,
      TContractType.CURRENT,
    );
    if (!frp_c1) return undefined;
    const frp_c2 = await QueryFRP0.getFRP(
      this.queryFactory,
      dateRef,
      true,
      TContractType.NEXT,
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
        ? frp_c1.calculated
        : 0
      : 0;

    const frp0_c2 = frp_c2
      ? frp_c2.traded
        ? frp_c2.traded.vwap
        : frp_c2.calculated
        ? frp_c2.calculated
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
    contractType: TContractType,
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
    contractType: TContractType,
  ): Promise<IFRP | undefined> {
    return QueryFRP0.getFRP(this.queryFactory, dateRef, true, contractType);
  }
}

export { QueryOptions, IContract, IFRP, IOIOptionsBorders };
