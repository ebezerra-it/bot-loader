/* eslint-disable no-async-promise-executor */
/* eslint-disable no-new */
/* eslint-disable camelcase */
/* eslint-disable no-nested-ternary */
import https from 'https';
import http from 'http';
import { Logger } from 'tslog';
import { DateTime } from 'luxon';
import { WebSocket } from 'ws';
import BaseBot, { TUserType } from '../../baseBot';
import WSServerBase, {
  IDictionary,
  IWSMessage,
  TMessageType,
} from './wsserverBase';
import QueryPTAX from '../../../controllers/queries/queryPTAX';
import QuerySPOT from '../../../controllers/queries/querySPOT';
import QueryOI from '../../../controllers/queries/queryOI';
import QueryPlayers, {
  IAssetWeight,
} from '../../../controllers/queries/queryPlayers';
import QueryOptions, {
  TFRPCalculationType,
} from '../../../controllers/queries/queryOptions';
import QueryVolatility from '../../../controllers/queries/queryVolatility';
import QueryFRP0, {
  TContractType,
} from '../../../controllers/queries/queryFRP0';
import ReportLoaderCalendar from '../../../controllers/reportLoaderCalendar';
import { TCountryCode } from '../../../controllers/tcountry';
import QueryBrokersBalance from '../../../controllers/queries/queryBrokersBalance';
import QueryAssetsQuotes from '../../../controllers/queries/queryAssetsQuotes';
import QueryAssetsBooks from '../../../controllers/queries/queryAssetsBooks';
import QueryDolVpoc from '../../../controllers/queries/queryDolVpoc';

/* enum TMessageAskType {
  PTAX_AVG,
  PTAX_D1,
  SPOT_TODAY,
  SPOT_SETTLE,
  PLAYERS_BALANCE,
  OI_VWAP,
  OPTIONS_VWAP,
  VOLATILTY,
  BOOK,
}

interface IWSMessageAsk {
  askType: TMessageAskType;
  parameters: IDictionary;
} */

export default class wsServerDOLFUT extends WSServerBase {
  // private queryBrokersBal: QueryBrokersBalance;

  private assets: IAssetWeight[];

  constructor(
    server: http.Server | https.Server,
    bot: BaseBot,
    logger: Logger,
  ) {
    super('WSServerDOLFUT', '/dolfut', server, bot, logger, TUserType.DEFAULT);

    this.assets = [
      { asset: 'WDO', weight: 0.2 },
      { asset: 'DOL', weight: 1 },
    ];

    // this.queryBrokersBal = new QueryBrokersBalance(this.bot);
  }

  public checkRequiredParameters(_params: IDictionary | undefined): boolean {
    return true;
    /* return (
      !!params &&
      (!params.tsFrom ||
        (!!params.tsFrom &&
          DateTime.fromJSDate(new Date(Number(params.tsFrom))).isValid))
    ); */
  }

