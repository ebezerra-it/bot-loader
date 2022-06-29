import { Router } from 'express';
import { DateTime } from 'luxon';
import { Logger } from 'tslog';
import QuerySPOT from '../controllers/queries/querySPOT';
import BaseRoutes from './baseRoutes';
import { IExchange, getExchange, TExchange } from '../controllers/tcountry';
import { QueryFactory } from '../db/queryFactory';
import TelegramBot from '../bot/telegramBot';

export default class LiveRoutes extends BaseRoutes {
  exchange: IExchange;

  constructor(queryfactory: QueryFactory, logger?: Logger, bot?: TelegramBot) {
    super(queryfactory, logger, bot);
    this.exchange = getExchange(TExchange.B3)!;
  }

  public async getRouter(): Promise<Router> {
    const router: Router = Router();

    router.post(
      '/uptquote',
      this.blockUnauthCall,
      async (req: any, res: any) => {
        const {
          asset,
          date,
          datetime,
          last,
          vwap,
          trades,
          volume,
          stddev,
          accumaggbal,
          openinterest,
          histvol,
        } = req.body;

        try {
          const dateRef = DateTime.fromFormat(date, 'dd/MM/yyyy');
          const qAsset = await this.queryfactory.runQuery(
            `SELECT * FROM "b3-dailyquotes" WHERE asset=$1 AND date=$2`,
            {
              asset,
              date: dateRef.toJSDate(),
            },
          );
          if (qAsset && qAsset.length > 0) {
            await this.queryfactory.runQuery(
              `UPDATE "b3-dailyquotes" SET datetime=$3, last=$4, vwap=$5, trades=$6, 
              volume=$7, stddev=$8, "acum-agg-bal"=$9, "open-interest"=$10, "hist-vol"=$11 
              WHERE asset=$1 AND date=$2`,
              {
                asset,
                date: dateRef.toJSDate(),
                datetime: DateTime.fromFormat(datetime, 'dd/MM/yyyy HH:mm:ss', {
                  zone: this.exchange.timezone,
                }).toJSDate(),
                last: Number(Number(last).toFixed(5)),
                vwap: Number(Number(vwap).toFixed(5)),
                trades: Number(Number(trades).toFixed(0)),
                volume: Number(Number(volume).toFixed(0)),
                stddev: Number(Number(stddev).toFixed(2)),
                accumaggbal: Number(Number(accumaggbal).toFixed(0)),
                openinterest: Number(Number(openinterest).toFixed(0)),
                histvol: Number(Number(histvol).toFixed(2)),
              },
            );
          } else {
            await this.queryfactory.runQuery(
              `INSERT INTO "b3-dailyquotes" (asset, date, datetime, last, vwap, trades, 
              volume, stddev, "acum-agg-bal", "open-interest", "hist-vol") 
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
              ON CONFLICT (asset, date) DO 
              UPDATE SET datetime=$3, last=$4, vwap=$5, trades=$6, volume=$7, stddev=$8, 
              "acum-agg-bal"=$9, "open-interest"=$10, "hist-vol"=$11`,
              {
                asset,
                date: dateRef.toJSDate(),
                datetime: DateTime.fromFormat(datetime, 'dd/MM/yyyy HH:mm:ss', {
                  zone: this.exchange.timezone,
                }).toJSDate(),
                last: Number(Number(last).toFixed(5)),
                vwap: Number(Number(vwap).toFixed(5)),
                trades: Number(Number(trades).toFixed(0)),
                volume: Number(Number(volume).toFixed(0)),
                stddev: Number(Number(stddev).toFixed(2)),
                accumaggbal: Number(Number(accumaggbal).toFixed(0)),
                openinterest: Number(Number(openinterest).toFixed(0)),
                histvol: Number(Number(histvol).toFixed(2)),
              },
            );
          }
        } catch (error) {
          this.logger.error(
            `[BOT-router] BOT route /uptquote exception: ${error.message}`,
          );
          return res
            .status(500)
            .send({ result: false, msg: `Exception thrown: ${error.message}` });
        }
        return res.status(200).send({ result: true });
      },
    );

    router.post(
      '/updtrolltrades',
      this.blockUnauthCall,
      async (req: any, res: any) => {
        const { asset, assetPrice, date, trades } = req.body;

        const checkLast = 5;
        if (trades && trades.length > 0) {
          const qLast = await this.queryfactory.runQuery(
            `SELECT asset, "ts-trade" as tstrade, "roll-price" as price, quantity, type, 
            buyer, seller FROM "intraday-trades" WHERE "ts-trade"::DATE=$1::DATE AND asset=$2 
            ORDER BY "id" DESC LIMIT ${checkLast}`,
            {
              tsTrade: DateTime.fromFormat(date, 'dd/MM/yyyy').toJSDate(),
              asset,
            },
          );

          let i = trades.length;
          if (qLast && qLast.length > 0) {
            for (i = 0; i < trades.length - qLast.length; i++) {
              let found = true;

              for (let j = 0; j < qLast.length; j++) {
                let tsTrade = DateTime.fromFormat(
                  `${date} ${trades[i + j].tstrade}`,
                  'dd/MM/yyyy HH:mm:ss.SSS',
                  { zone: this.exchange.timezone },
                );
                if (!tsTrade.isValid) {
                  tsTrade = DateTime.fromFormat(
                    trades[i + j].tstrade,
                    'dd/MM/yyyy HH:mm:ss.SSS',
                    { zone: this.exchange.timezone },
                  );
                }
                if (
                  tsTrade !== DateTime.fromJSDate(qLast[j].tstrade) ||
                  Number(trades[i + j].price) !== Number(qLast[j].price) ||
                  trades[i + j].type !== qLast[j].type ||
                  Number(trades[i + j].quantity) !==
                    Number(qLast[j].quantity) ||
                  trades[i + j].buyer !== qLast[j].buyer ||
                  trades[i + j].seller !== qLast[j].seller
                ) {
                  found = false;
                  break;
                }
              }
              if (found) break;
            }
          }

          for (let j = i - 1; j >= 0; j--) {
            try {
              let tsTrade = DateTime.fromFormat(
                `${date} ${trades[j].tstrade}`,
                'dd/MM/yyyy HH:mm:ss.SSS',
                { zone: this.exchange.timezone },
              );
              if (!tsTrade.isValid) {
                tsTrade = DateTime.fromFormat(
                  trades[j].tstrade,
                  'dd/MM/yyyy HH:mm:ss.SSS',
                  { zone: this.exchange.timezone },
                );
              }

              await this.queryfactory.runQuery(
                `INSERT INTO "intraday-trades" (asset, "ts-trade", 
                price, quantity, type, buyer, seller, "roll-price") 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) `,
                {
                  asset,
                  tsTrade: tsTrade.toJSDate(),
                  price: Number(trades[j].price) + Number(assetPrice),
                  quantity: Number(trades[j].quantity),
                  type: trades[j].type,
                  buyer: trades[j].buyer,
                  seller: trades[j].seller,
                  rollPrice: Number(trades[j].price),
                },
              );
            } catch (error) {
              this.logger.error(
                `[BOT-router] BOT route /updtrolltrades exception: ${error.message}`,
              );
              return res.status(500).send({
                result: false,
                msg: `Exception thrown: ${error.message}`,
              });
            }
          }
        }
        return res.status(200).send({ result: true });
      },
    );

    router.post(
      '/updttrades',
      this.blockUnauthCall,
      async (req: any, res: any) => {
        const { asset, date, trades } = req.body;

        let bQuerySpot = false;
        const checkLast = 5;
        if (trades && trades.length > 0) {
          const qLast = await this.queryfactory.runQuery(
            `SELECT asset, "ts-trade" as tstrade, price, quantity, type, 
            buyer, seller FROM "intraday-trades" WHERE "ts-trade"::DATE=$1::DATE AND asset=$2 
            ORDER BY "id" DESC LIMIT ${checkLast}`,
            {
              tsTrade: DateTime.fromFormat(date, 'dd/MM/yyyy').toJSDate(),
              asset,
            },
          );

          let i = trades.length;
          if (qLast && qLast.length > 0) {
            for (i = 0; i < trades.length - qLast.length; i++) {
              let found = true;

              for (let j = 0; j < qLast.length; j++) {
                let tsTrade = DateTime.fromFormat(
                  `${date} ${trades[i + j].tstrade}`,
                  'dd/MM/yyyy HH:mm:ss.SSS',
                  { zone: this.exchange.timezone },
                );
                if (!tsTrade.isValid) {
                  tsTrade = DateTime.fromFormat(
                    trades[i + j].tstrade,
                    'dd/MM/yyyy HH:mm:ss.SSS',
                    { zone: this.exchange.exchange },
                  );
                }
                if (
                  tsTrade.toMillis() !==
                    DateTime.fromJSDate(qLast[j].tstrade).toMillis() ||
                  Number(trades[i + j].price) !== Number(qLast[j].price) ||
                  trades[i + j].type !== qLast[j].type ||
                  Number(trades[i + j].quantity) !==
                    Number(qLast[j].quantity) ||
                  trades[i + j].buyer !== qLast[j].buyer ||
                  trades[i + j].seller !== qLast[j].seller
                ) {
                  found = false;
                  break;
                }
              }
              if (found) break;
            }
          } else if (
            asset === 'FRP0' &&
            DateTime.fromFormat(date, 'dd/MM/yyyy')
              .startOf('day')
              .toMillis() === DateTime.now().startOf('day').toMillis()
          ) {
            bQuerySpot = true;
          }

          for (let j = i - 1; j >= 0; j--) {
            try {
              let tsTrade = DateTime.fromFormat(
                `${date} ${trades[j].tstrade}`,
                'dd/MM/yyyy HH:mm:ss.SSS',
                { zone: this.exchange.timezone },
              );
              if (!tsTrade.isValid) {
                tsTrade = DateTime.fromFormat(
                  trades[j].tstrade,
                  'dd/MM/yyyy HH:mm:ss.SSS',
                  { zone: this.exchange.timezone },
                );
              }

              await this.queryfactory.runQuery(
                `INSERT INTO "intraday-trades" (asset, "ts-trade", 
                price, quantity, type, buyer, seller) 
                VALUES ($1, $2, $3, $4, $5, $6, $7) `,
                {
                  asset,
                  tsTrade: tsTrade.toJSDate(),
                  price: Number(trades[j].price),
                  quantity: Number(trades[j].quantity),
                  type: trades[j].type,
                  buyer: trades[j].buyer,
                  seller: trades[j].seller,
                },
              );
            } catch (error) {
              this.logger.error(
                `[BOT-router] BOT route /updttrades exception: ${error.message}`,
              );
              return res.status(500).send({
                result: false,
                msg: `Exception thrown: ${error.message}`,
              });
            }
          }
        }
        if (bQuerySpot) {
          await new QuerySPOT(this.bot).process(
            {
              dateRef: DateTime.now(),
              dateRefFRP: true,
              spotProjectionsQtty: 6,
              spotProjectionsMultiplier: 1,
            },
            false,
          );
        }
        return res.status(200).send({ result: true });
      },
    );

    return router;
  }
}
