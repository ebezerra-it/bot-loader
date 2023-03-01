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
    let qFRP0: any[];
    let aFRP0: { date: DateTime; frp0: number; volume: number }[] | undefined;
    const priorDays = _priorDays < 2 ? 2 : _priorDays;
    if (
      dateRef.startOf('day').toMillis() ===
        DateTime.now().startOf('day').toMillis() &&
      !frp1
    ) {
      qFRP0 = await this.queryFactory.runQuery(
        `(SELECT datetime::DATE as date, (high + low)/2 as frp0, volume 
        FROM "b3-assetsquotes" 
        WHERE datetime<$1 AND datetime::DATE = $1::DATE AND asset='FRP0'
        ORDER BY datetime DESC LIMIT 1) 
        UNION 
        (SELECT "timestamp-open"::DATE date, 
        (MAX(high) + MIN(low))/2 as frp0, 
        SUM(volume) as volume 
        FROM "b3-ts-summary" 
        WHERE "timestamp-open"::DATE < $1::DATE AND asset='FRP0'
        GROUP BY "timestamp-open"::DATE 
        ORDER BY "timestamp-open"::DATE DESC 
        LIMIT ${priorDays - 1})
        ORDER BY 1 DESC`,
        { date: dateRef.toJSDate() },
      );

      aFRP0 =
        qFRP0 && qFRP0.length === priorDays
          ? qFRP0.map(q => {
              return {
                date: DateTime.fromJSDate(q.date),
                frp0: +Number(q.frp0).toFixed(2),
                volume: Number(q.volume),
              };
            })
          : undefined;

      if (!aFRP0) {
        // consider frp0 d0 = frp1 d-1 if exists. Otherwise, frp0 d-1
        // d0 volume estimated by previous 3 days avarage, excluding daily volume of 30k or above
        qFRP0 = await this.queryFactory.runQuery(
          `SELECT date, COALESCE(pmo, 0) frp0, COALESCE(volume, 0) volume FROM 
            (SELECT "timestamp-open"::DATE date, (MAX(high) + MIN(low))/2 pmo, SUM(volume) as volume FROM "b3-ts-summary" WHERE asset = 'FRP0' AND "timestamp-open"::DATE<$1::DATE GROUP BY "timestamp-open"::DATE ORDER BY "timestamp-open"::DATE DESC LIMIT ${priorDays}) q0
            UNION 
            SELECT q1.date, q1.pmo, avg(q2.volume) volume FROM 
            (SELECT $1::DATE date, MAX(high) h, MIN(low) l, (MAX(high) + MIN(low))/2 pmo FROM "b3-ts-summary" WHERE asset = 'FRP1' AND "timestamp-open"::DATE<$1::DATE GROUP BY "timestamp-open"::DATE ORDER BY "timestamp-open"::DATE DESC LIMIT 1) q1,
            (SELECT "timestamp-open"::DATE, SUM(volume) volume FROM "b3-ts-summary" WHERE asset = 'FRP0' AND "timestamp-open"::DATE<$1::DATE group by "timestamp-open"::DATE having sum(volume) < 30000 order by "timestamp-open"::DATE DESC LIMIT 3) 
            q2
            group by date, pmo
            ORDER BY date DESC`,
          { date: dateRef.toJSDate() },
        );

        if (qFRP0 && qFRP0.length === priorDays) {
          aFRP0 = qFRP0.map(q => {
            return {
              date: DateTime.fromJSDate(q.date),
              frp0: +Number(q.frp0).toFixed(2),
              volume: Number(q.volume),
            };
          });
        }
      }
    } else {
      qFRP0 = await this.queryFactory.runQuery(
        `SELECT "timestamp-open"::DATE date, 
        (MAX(high) + MIN(low))/2 as frp0, 
        SUM(volume) as volume
        FROM "b3-ts-summary" 
        WHERE "timestamp-open"::DATE <= $1::DATE AND asset='FRP0'
        GROUP BY "timestamp-open"::DATE 
        ORDER BY "timestamp-open"::DATE DESC 
        LIMIT ${priorDays}`,
        { date: dateRef.toJSDate() },
      );

      aFRP0 =
        qFRP0 && qFRP0.length === priorDays
          ? qFRP0.map(q => {
              return {
                date: DateTime.fromJSDate(q.date),
                frp0: +Number(q.frp0).toFixed(2),
                volume: Number(q.volume),
              };
            })
          : undefined;
    }

    if (!aFRP0) return undefined;

    const qPTAX = await this.queryFactory.runQuery(
      `SELECT "bcb-ptax".date::DATE as date, 
      "bcb-ptax"."pbrl_p1_sell" * 1000 as p1, p1_datetime as d1, 
      "bcb-ptax"."pbrl_p2_sell" * 1000 as p2, p2_datetime as d2, 
      "bcb-ptax"."pbrl_p3_sell" * 1000 as p3, p3_datetime as d3, 
      "bcb-ptax"."pbrl_p4_sell" * 1000 as p4, p4_datetime as d4, 
      "bcb-ptax"."pbrl_ptax_sell" * 1000 as ptax, ptax_datetime as dptax 
      FROM "bcb-ptax" 
      WHERE "bcb-ptax"."currency-code"='USD' AND 
      "bcb-ptax"."date"::DATE=ANY($1::DATE[])
      ORDER BY date DESC`,
      { date: aFRP0.map(f => f.date.toJSDate()) },
    );

    if (aFRP0.length < priorDays || qPTAX.length < priorDays) return undefined;

    const aPTAX: IDatePTAX[] = [];

    for (let i = 0; i < qPTAX.length; i++) {
      let ptax;

      if (
        qPTAX[i].ptax &&
        qPTAX[i].ptax > 0 &&
        qPTAX[i].dptax &&
        qPTAX[i].dptax.getTime() <= dateRef.toMillis()
      )
        ptax = qPTAX[i].ptax;
      else {
        const prevQty =
          (qPTAX[i].p1 &&
          qPTAX[i].d1 &&
          qPTAX[i].d1.getTime() <= dateRef.toMillis()
            ? 1
            : 0) +
          (qPTAX[i].p2 &&
          qPTAX[i].d2 &&
          qPTAX[i].d2.getTime() <= dateRef.toMillis()
            ? 1
            : 0) +
          (qPTAX[i].p3 &&
          qPTAX[i].d3 &&
          qPTAX[i].d3.getTime() <= dateRef.toMillis()
            ? 1
            : 0) +
          (qPTAX[i].p4 &&
          qPTAX[i].d4 &&
          qPTAX[i].d4.getTime() <= dateRef.toMillis()
            ? 1
            : 0);

        ptax =
          ((qPTAX[i].p1 &&
          qPTAX[i].d1 &&
          qPTAX[i].d1.getTime() <= dateRef.toMillis()
            ? Number(qPTAX[i].p1)
            : 0) +
            (qPTAX[i].p2 &&
            qPTAX[i].d2 &&
            qPTAX[i].d2.getTime() <= dateRef.toMillis()
              ? Number(qPTAX[i].p2)
              : 0) +
            (qPTAX[i].p3 &&
            qPTAX[i].d3 &&
            qPTAX[i].d3.getTime() <= dateRef.toMillis()
              ? Number(qPTAX[i].p3)
              : 0) +
            (qPTAX[i].p4 &&
            qPTAX[i].d4 &&
            qPTAX[i].d4.getTime() <= dateRef.toMillis()
              ? Number(qPTAX[i].p4)
              : 0)) /
          prevQty;
      }

      if (ptax) {
        const iFRP0 = aFRP0.find(
          f =>
            f.date.startOf('day').toMillis() ===
            DateTime.fromJSDate(qPTAX[i].date).startOf('day').toMillis(),
        )!;

        aPTAX.push({
          date: DateTime.fromJSDate(qPTAX[i].date),
          ptax_spot: +Number(ptax).toFixed(2),
          ptax_future: +(Number(ptax) + iFRP0.frp0).toFixed(2),
          frp0: iFRP0.frp0,
          volume: iFRP0.volume,
        });
      }
    }
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
          ? resPTAX.frp0.calculated.close_d1
          : undefined;
      if (frp0Value) {
        const ptaxProjections = this.getPTAXProjections(
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
      /* const frp0Next = await QueryFRP0.getFRP0(
        this.queryFactory,
        dateRef,
        true,
        TContractType.NEXT,
      ); */
      const frp0NextValue =
        resPTAX.frp0Next && resPTAX.frp0Next.calculated
          ? resPTAX.frp0Next.calculated.close_d1 &&
            resPTAX.frp0Next.calculated.close_d1 > 0
            ? resPTAX.frp0Next.calculated.close_d1
            : resPTAX.frp0Next.calculated.settle_d1 &&
              resPTAX.frp0Next.calculated.settle_d1 > 0
            ? resPTAX.frp0Next.calculated.settle_d1
            : undefined
          : undefined;

      if (frp0NextValue) {
        const frp0NextProjections = this.getPTAXProjections(
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
    const frp0 = await QueryFRP0.getFRP0(
      this.queryFactory,
      dateRef,
      prefD1FRP1,
      TContractType.CURRENT,
    );
    if (!frp0) return undefined;

    const frp0Next = await QueryFRP0.getFRP0(
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
          ? resPTAX.frp0.calculated.close_d1
          : undefined;
      if (frp0Value) {
        const ptaxProjections = this.getPTAXProjections(
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
          ? resPTAX.frp0Next.calculated.close_d1 &&
            resPTAX.frp0Next.calculated.close_d1 > 0
            ? resPTAX.frp0Next.calculated.close_d1
            : resPTAX.frp0Next.calculated.settle_d1 &&
              resPTAX.frp0Next.calculated.settle_d1 > 0
            ? resPTAX.frp0Next.calculated.settle_d1
            : undefined
          : undefined;

      if (frp0NextValue) {
        const frp0NextProjections = this.getPTAXProjections(
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

    const qPTAX = await this.queryFactory.runQuery(
      `SELECT "bcb-ptax"."pbrl_ptax_sell" * 1000 as ptax
      FROM "bcb-ptax" 
      WHERE "bcb-ptax"."currency-code"='USD' AND 
      "bcb-ptax"."date"::DATE=$1::DATE
      ORDER BY date DESC`,
      { date: d1Date.toJSDate() },
    );
    if (!qPTAX || qPTAX.length === 0) return undefined;

    const prefD1FRP1 = true;
    const frp0 = await QueryFRP0.getFRP0(
      this.queryFactory,
      dateRef,
      prefD1FRP1,
      TContractType.CURRENT,
    );
    if (!frp0) return undefined;

    const frp0Next = await QueryFRP0.getFRP0(
      this.queryFactory,
      dateRef,
      prefD1FRP1,
      TContractType.NEXT,
    );

    return {
      date: dateRef,
      ptax: +Number(qPTAX[0].ptax).toFixed(2),
      frp0,
      frp0Next,
    };

    /* const frp0Value = frp0.traded
      ? frp0.traded.vwap
      : frp0.calculated
      ? frp0.calculated.close_d1
      : undefined;

    if (!frp0Value) return undefined;

    let ptaxProjections: any | undefined;
    if (projectionsQtty && projectionsMultiplier) {
      ptaxProjections = this.getPTAXProjections(
        Number(qPTAX[0].ptax),
        frp0Value,
        projectionsQtty,
        projectionsMultiplier,
      );
    }

    return {
      date: dateRef,
      positive: ptaxProjections ? ptaxProjections.positive : undefined,
      ptax: Number(qPTAX[0].ptax),
      negative: ptaxProjections ? ptaxProjections.negative : undefined,
      frp0,
      frp0_multiplier: projectionsMultiplier,
    }; */
  }

  private getPTAXProjections(
    ptax: number,
    frp0: number,
    qtty: number,
    multiplier: number,
  ): { positive: number[]; negative: number[] } | undefined {
    if (
      Number.isNaN(ptax) ||
      Number.isNaN(frp0) ||
      Number.isNaN(qtty) ||
      Number.isNaN(multiplier) ||
      frp0 <= 0 ||
      ptax <= 0 ||
      qtty <= 0 ||
      multiplier <= 0
    )
      throw new Error(
        `getPTAXProjections() - Wrong parameters - FRP0: ${frp0} - SPOT: ${ptax} - QTTY: ${qtty} - MULTIPLIER: ${multiplier}`,
      );

    if (qtty === 1) return undefined;

    const positive: number[] = [];
    const negative: number[] = [];
    for (let i = 1; i <= qtty; i++) {
      positive.push(+Number(ptax + i * frp0 * multiplier).toFixed(2));
      negative.push(+Number(ptax - i * frp0 * multiplier).toFixed(2));
    }
    return {
      positive: positive.sort().reverse(),
      negative: negative.sort().reverse(),
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
      FROM "bcb-ptax" WHERE date::DATE=$1::DATE`,
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
        FROM "bcb-ptax" WHERE date::DATE<$1::DATE LIMIT 1`,
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
