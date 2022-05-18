/* eslint-disable no-restricted-syntax */
import { DateTime } from 'luxon';
import TelegramBot, { TUserType } from '../../bot/telegramBot';
import Query from './query';
import QueryPlayers from './queryPlayers';

interface ISpot {
  date: DateTime;
  spot: number;
  frp0: number | { today: number; accumulated: number };
  future: number;
  volume: number;
}

interface ISpotSettleDate {
  priorDays: ISpot[];
  today: ISpot;
}

export default class QuerySPOT extends Query {
  public async process(
    params: { dateRef: DateTime; chatId?: number; messageId?: number },
    today = true,
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
      msgHeader = `SPOT SETTLE DATE USD - Date: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )}\n`;
    }

    let botResponse;
    if (spot) {
      if (!today) {
        spot.priorDays = await Promise.all(
          await spot.priorDays.map(async (d: any): Promise<any> => {
            const p = d;
            p.playersBal = await new QueryPlayers(this.bot).getPlayersBalance(
              <DateTime>d.date,
              [
                { asset: 'DOL', weight: 1 },
                { asset: 'WDO', weight: 0.2 },
              ],
            );
            return p;
          }),
        );

        if (
          (<DateTime>spot.today.date).startOf('day').toMillis() !==
          DateTime.now().startOf('day').toMillis()
        ) {
          spot.today.playersBal = await new QueryPlayers(
            this.bot,
          ).getPlayersBalance(<DateTime>spot.today.date, [
            { asset: 'DOL', weight: 1 },
            { asset: 'WDO', weight: 0.2 },
          ]);
        }
      }

      botResponse = TelegramBot.printJSON(spot);
    } else botResponse = 'Not enought data.';

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
      `SELECT spot.tcam as tcam, ROUND(spot."total-finVol"/50000, 2) as volume
      FROM "b3-spotexchange-intraday" as spot
      WHERE spot.date::DATE=$1::DATE 
      ORDER BY spot."timestamp-load" DESC LIMIT 1`,
      {
        date: dateRef.toJSDate(),
      },
    );

    if (qSpot && qSpot.length > 0) {
      return {
        date: dateRef,
        spot: +(Number(qSpot[0].tcam) * 1000).toFixed(2),
        frp0,
        future: +(Number(qSpot[0].tcam) * 1000 + frp0).toFixed(2),
        volume: +Number(qSpot[0].volume).toFixed(),
      };
    }
    return undefined;
  }

  public async calculateSpotForSettleDate(
    dateRef: DateTime,
  ): Promise<ISpotSettleDate | undefined> {
    let qFRP0: any[];
    let aFRP0: { date: DateTime; frp0: number }[] | undefined = [];
    if (
      dateRef.startOf('day').toMillis() ===
      DateTime.now().startOf('day').toMillis()
    ) {
      qFRP0 = await this.queryFactory.runQuery(
        `(SELECT "ts-trade"::DATE as date, (MAX(price) + MIN(price))/2 as frp0 
        FROM "intraday-trades" WHERE "ts-trade"::DATE = $1::DATE AND asset='FRP0'
        GROUP BY "ts-trade"::DATE) 
        UNION 
        (SELECT "timestamp-open"::DATE date, (MAX(high) + MIN(low))/2 as frp0 
        FROM "b3-ts-summary" WHERE "timestamp-open"::DATE <= $1::DATE AND asset='FRP0'
        GROUP BY "timestamp-open"::DATE ORDER BY "timestamp-open"::DATE DESC LIMIT 2)
        ORDER BY 1 ASC`,
        { date: dateRef.toJSDate() },
      );
      aFRP0 =
        qFRP0 && qFRP0.length === 3
          ? qFRP0.map(q => {
              return {
                date: DateTime.fromJSDate(q.date),
                frp0: +Number(q.frp0).toFixed(2),
              };
            })
          : undefined;

      if (!aFRP0) {
        // consider frp0 d0 = frp1 d-1 if exists. Otherwise, frp0 d-1
        qFRP0 = await this.queryFactory.runQuery(
          `SELECT q0.date date, COALESCE(q0.pmo, 0) frp0, COALESCE(q1.pmo, 0) frp1 FROM 
          (SELECT "timestamp-open"::DATE date, MAX(high) h, MIN(low) l, (MAX(high) + MIN(low))/2 pmo FROM "b3-ts-summary" bts WHERE asset = 'FRP0' AND "timestamp-open"::DATE<$1::DATE GROUP BY "timestamp-open"::DATE order by "timestamp-open"::DATE desc limit 2) q0
          LEFT JOIN
          (SELECT "timestamp-open"::DATE date, MAX(high) h, MIN(low) l, (MAX(high) + MIN(low))/2 pmo FROM "b3-ts-summary" bts WHERE asset = 'FRP1' AND "timestamp-open"::DATE<$1::DATE GROUP BY "timestamp-open"::DATE order by "timestamp-open"::DATE desc limit 2) q1
          ON (q0.date = q1.date) ORDER BY date DESC`,
          { date: dateRef.toJSDate() },
        );

        aFRP0 =
          qFRP0 && qFRP0.length === 2
            ? [
                {
                  date: dateRef,
                  frp0:
                    Number(qFRP0[0].frp1) > 0
                      ? +Number(qFRP0[0].frp1).toFixed(2)
                      : +Number(qFRP0[0].frp0).toFixed(2),
                },
                {
                  date: DateTime.fromJSDate(qFRP0[0].date),
                  frp0: +Number(qFRP0[0].frp0).toFixed(2),
                },
                {
                  date: DateTime.fromJSDate(qFRP0[1].date),
                  frp0: +Number(qFRP0[1].frp0).toFixed(2),
                },
              ]
            : undefined;
      }
    } else {
      qFRP0 = await this.queryFactory.runQuery(
        `SELECT "timestamp-open"::DATE date, (MAX(high) + MIN(low))/2 as frp0 
        FROM "b3-ts-summary" WHERE "timestamp-open"::DATE <= $1::DATE AND asset='FRP0'
        GROUP BY "timestamp-open"::DATE 
        ORDER BY "timestamp-open"::DATE ASC LIMIT 3`,
        { date: dateRef.toJSDate() },
      );
      aFRP0 =
        qFRP0 && qFRP0.length === 3
          ? qFRP0.map(q => {
              return {
                date: DateTime.fromJSDate(q.date),
                frp0: +Number(q.frp0).toFixed(2),
              };
            })
          : undefined;
    }

    if (!aFRP0) return undefined;

    const qSpot = await this.queryFactory.runQuery(
      `(SELECT spot.date::DATE as date, spot."avgrate-d1-tcam" tcam, 
      ROUND(spot."hiringvol-d1-brlFinVol"/(spot."avgrate-d1-tcam"*50000),2) volume
      FROM "b3-spotexchange" spot
      WHERE spot."avgrate-d1-settledate"::DATE=$1)
      UNION
      (SELECT spot.date::DATE as date, spot."avgrate-d2-tcam" tcam, 
      ROUND(spot."hiringvol-d2-brlFinVol"/(spot."avgrate-d2-tcam"*50000),2) volume
      FROM "b3-spotexchange" spot
      WHERE spot."avgrate-d2-settledate"::DATE=$1)
      ORDER BY 1 ASC`,
      {
        date: dateRef.toJSDate(),
      },
    );

    if (qSpot && qSpot.length > 0) {
      for await (const spot of qSpot)
        if (
          !aFRP0.find(
            f =>
              f.date.startOf('day').toMillis() ===
              (<DateTime>spot.date).startOf('day').toMillis(),
          )
        )
          return undefined;

      const d1d2: ISpot[] = await Promise.all(
        qSpot.map(async (spot: any): Promise<ISpot> => {
          const { frp0 } = aFRP0!.find(
            f =>
              f.date.startOf('day').toMillis() ===
              (<DateTime>spot.date).startOf('day').toMillis(),
          )!;
          return {
            date: DateTime.fromJSDate(spot.date),
            spot: +(Number(spot.tcam) * 1000).toFixed(2),
            frp0,
            future: +(Number(spot.tcam) * 1000 + frp0).toFixed(2),
            volume: +Number(spot.volume).toFixed(2),
          };
        }),
      );

      const sumVol = d1d2
        .map((d: any) => d.volume)
        .reduce((tot: number, vol: number) => tot + vol, 0);

      const sumPriceVol = d1d2
        .map((d: any) => d.spot * d.volume)
        .reduce((tot: number, pricevol: any) => tot + pricevol, 0);

      const sumFRP0 = aFRP0.reduce(
        (tot: number, frp0: any) => tot + frp0.frp0,
        0,
      );

      return {
        priorDays: d1d2,
        today: {
          date: DateTime.fromFormat(
            dateRef.toFormat('dd/MM/yyyy'),
            'dd/MM/yyyy',
          ),
          spot: +Number(+(sumPriceVol / sumVol).toFixed(2)),
          frp0: {
            today: aFRP0.find(
              f =>
                f.date.startOf('day').toMillis() ===
                dateRef.startOf('day').toMillis(),
            )!.frp0,
            accumulated: sumFRP0 > 0 ? sumFRP0 : 0,
          },
          future: +Number(
            sumPriceVol / sumVol + (sumFRP0 > 0 ? sumFRP0 : 0),
          ).toFixed(2),
          volume: +Number(sumVol).toFixed(2),
        },
      };
    }
    return undefined;
  }
}

export { ISpot, ISpotSettleDate };
