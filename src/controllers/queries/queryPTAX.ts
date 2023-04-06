/* eslint-disable no-nested-ternary */
/* eslint-disable camelcase */
import { DateTime } from 'luxon';
import { QueryFactory } from '../../db/queryFactory';
import BaseBot, { TUserType } from '../../bot/baseBot';
import Query from './query';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { TCountryCode } from '../tcountry';
import QueryFRP0, { IFRP, TContractType } from './queryFRP0';

interface IDatePTAX {
  date: DateTime;
  ptax_spot: number;
  ptax_future: number;
  frp0: number;
  volume: number;
}

interface IMergedPTAX {
  date: DateTime;
  ptax_future_vwap: number;
  ptax_future_avg: number;
  ptax_spot_vwap: number;
  ptax_spot_avg: number;
  volume: number;
}

interface IPTAX {
  date: DateTime;
  ptax: number;
  frp0: IFRP;
  frp0Next: IFRP | undefined;
}

interface IQueryPTAX {
  datesPTAX: IDatePTAX[];
  mergedPTAX: IMergedPTAX;
}

export default class QueryPTAX extends Query {
  public async process(params: {
    dateRef: DateTime;
    priorDays?: number;
    projectionsQtty?: number;
    projectionsMultiplier?: number;
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    let resQueryPTAX: any;
    let msgHeader;

    if (params.priorDays) {
      msgHeader = `PTAX USD - Date: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )} - Days: ${params.priorDays}\n`;

      const resPTAX: IQueryPTAX | undefined = await this.calculateAverage(
        params.dateRef,
        params.priorDays && params.priorDays > 0 ? params.priorDays : 2,
      );
      resQueryPTAX = { ...resPTAX };
    } else if (params.projectionsQtty && params.projectionsMultiplier) {
      msgHeader = `PTAX PROJECTIONS - Date: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )}\n`;
      resQueryPTAX = await this.calculatePTAXD1(
        params.dateRef,
        params.projectionsQtty,
        params.projectionsMultiplier,
      );
    }

    let botResponse;
    if (resQueryPTAX) botResponse = BaseBot.printJSON(resQueryPTAX);
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
    return !!resQueryPTAX;
  }

  public async calculateAverage(
    dateRef: DateTime,
    priorDays = 2,
  ): Promise<IQueryPTAX | undefined> {
    const datesPTAX: IDatePTAX[] | undefined = await this.calcPTAXDates(
      dateRef,
      priorDays >= 0 ? priorDays : 2,
    );

    if (!datesPTAX) return undefined;

    const mergedPTAX = QueryPTAX.mergePTAX(dateRef, datesPTAX);

    const resPTAX: IQueryPTAX = {
      datesPTAX,
      mergedPTAX,
    };

    return resPTAX;
  }

  public async calcPTAXDates(
    dateRef: DateTime,
    _priorDays = 2,
    frp1 = false,
  ): Promise<IDatePTAX[] | undefined> {
    const aPTAX: IDatePTAX[] = [];
    const priorDays = _priorDays < 2 ? 2 : _priorDays;

    let date = dateRef;
    for (let i = 0; i < priorDays; i++) {
      date = await ReportLoaderCalendar.subTradeDays(
        this.queryFactory,
        date,
        1,
        TCountryCode.BR,
      );
      if (date.toMillis() < dateRef.toMillis()) date = date.endOf('day');

      const frp = await QueryFRP0.getFRP(
        this.queryFactory,
        date,
        frp1,
        TContractType.CURRENT,
      );
      if (frp && (frp.traded || frp.calculated)) {
        const frpValue = +Number(
          frp.traded ? frp.traded.vwap : frp.calculated ? frp.calculated : 0,
        ).toFixed(2);

        if (frpValue > 0) {
          const ptax = await QueryPTAX.getPTAX(this.queryFactory, date);
          if (ptax) {
            aPTAX.push({
              date,
              ptax_spot: ptax,
              ptax_future: +Number(ptax + frpValue).toFixed(2),
              frp0: frpValue,
              volume: frp.traded ? frp.traded.volume : 0,
            });
          }
        }
      }
    }

    if (!aPTAX || aPTAX.length < priorDays) return undefined;
    return aPTAX;
  }

  public static mergePTAX(dateRef: DateTime, ptax: IDatePTAX[]): IMergedPTAX {
    let sumFut = 0.0;
    let sumSpot = 0.0;
    let pvFut = 0.0;
    let pvSpot = 0.0;
    let sumVol = 0.0;

    ptax.forEach(p => {
      pvFut += p.ptax_future * p.volume;
      pvSpot += p.ptax_spot * p.volume;
      sumFut += p.ptax_future;
      sumSpot += p.ptax_spot;
      sumVol += p.volume;
    });

    const res: IMergedPTAX = {
      date: dateRef,
      ptax_future_avg: +Number(sumFut / ptax.length).toFixed(2),
      ptax_spot_avg: +Number(sumSpot / ptax.length).toFixed(2),
      ptax_future_vwap: +Number(pvFut / sumVol).toFixed(2),
      ptax_spot_vwap: +Number(pvSpot / sumVol).toFixed(2),
      volume: sumVol,
    };

    return res;
  }

  public async calculatePTAXD1(
    dateRef: DateTime,
    projectionsQtty: number,
    projectionsMultiplier: number,
  ): Promise<any> {
    let resQueryPTAX;
    const resPTAX = await this.getD1PTAX(dateRef);
    if (resPTAX) {
      const frp0Value =
        resPTAX.frp0 && resPTAX.frp0.traded
          ? resPTAX.frp0.traded.vwap
          : resPTAX && resPTAX.frp0 && resPTAX.frp0.calculated
          ? resPTAX.frp0.calculated
          : undefined;
      if (frp0Value) {
        const ptaxProjections = QueryFRP0.getFRPProjections(
          resPTAX.ptax,
          frp0Value,
          projectionsQtty,
          projectionsMultiplier,
        );
        resQueryPTAX = {
          date: dateRef,
          positive: ptaxProjections!.positive,
          ptax: resPTAX.ptax,
          negative: ptaxProjections!.negative,
          frp0Value,
          frp0: resPTAX.frp0,
        };
      }

      const frp0NextValue =
        resPTAX.frp0Next &&
        resPTAX.frp0Next.calculated &&
        resPTAX.frp0Next.calculated > 0
          ? resPTAX.frp0Next.calculated
          : undefined;

      if (frp0NextValue) {
        const frp0NextProjections = QueryFRP0.getFRPProjections(
          resPTAX.ptax,
          frp0NextValue,
          projectionsQtty,
          projectionsMultiplier,
        );
        resQueryPTAX = {
          ...resQueryPTAX,
          frp0Next: {
            positive: frp0NextProjections!.positive,
            ptax: resPTAX.ptax,
            frp0NextValue,
            negative: frp0NextProjections!.negative,
            frp0Next: resPTAX.frp0Next,
          },
        };
      }
    }
    return resQueryPTAX;
  }

  public async processPTAXD0(params: {
    dateRef: DateTime;
    projectionsQtty: number;
    projectionsMultiplier: number;
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    const msgHeader = `PTAX USD - Date: ${params.dateRef.toFormat(
      'dd/MM/yyyy HH:mm:ss',
    )}\n`;

    const resQueryPTAX = await this.calculatePTAXD0(
      params.dateRef,
      params.projectionsQtty,
      params.projectionsMultiplier,
    );

    let botResponse;
    if (resQueryPTAX) botResponse = BaseBot.printJSON(resQueryPTAX);
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
    return !!resQueryPTAX;
  }

  public async getD0PTAX(dateRef: DateTime): Promise<IPTAX | undefined> {
    const ptax = await QueryPTAX.getPTAX(this.queryFactory, dateRef);

    if (!ptax || ptax === 0) return undefined;

    const prefD1FRP1 = false;
    const frp0 = await QueryFRP0.getFRP(
      this.queryFactory,
      dateRef,
      prefD1FRP1,
      TContractType.CURRENT,
    );
    if (!frp0) return undefined;

    const frp0Next = await QueryFRP0.getFRP(
      this.queryFactory,
      dateRef,
      prefD1FRP1,
      TContractType.NEXT,
    );

    return {
      date: dateRef,
      ptax,
      frp0,
      frp0Next,
    };
  }

  public async calculatePTAXD0(
    dateRef: DateTime,
    projectionsQtty: number,
    projectionsMultiplier: number,
  ): Promise<any> {
    let resQueryPTAX;
    const resPTAX = await this.getD0PTAX(dateRef);
    if (resPTAX) {
      const frp0Value =
        resPTAX.frp0 && resPTAX.frp0.traded
          ? resPTAX.frp0.traded.vwap
          : resPTAX && resPTAX.frp0 && resPTAX.frp0.calculated
          ? resPTAX.frp0.calculated
          : undefined;
      if (frp0Value) {
        const ptaxProjections = QueryFRP0.getFRPProjections(
          resPTAX.ptax,
          frp0Value,
          projectionsQtty,
          projectionsMultiplier,
        );
        resQueryPTAX = {
          date: dateRef,
          positive: ptaxProjections!.positive,
          ptax: resPTAX.ptax,
          negative: ptaxProjections!.negative,
          frp0Value,
          frp0: resPTAX.frp0,
        };
      }

      const frp0NextValue =
        resPTAX.frp0Next && resPTAX.frp0Next.calculated
          ? resPTAX.frp0Next.calculated && resPTAX.frp0Next.calculated > 0
            ? resPTAX.frp0Next.calculated
            : undefined
          : undefined;

      if (frp0NextValue) {
        const frp0NextProjections = QueryFRP0.getFRPProjections(
          resPTAX.ptax,
          frp0NextValue,
          projectionsQtty,
          projectionsMultiplier,
        );
        resQueryPTAX = {
          ...resQueryPTAX,
          frp0Next: {
            positive: frp0NextProjections!.positive,
            ptax: resPTAX.ptax,
            frp0NextValue,
            negative: frp0NextProjections!.negative,
            frp0Next: resPTAX.frp0Next,
          },
        };
      }
    }
    return resQueryPTAX;
  }

  public async getD1PTAX(dateRef: DateTime): Promise<IPTAX | undefined> {
    if (
      dateRef.weekday === 6 ||
      dateRef.weekday === 7 ||
      !(await ReportLoaderCalendar.isTradeDay(
        this.queryFactory,
        dateRef,
        TCountryCode.BR,
      ))
    )
      return undefined;

    const d1Date = await ReportLoaderCalendar.subTradeDays(
      this.queryFactory,
      dateRef,
      1,
      TCountryCode.BR,
    );

    const ptax = await QueryPTAX.getPTAX(
      this.queryFactory,
      d1Date.endOf('day'),
    );
    if (!ptax || ptax === 0) return undefined;

    const prefD1FRP1 = true;
    const frp0 = await QueryFRP0.getFRP(
      this.queryFactory,
      dateRef,
      prefD1FRP1,
      TContractType.CURRENT,
    );
    if (!frp0) return undefined;

    const frp0Next = await QueryFRP0.getFRP(
      this.queryFactory,
      dateRef,
      prefD1FRP1,
      TContractType.NEXT,
    );

    return {
      date: dateRef,
      ptax: +Number(ptax).toFixed(2),
      frp0,
      frp0Next,
    };
  }

  public static async getPTAX(
    queryFactory: QueryFactory,
    dateRef: DateTime,
  ): Promise<number | undefined> {
    let qPTAX = await queryFactory.runQuery(
      `SELECT "bcb-ptax".date::DATE as date, 
      "bcb-ptax"."pbrl_p1_sell" * 1000 as p1, p1_datetime as d1, 
      "bcb-ptax"."pbrl_p2_sell" * 1000 as p2, p2_datetime as d2, 
      "bcb-ptax"."pbrl_p3_sell" * 1000 as p3, p3_datetime as d3, 
      "bcb-ptax"."pbrl_p4_sell" * 1000 as p4, p4_datetime as d4, 
      "bcb-ptax"."pbrl_ptax_sell" * 1000 as ptax, ptax_datetime as dptax 
      FROM "bcb-ptax" WHERE date::DATE = $1::DATE AND "currency-code" = 'USD'`,
      {
        dateRef: dateRef.toJSDate(),
      },
    );

    if (!qPTAX || qPTAX.length === 0) {
      qPTAX = await queryFactory.runQuery(
        `SELECT "bcb-ptax".date::DATE as date, 
        "bcb-ptax"."pbrl_p1_sell" * 1000 as p1, p1_datetime as d1, 
        "bcb-ptax"."pbrl_p2_sell" * 1000 as p2, p2_datetime as d2, 
        "bcb-ptax"."pbrl_p3_sell" * 1000 as p3, p3_datetime as d3, 
        "bcb-ptax"."pbrl_p4_sell" * 1000 as p4, p4_datetime as d4, 
        "bcb-ptax"."pbrl_ptax_sell" * 1000 as ptax, ptax_datetime as dptax  
        FROM "bcb-ptax" WHERE date::DATE < $1::DATE AND "currency-code" = 'USD' LIMIT 1`,
        {
          dateRef: dateRef.toJSDate(),
        },
      );
    }

    let ptax;
    if (
      qPTAX[0].ptax &&
      qPTAX[0].ptax > 0 &&
      qPTAX[0].dptax &&
      qPTAX[0].dptax.getTime() <= dateRef.toMillis()
    )
      ptax = qPTAX[0].ptax;
    else {
      const prevQty =
        (qPTAX[0].p1 &&
        qPTAX[0].d1 &&
        qPTAX[0].d1.getTime() <= dateRef.toMillis()
          ? 1
          : 0) +
        (qPTAX[0].p2 &&
        qPTAX[0].d2 &&
        qPTAX[0].d2.getTime() <= dateRef.toMillis()
          ? 1
          : 0) +
        (qPTAX[0].p3 &&
        qPTAX[0].d3 &&
        qPTAX[0].d3.getTime() <= dateRef.toMillis()
          ? 1
          : 0) +
        (qPTAX[0].p4 &&
        qPTAX[0].d4 &&
        qPTAX[0].d4.getTime() <= dateRef.toMillis()
          ? 1
          : 0);

      ptax =
        ((qPTAX[0].p1 &&
        qPTAX[0].d1 &&
        qPTAX[0].d1.getTime() <= dateRef.toMillis()
          ? Number(qPTAX[0].p1)
          : 0) +
          (qPTAX[0].p2 &&
          qPTAX[0].d2 &&
          qPTAX[0].d2.getTime() <= dateRef.toMillis()
            ? Number(qPTAX[0].p2)
            : 0) +
          (qPTAX[0].p3 &&
          qPTAX[0].d3 &&
          qPTAX[0].d3.getTime() <= dateRef.toMillis()
            ? Number(qPTAX[0].p3)
            : 0) +
          (qPTAX[0].p4 &&
          qPTAX[0].d4 &&
          qPTAX[0].d4.getTime() <= dateRef.toMillis()
            ? Number(qPTAX[0].p4)
            : 0)) /
        prevQty;
    }

    if (Number.isNaN(ptax) || ptax === 0) return undefined;
    return +Number(ptax).toFixed(2);
  }
}

export { IQueryPTAX, IPTAX };