  public async sendServerData(
    params: IDictionary | undefined,
    ws: WebSocket,
  ): Promise<any> {
    const serverData: { [key: string]: any } = {};

    const dateRef = (
      params && DateTime.fromJSDate(new Date(Number(params.dateref))).isValid
        ? DateTime.fromMillis(Number(params.dateref))
        : DateTime.now().set({ hour: 19, minute: 0, second: 0, millisecond: 0 })
    ).setZone('America/Sao_Paulo');

    const contract =
      params && params.contract
        ? params.contract
        : (
            await QueryOptions.getContractCode(
              this.bot.queryFactory,
              dateRef,
              TContractType.CURRENT,
            )
          ).code;

    // BROKERS BALANCE
    new Promise<void>(resolve => {
      QueryBrokersBalance.calculate(
        this.bot.queryFactory,
        this.assets.map(a => {
          return {
            asset: `${a.asset}${contract}`,
            weight: a.weight,
          };
        }),
        dateRef,
      )
        .then(brokersbal => {
          if (brokersbal) this.sendDataMessage({ brokersbal }, ws);
          resolve();
        })
        .catch(err => {
          this.logger.error(
            `Query [BROKERS BALANCE] threw exception: ${err.message}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [BROKERS BALANCE] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // ASSETS QUOTES
    new Promise<void>(resolve => {
      QueryAssetsQuotes.calculate(
        this.bot.queryFactory,
        this.assets.map(a => {
          return {
            asset: `${a.asset}${contract}`,
            weight: a.weight,
          };
        }),
        dateRef,
      )
        .then(assetsquotes => {
          if (assetsquotes) this.sendDataMessage({ assetsquotes }, ws);
          resolve();
        })
        .catch(err => {
          this.logger.error(
            `Query [ASSETS QUOTES] threw exception: ${err.message}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [ASSETS QUOTES] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // DI1 QUOTES
    new Promise<void>(resolve => {
      const y1 = Number(String(contract).substr(1, 2)) + 1;
      const y2 = y1 + 1;

      QueryAssetsQuotes.calculate(
        this.bot.queryFactory,
        [{ asset: `DI1F${y1}`, weight: 1 }],
        dateRef,
      )
        .then(y1quotes => {
          QueryAssetsQuotes.calculate(
            this.bot.queryFactory,
            [{ asset: `DI1F${y2}`, weight: 1 }],
            dateRef,
          )
            .then(y2quotes => {
              if (y1quotes || y2quotes)
                this.sendDataMessage(
                  {
                    di1quotes: {
                      y1quotes,
                      y2quotes,
                    },
                  },
                  ws,
                );
              resolve();
            })
            .catch(err => {
              this.logger.error(
                `Query [DI1-Y2 QUOTES] threw exception: ${err.message}`,
              );
              this.sendMessage(
                {
                  timestamp: new Date(),
                  type: TMessageType.ERROR,
                  data: {
                    errorMessage: `Query [DI1-Y2 QUOTES] threw exception: ${err.message}`,
                  },
                },
                ws,
              );
            });
        })
        .catch(err => {
          this.logger.error(
            `Query [DI1-Y1 QUOTES] threw exception: ${err.message}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [DI1-Y1 QUOTES] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // ASSETS BOOKS
    new Promise<void>(resolve => {
      QueryAssetsBooks.calculate(
        this.bot.queryFactory,
        this.assets.map(a => {
          return {
            asset: `${a.asset}${contract}`,
            weight: a.weight,
          };
        }),
        dateRef,
      )
        .then(assetsbooks => {
          if (assetsbooks) this.sendDataMessage({ assetsbooks }, ws);
          resolve();
        })
        .catch(err => {
          this.logger.error(
            `Query [ASSETS BOOKS] threw exception: ${err.message}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [ASSETS BOOKS] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // SPOT HIRED
    new Promise<void>(resolve => {
      new QuerySPOT(this.bot)
        .calculateSpotToday(dateRef)
        .then(spothired => {
          if (spothired) {
            this.sendDataMessage(
              {
                spothired: {
                  ...spothired,
                  future: {
                    frp0: spothired.frp0.today
                      ? +Number(spothired.vwap + spothired.frp0.today).toFixed(
                          2,
                        )
                      : undefined,
                    frp1d1: spothired.frp0.frp1d1
                      ? +Number(spothired.vwap + spothired.frp0.frp1d1).toFixed(
                          2,
                        )
                      : undefined,
                    calculated: spothired.frp0.calculated
                      ? +Number(
                          spothired.vwap + spothired.frp0.calculated,
                        ).toFixed(2)
                      : undefined,
                  },
                },
              },
              ws,
            );
          }
          resolve();
        })
        .catch(err => {
          this.logger.error(
            `Query [SPOT HIRED] threw exception: ${err.message}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [SPOT HIRED] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // PTAX AVERAGE
    new Promise<void>(resolve => {
      const ptaxavgpriordays =
        params && Number(params.ptaxavgpriordays) > 0
          ? Number(params.ptaxavgpriordays) <
            Number(process.env.WEBAPP_DOLFUT_PTAXAVG_PRIOR_DAYS_MAX || '5')
            ? Number(params.ptaxavgpriordays)
            : Number(process.env.WEBAPP_DOLFUT_PTAXAVG_PRIOR_DAYS_MAX || '5')
          : Number(process.env.WEBAPP_DOLFUT_PTAXAVG_PRIOR_DAYS_DEFAULT || '2');

      new QueryPTAX(this.bot)
        .calculateAverage(dateRef, ptaxavgpriordays)
        .then(ptaxavg => {
          if (ptaxavg) this.sendDataMessage({ ptaxavg }, ws);
          resolve();
        })
        .catch(err => {
          this.logger.error(
            `Query [PTAX AVERAGE] threw exception: ${err.message}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [PTAX AVERAGE] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // PTAX D-0
    new Promise<void>(resolve => {
      const projectionsqtty =
        params && Number(params.projectionsqtty) > 0
          ? Number(params.projectionsqtty) <
            Number(process.env.WEBAPP_DOLFUT_PROJECTIONS_QTTY_MAX || '10')
            ? Number(params.projectionsqtty)
            : Number(process.env.WEBAPP_DOLFUT_PROJECTIONS_QTTY_MAX || '10')
          : Number(process.env.WEBAPP_DOLFUT_PROJECTIONS_QTTY_DEFAULT || '5');
      const projectionsmultiplier =
        params && Number(params.projectionsmultiplier) > 0
          ? Number(params.projectionsmultiplier) <
            Number(process.env.WEBAPP_DOLFUT_PROJECTIONS_MULTIPLIER_MAX || '10')
            ? Number(params.projectionsmultiplier)
            : Number(
                process.env.WEBAPP_DOLFUT_PROJECTIONS_MULTIPLIER_MAX || '10',
              )
          : Number(
              process.env.WEBAPP_DOLFUT_PROJECTIONS_MULTIPLIER_DEFAULT || '1',
            );

      new QueryPTAX(this.bot)
        .calculatePTAXD0(dateRef, projectionsqtty, projectionsmultiplier)
        .then(ptaxd0 => {
          if (ptaxd0) this.sendDataMessage({ ptaxd0 }, ws);
          resolve();
        })
        .catch(err => {
          this.logger.error(`Query [PTAX D-0] threw exception: ${err.message}`);
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [PTAX D-0] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    return serverData;
  }

  public async sendServerDataOnce(
    params: IDictionary | undefined,
    ws: WebSocket,
  ): Promise<void> {
    const dateRef =
      params && DateTime.fromJSDate(new Date(Number(params.dateref))).isValid
        ? DateTime.fromMillis(Number(params.dateref))
        : DateTime.now();

    // OI VWAP
    new Promise<void>(async resolve => {
      const contract = await QueryFRP0.getContractCode(
        this.bot.queryFactory,
        dateRef,
        TContractType.CURRENT,
      );

      new QueryOI(this.bot)
        .calculate(contract.code, this.assets, dateRef)
        .then(oivwap => {
          if (oivwap && oivwap.resOI) {
            this.sendDataMessage(
              { oivwap: oivwap.resOI.OIDates.slice(-1).pop() || undefined },
              ws,
            );
          }
          resolve();
        })
        .catch(err => {
          this.logger.error(`Query [OI VWAP] threw exception: ${err.message}`);
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [OI VWAP] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // PTAX D-1
    new Promise<void>(resolve => {
      const projectionsqtty =
        params && Number(params.projectionsqtty) > 0
          ? Number(params.projectionsqtty) <
            Number(process.env.WEBAPP_DOLFUT_PROJECTIONS_QTTY_MAX || '10')
            ? Number(params.projectionsqtty)
            : Number(process.env.WEBAPP_DOLFUT_PROJECTIONS_QTTY_MAX || '10')
          : Number(process.env.WEBAPP_DOLFUT_PROJECTIONS_QTTY_DEFAULT || '5');
      const projectionsmultiplier =
        params && Number(params.projectionsmultiplier) > 0
          ? Number(params.projectionsmultiplier) <
            Number(process.env.WEBAPP_DOLFUT_PROJECTIONS_MULTIPLIER_MAX || '10')
            ? Number(params.projectionsmultiplier)
            : Number(
                process.env.WEBAPP_DOLFUT_PROJECTIONS_MULTIPLIER_MAX || '10',
              )
          : Number(
              process.env.WEBAPP_DOLFUT_PROJECTIONS_MULTIPLIER_DEFAULT || '1',
            );

      new QueryPTAX(this.bot)
        .calculatePTAXD1(dateRef, projectionsqtty, projectionsmultiplier)
        .then(ptaxd1 => {
          if (ptaxd1) this.sendDataMessage({ ptaxd1 }, ws);
          resolve();
        })
        .catch(err => {
          this.logger.error(`Query [PTAX D-1] threw exception: ${err.message}`);
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [PTAX D-1] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // VOLATILITY
    new Promise<void>(async resolve => {
      const volatilitysampletradedays =
        params && Number(params.volatilitysampletradedays) > 0
          ? Number(params.volatilitysampletradedays) <
            Number(
              process.env.WEBAPP_DOLFUT_PROJECTIONS_MULTIPLIER_MAX || '252',
            )
            ? Number(params.volatilitysampletradedays)
            : Number(
                process.env.WEBAPP_DOLFUT_PROJECTIONS_MULTIPLIER_MAX || '252',
              )
          : Number(
              process.env.WEBAPP_DOLFUT_VOLATILITY_SAMPLE_TRADE_DAYS_DEFAULT ||
                '5',
            );
      const volSampleFromDate = await ReportLoaderCalendar.subTradeDays(
        this.bot.queryFactory,
        dateRef,
        volatilitysampletradedays,
        TCountryCode.BR,
      );

      new QueryVolatility(this.bot)
        .getVolatility(this.assets, volSampleFromDate, dateRef)
        .then(volatility => {
          if (volatility) this.sendDataMessage({ volatility }, ws);
          resolve();
        })
        .catch(err => {
          this.logger.error(
            `Query [VOLATILITY] threw exception: ${err.message}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [VOLATILITY] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // SPOT SETTLE
    new Promise<void>(resolve => {
      new QuerySPOT(this.bot)
        .calculateSpotForSettleDate(dateRef, false)
        .then(spotsettle => {
          if (spotsettle) this.sendDataMessage({ spotsettle }, ws);
          resolve();
        })
        .catch(err => {
          this.logger.error(
            `Query [SPOT FOR SETTLE DATE] threw exception: ${err.message}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [SPOT FOR SETTLE DATE] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // OI PLAYERS BALANCE
    new Promise<void>(resolve => {
      new QueryPlayers(this.bot)
        .calculate(this.assets, dateRef)
        .then(playersbal => {
          if (playersbal) this.sendDataMessage({ playersbal }, ws);
          resolve();
        })
        .catch(err => {
          this.logger.error(
            `Query [OI PLAYERS BALANCE] threw exception: ${err.message}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorMessage: `Query [OI PLAYERS BALANCE] threw exception: ${err.message}`,
              },
            },
            ws,
          );
        });
    });

    // OPTIONS VWAP
    new Promise<void>(resolve => {
      new QueryOptions(this.bot)
        .calculateOIOptionsVWAP(dateRef, TFRPCalculationType.CLOSE_D1)
        .then(options => {
          if (options) this.sendDataMessage({ optionsvwap: options }, ws);
          resolve();
        });
    }).catch(err => {
      this.logger.error(`Query [OPTIONS VWAP] threw exception: ${err.message}`);
      this.sendMessage(
        {
          timestamp: new Date(),
          type: TMessageType.ERROR,
          data: {
            errorMessage: `Query [OPTIONS VWAP] threw exception: ${err.message}`,
          },
        },
        ws,
      );
    });

    // VPOC
    await new Promise<void>(async (resolve: any) => {
      const vpocDaysSampleSize =
        params && Number(params.vpocdayssamplesize) > 0
          ? Number(params.vpocdayssamplesize) <
            Number(process.env.WEBAPP_DOLFUT_VPOC_DAYS_SAMPLE_SIZE_MAX || '30')
            ? Number(params.vpocdayssamplesize)
            : Number(
                process.env.WEBAPP_DOLFUT_VPOC_DAYS_SAMPLE_SIZE_MAX || '30',
              )
          : Number(
              process.env.WEBAPP_DOLFUT_VPOC_DAYS_SAMPLE_SIZE_DEFAULT || '1',
            );

      const vpocSampleSize =
        params && Number(params.vpocSampleSize) > 0
          ? Number(params.vpocSampleSize) <
            Number(process.env.WEBAPP_DOLFUT_VPOC_SAMPLE_SIZE_MAX || '1000')
            ? Number(params.vpocSampleSize)
            : Number(process.env.WEBAPP_DOLFUT_VPOC_SAMPLE_SIZE_MAX || '1000')
          : Number(
              process.env.WEBAPP_DOLFUT_VPOC_SAMPLE_SIZE_DEFAULT || '1000',
            );

      const vpocClusterTicksSize =
        params && Number(params.vpocclustertickssize) > 0
          ? Number(params.vpocclustertickssize) >
            Number(process.env.WEBAPP_DOLFUT_CLUSTER_TICKS_SIZE_MAX || '800')
            ? Number(process.env.WEBAPP_DOLFUT_CLUSTER_TICKS_SIZE_MAX || '800')
            : Number(params.vpocclustertickssize)
          : Number(
              process.env.WEBAPP_DOLFUT_CLUSTER_TICKS_SIZE_DEFAULT || '20',
            );

      const rolling =
        !params ||
        !params.vpocrolling ||
        !!(params && String(params.vpocrolling).toUpperCase() === 'TRUE');

      const frp0 =
        !params ||
        !params.vpocfrp0 ||
        !!(params && String(params.vpocfrp0).toUpperCase() === 'TRUE');

      new QueryDolVpoc(this.bot)
        .calculate(
          dateRef,
          vpocDaysSampleSize,
          vpocSampleSize,
          vpocClusterTicksSize,
          rolling,
          frp0,
        )
        .then(vpoc => {
          if (vpoc) this.sendDataMessage({ vpoc }, ws);
          resolve();
        });
    }).catch(err => {
      this.logger.error(`Query [VPOC] threw exception: ${err.message}`);
      this.sendMessage(
        {
          timestamp: new Date(),
          type: TMessageType.ERROR,
          data: {
            errorMessage: `Query [VPOC] threw exception: ${err.message}`,
          },
        },
        ws,
      );
    });
  }

  public async processClientMessage(
    message: IWSMessage,
    ws: WebSocket,
  ): Promise<void> {
    /* const msg = <IWSMessage>JSON.parse(message.toString());
  if (msg && msg.type === TMessageType.ASK) {
    const askMsg = <IWSMessageAsk>JSON.parse(msg.data);
    switch (askMsg.askType) {
      case TMessageType.
    } */
    this.sendMessage(
      {
        timestamp: new Date(),
        type: TMessageType.PING,
        data: { echo: message.data },
      },
      ws,
    );
  }
}
