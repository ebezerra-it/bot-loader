/* eslint-disable no-nested-ternary */
/* eslint-disable camelcase */
/* eslint-disable no-restricted-syntax */
import { DateTime } from 'luxon';
import BaseBot, { TUserType } from '../../bot/baseBot';
import Query from './query';
import QueryFRP0, { TContractType, IFRP } from './queryFRP0';

interface ISpot {
  date: DateTime;
  high: number;
  low: number;
  close: number;
  vwap: number;
  frp0: IFRP;
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
      spot = await this.calculateSpotForSettleDate(params.dateRef);
      if (spot)
        spot.vwapProjectionsD1 = QueryFRP0.getFRPProjections(
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
    if (spot) botResponse = BaseBot.printJSON(spot);
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

    const frp0 = await QueryFRP0.getFRP(
      this.queryFactory,
      dateRef,
      true,
      TContractType.CURRENT,
    );
    if (!frp0) return undefined;

    const qSpot = await this.queryFactory.runQuery(
      `SELECT spot.tcam as tcam, spot.volume as volume, q.high, q.low
      FROM 
      (SELECT tcam, ROUND("total-finVol"/50000, 2) as volume from "b3-spotexchange-intraday" WHERE "timestamp-load"<=$1 AND date::DATE=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) spot, 
      (select max(h) high, min(l) low from (
      select h, l from (select "time08-high" h, "time08-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time09-high" h, "time09-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union 
      select h, l from (select "time10-high" h, "time10-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time11-high" h, "time11-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time12-high" h, "time12-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time13-high" h, "time13-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time14-high" h, "time14-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time15-high" h, "time15-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time16-high" h, "time16-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time17-high" h, "time17-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time18-high" h, "time18-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q union
      select h, l from (select "time19-high" h, "time19-low" l  from  "b3-spotexchange-intraday" where "timestamp-load"<=$1 AND date=$1::DATE ORDER BY "timestamp-load" DESC LIMIT 1) q
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
        close: 0, // Not used for Spot hired today
        frp0,
        volume: +Number(qSpot[0].volume).toFixed(),
      };
    }
    return undefined;
  }

  public async calculateSpotForSettleDate(
    dateRef: DateTime,
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

    const aSpot: ISpot[] = [];

    for (let i = 0; i < qSpot.length; i++) {
      const date = DateTime.fromJSDate(qSpot[i].date);
      const frp = await QueryFRP0.getFRP(
        this.queryFactory,
        date.endOf('day'),
        true,
        TContractType.CURRENT,
      );
      if (!frp) return undefined;

      aSpot.push({
        date,
        high: +(Number(qSpot[i].high) * 1000).toFixed(2),
        low: +(Number(qSpot[i].low) * 1000).toFixed(2),
        close: +(Number(qSpot[i].close) * 1000).toFixed(2),
        vwap: +(Number(qSpot[i].tcam) * 1000).toFixed(2),
        volume: Number(qSpot[i].volume),
        frp0: frp,
      });
    }

    const sumVol = aSpot
      .map((d: any) => d.volume)
      .reduce((tot: number, vol: number) => tot + vol, 0);

    const sumPVVwap = aSpot
      .map((d: any) => d.vwap * d.volume)
      .reduce((tot: number, pricevol: any) => tot + pricevol, 0);

    const sumPVHigh = aSpot
      .map((d: any) => d.high * d.volume)
      .reduce((tot: number, pricevol: any) => tot + pricevol, 0);

    const sumPVLow = aSpot
      .map((d: any) => d.low * d.volume)
      .reduce((tot: number, pricevol: any) => tot + pricevol, 0);

    const sumPVClose = aSpot
      .map((d: any) => d.close * d.volume)
      .reduce((tot: number, pricevol: any) => tot + pricevol, 0);

    const spotToday = aSpot.find(
      f =>
        f.date.startOf('day').toMillis() === dateRef.startOf('day').toMillis(),
    );
    let frp0Today: IFRP | undefined;
    if (!spotToday) {
      frp0Today = await QueryFRP0.getFRP(
        this.queryFactory,
        dateRef,
        true,
        TContractType.CURRENT,
      );
    } else {
      frp0Today = spotToday.frp0;
    }

    if (!frp0Today) return undefined;

    return {
      priorDays: aSpot,
      today: {
        date: DateTime.fromFormat(dateRef.toFormat('dd/MM/yyyy'), 'dd/MM/yyyy'),
        high: +Number(+(sumPVHigh / sumVol).toFixed(2)),
        vwap: +Number(+(sumPVVwap / sumVol).toFixed(2)),
        low: +Number(+(sumPVLow / sumVol).toFixed(2)),
        close: +Number(+(sumPVClose / sumVol).toFixed(2)),
        frp0: frp0Today,
        volume: +Number(sumVol).toFixed(2),
      },
    };
  }
}

export { ISpot, ISpotSettleDate };
