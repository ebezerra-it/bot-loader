/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
import { DateTime } from 'luxon';
import path from 'path';
import Query from './query';
import BaseBot, { TUserType } from '../../bot/baseBot';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { TCountryCode } from '../tcountry';
import { QueryFactory } from '../../db/queryFactory';
import { loadJSONFile } from '../utils';
import { IAssetWeight } from './queryPlayers';

enum TBrokerType {
  NATIONAL = 'N',
  FOREIGN = 'F',
  OTHER = 'O',
}

interface IBroker {
  id: number;
  type: TBrokerType;
  bmf?: boolean;
  bov?: boolean;
}

interface IBrokersVision {
  name: string;
  brokers: IBroker[];
}

interface IBrokerBalance {
  broker: IBroker;
  datetime: DateTime;
  volume: number;
  vwap: number;
}

interface IBrokerTypesBalance {
  brokerType: TBrokerType;
  datetime: DateTime;
  volume: number;
  vwap: number;
}

interface IBalanceVision {
  visionName: string;
  assets: IAssetWeight[];
  datetime: DateTime;
  brokerTypesBalance?: IBrokerTypesBalance[] | undefined;
  brokersBalance?: IBrokerBalance[] | undefined;
}

const VISION_BROKERS_DB_TABLE = 'Brokers DB Table';

export default class QueryBrokersBalance extends Query {
  public async process(params: {
    assets: IAssetWeight[];
    dateFrom: DateTime;
    dateTo?: DateTime;
    visionName?: string;
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    let msgHeader;
    let botResponse;
    let balanceVisionFrom: IBalanceVision | undefined;
    let balanceVisionTo: IBalanceVision | undefined;
    let balanceVision: IBalanceVision | undefined;

    if (params.dateTo) {
      msgHeader = `BROKERS BALANCE DIFFERENCE - Assets: ${params.assets.map(
        a => a.asset,
      )} - Date from: ${params.dateFrom.toFormat(
        'dd/MM/yyyy HH:mm',
      )} - Date to: ${params.dateTo.toFormat('dd/MM/yyyy HH:mm')}\n`;
    } else {
      msgHeader = `BROKERS BALANCE - Assets: ${params.assets.map(
        a => a.asset,
      )} - Date from: ${params.dateFrom.toFormat('dd/MM/yyyy HH:mm')}\n`;
    }

    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.queryFactory,
        params.dateFrom,
        TCountryCode.BR,
      )) ||
      (params.dateTo &&
        !(await ReportLoaderCalendar.isTradeDay(
          this.queryFactory,
          params.dateTo,
          TCountryCode.BR,
        )))
    )
      botResponse = 'Reference date is not a trade day.';
    else {
      const brokersVision = await QueryBrokersBalance.getBrokersVision(
        this.queryFactory,
        params.visionName,
      );

      if (!brokersVision) return false;

      balanceVisionFrom = await QueryBrokersBalance.getBalanceVision(
        this.queryFactory,
        brokersVision,
        params.dateFrom,
        params.assets,
      );

      if (!params.dateTo) {
        balanceVision = balanceVisionFrom;
      } else {
        balanceVisionTo = await QueryBrokersBalance.getBalanceVision(
          this.queryFactory,
          brokersVision,
          params.dateTo,
          params.assets,
        );

        balanceVision = QueryBrokersBalance.calculateBrokersBalanceVisionDiff(
          balanceVisionFrom,
          balanceVisionTo,
        );
      }

      if (balanceVision) {
        delete balanceVision.brokersBalance;

        botResponse = BaseBot.printJSON(balanceVision);
      } else botResponse = 'Not enought data.';
    }

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
    return !!balanceVision;
  }

  public static async calculate(
    queryFactory: QueryFactory,
    assets: IAssetWeight[],
    dateFrom: DateTime,
    dateTo?: DateTime,
    visionName?: string,
    // rollAssetsCodes?: IAssetWeight[], // DR1, WD1, IR1, WR1, etc.
  ): Promise<IBalanceVision | undefined> {
    if (
      !(await ReportLoaderCalendar.isTradeDay(
        queryFactory,
        dateFrom,
        TCountryCode.BR,
      )) ||
      (dateTo &&
        !(await ReportLoaderCalendar.isTradeDay(
          queryFactory,
          dateTo,
          TCountryCode.BR,
        )))
    )
      return undefined;

    // let balanceVisionFrom: IBalanceVision | undefined;
    let balanceVisionTo: IBalanceVision | undefined;
    let balanceVision: IBalanceVision | undefined;

    const brokersVision = await QueryBrokersBalance.getBrokersVision(
      queryFactory,
      visionName && visionName !== '' ? visionName : 'VISION-BMF',
    );

    if (!brokersVision) return undefined;

    const balanceVisionFrom = await QueryBrokersBalance.getBalanceVision(
      queryFactory,
      brokersVision,
      dateFrom,
      assets,
    );

    if (!dateTo) {
      balanceVision = balanceVisionFrom;
    } else {
      balanceVisionTo = await QueryBrokersBalance.getBalanceVision(
        queryFactory,
        brokersVision,
        dateTo,
        assets,
      );

      balanceVision = QueryBrokersBalance.calculateBrokersBalanceVisionDiff(
        balanceVisionFrom,
        balanceVisionTo,
      );
    }

    if (balanceVision) delete balanceVision.brokersBalance;
    else return undefined;
    return balanceVision;
  }

  public static async getBalanceVision(
    queryFactory: QueryFactory,
    brokersVision: IBrokersVision,
    datetime: DateTime,
    assets: IAssetWeight[],
  ): Promise<IBalanceVision | undefined> {
    const assetsBrokersBalance: IBrokerBalance[] = [];
    /* const orderBy =
      datetime.get('hour') >= 18 && datetime.get('minute') >= 30
        ? 'DESC'
        : 'ASC'; */

    for await (const asset of assets) {
      /* const match = asset.asset.match(/[A-Za-z0-9]{3,}([FGHJKMNOUVXZ]\d\d)/);

      if (match && match.length === 3) {
        const assetCode = match[1];
        const contract = match[2];

        const qRollAssets = await queryFactory.runQuery(
          `SELECT asset FROM "b3-assets-expiry" 
        WHERE "product-group" = 'ROLLOVER' AND "underlying-asset" = $2 AND 
        asset like '%$3%'
        "date-trading-start"::DATE <= $1::DATE AND "date-expiry"::DATE > $1`,
          {
            dateRef: datetime.toJSDate(),
            assetCode,
            contract,
          },
        );

        for await (const rollAsset of qRollAssets) {
          const qBrokerBalRoll = await queryFactory.runQuery(
            `SELECT * FROM 
            (SELECT DISTINCT ON ("broker-id") "broker-id" brokerid, datetime, asset, volume, vwap 
            FROM "b3-assetsbrokers" 
            WHERE asset = ANY($1) AND datetime::TIMESTAMPTZ<=$2::TIMESTAMPTZ AND datetime::DATE=$2::DATE
            ORDER BY "broker-id" ASC, datetime DESC) q 
            ORDER BY volume DESC, vwap DESC`,
            {
              asset: '', // ([A-Za-z0-9]{3,})([FGHJKMNOUVXZ]\d\d)
              datetime: datetime.toJSDate(),
            },
          );
        }
        if (qRollAssets && qRollAssets.length > 0) {
          //
        }
      } */

      const qBrokersBalance = await queryFactory.runQuery(
        `SELECT * FROM 
        (SELECT DISTINCT ON ("broker-id") "broker-id" brokerid, datetime, asset, volume, vwap 
        FROM "b3-assetsbrokers" 
        WHERE asset=$1 AND datetime::TIMESTAMPTZ<=$2::TIMESTAMPTZ AND datetime::DATE=$2::DATE
        ORDER BY "broker-id" ASC, datetime DESC) q 
        ORDER BY volume DESC, vwap DESC`,
        {
          asset: asset.asset,
          datetime: datetime.toJSDate(),
        },
      );

      if (qBrokersBalance && qBrokersBalance.length > 0) {
        const brokersId = brokersVision.brokers.map(b => b.id);
        for await (const qBrokerBal of qBrokersBalance) {
          const posbroker = brokersId.indexOf(Number(qBrokerBal.brokerid));
          if (posbroker > 0) {
            assetsBrokersBalance.push({
              broker: brokersVision.brokers[posbroker],
              datetime: DateTime.fromJSDate(qBrokerBal.datetime),
              volume: +(Number(qBrokerBal.volume) * asset.weight).toFixed(2),
              vwap: +Number(qBrokerBal.vwap).toFixed(2),
            });
          }
        }
      }
    }

    const groupedBrokersBalace: IBrokerBalance[] = [];
    const groupedBrokerTypesBalance: IBrokerTypesBalance[] = [];

    if (assetsBrokersBalance && assetsBrokersBalance.length > 0) {
      // Assets-Brokers-Balance
      const brokers = [...new Set(assetsBrokersBalance.map(b => b.broker.id))];
      brokers.forEach(id => {
        const assetsBroker = assetsBrokersBalance.filter(
          b => b.broker.id === id,
        );
        if (!assetsBroker) return;

        const sumVolume =
          assetsBroker.length > 0
            ? assetsBroker
                .map((b: IBrokerBalance) => b.volume)
                .reduce((acum: number, curr: number) => {
                  return acum + curr;
                })
            : 0;
        const sumPriceVolume =
          assetsBroker.length > 0
            ? assetsBroker
                .map((b: IBrokerBalance) => b.volume * b.vwap)
                .reduce((acum: number, curr: number) => {
                  return acum + curr;
                })
            : 0;

        const lastDatetime = Math.max.apply(
          null,
          assetsBroker.map(b => b.datetime.toMillis()),
        );
        const groupedBroker: IBrokerBalance = {
          broker: assetsBroker[0].broker,
          datetime: DateTime.fromMillis(lastDatetime),
          volume: +sumVolume.toFixed(2),
          vwap: +(sumVolume !== 0 ? sumPriceVolume / sumVolume : 0).toFixed(2),
        };
        groupedBrokersBalace.push(groupedBroker);
      });

      // Assets-BrokerTypes-Balance
      Object.values(TBrokerType).forEach(type => {
        const assetsBrokersType = groupedBrokersBalace.filter(
          b => b.broker.type === type,
        );
        if (!assetsBrokersType) return;

        const sumVolume =
          assetsBrokersType.length > 0
            ? assetsBrokersType
                .map((b: IBrokerBalance) => b.volume)
                .reduce((acum: number, curr: number) => {
                  return acum + curr;
                })
            : 0;
        const sumPriceVolume =
          assetsBrokersType.length > 0
            ? assetsBrokersType
                .map((b: IBrokerBalance) => b.volume * b.vwap)
                .reduce((acum: number, curr: number) => {
                  return acum + curr;
                })
            : 0;
        const lastDatetime = Math.max.apply(
          null,
          assetsBrokersType.map(b => b.datetime.toMillis()),
        );

        const groupedType: IBrokerTypesBalance = {
          brokerType: type as TBrokerType,
          datetime: DateTime.fromMillis(lastDatetime),
          volume: +sumVolume.toFixed(2),
          vwap: +(sumVolume !== 0 ? sumPriceVolume / sumVolume : 0).toFixed(2),
        };
        groupedBrokerTypesBalance.push(groupedType);
      });

      return {
        visionName: brokersVision.name,
        assets,
        datetime,
        brokersBalance: groupedBrokersBalace,
        brokerTypesBalance: groupedBrokerTypesBalance,
      };
    }

    return undefined;
  }

  public static async getBrokersVision(
    queryFactory: QueryFactory,
    visionName?: string,
  ): Promise<IBrokersVision | undefined> {
    const qBrokers = await queryFactory.runQuery(
      `SELECT id, type, "exchange-bmf" bmf, "exchange-bov" bov FROM "b3-brokers" ORDER BY id ASC`,
      {},
    );
    if (!qBrokers || qBrokers.length === 0) return undefined;
    if (!visionName) {
      return {
        name: VISION_BROKERS_DB_TABLE,
        brokers: <IBroker[]>qBrokers.map((b: any) => {
          return {
            id: b.id,
            type: b.type,
            bmf: b.bmf,
            bov: b.bov,
          };
        }),
      };
    }

    try {
      let vision: IBrokersVision | undefined;
      const visionsJson: IBrokersVision | IBrokersVision[] = <
        IBrokersVision | IBrokersVision[]
      >await loadJSONFile(
        path.join(__dirname, '../../../', 'config', 'b3_brokers_visions.json'),
      );

      if (Array.isArray(visionsJson)) {
        vision = visionsJson.find((v: any) => {
          if (visionName)
            return (
              String(v.name).trim().toUpperCase() ===
              visionName.trim().toUpperCase()
            );
          return true;
        });
      } else vision = visionsJson;

      if (!vision || !vision.brokers || !(vision.brokers.length > 0)) {
        return {
          name: VISION_BROKERS_DB_TABLE,
          brokers: <IBroker[]>qBrokers.map((b: any) => {
            return {
              id: b.id,
              type: b.type,
              bmf: b.bmf,
              bov: b.bov,
            };
          }),
        };
      }

      return {
        name: vision.name,
        brokers: vision.brokers
          .map((b: IBroker) => {
            const posbroker = qBrokers
              .map((q: any) => Number(q.id))
              .indexOf(Number(b.id));
            return {
              id: posbroker > 0 ? b.id : posbroker,
              type: Object.values(TBrokerType).includes(b.type)
                ? b.type
                : TBrokerType.OTHER,
              bmf: posbroker > 0 ? qBrokers[posbroker].bmf : false,
              bov: posbroker > 0 ? qBrokers[posbroker].bov : false,
            };
          })
          .filter((b: IBroker) => b.id > 0 && (b.bmf || b.bov)),
      };
    } catch (err) {
      return {
        name: VISION_BROKERS_DB_TABLE,
        brokers: <IBroker[]>qBrokers.map((b: any) => {
          return {
            id: b.id,
            type: b.type,
            bmf: b.bmf,
            bov: b.bov,
          };
        }),
      };
    }
  }

  public static calculateBrokersBalanceVisionDiff(
    brokersBalVisionFrom: IBalanceVision | undefined,
    brokersBalVisionTo: IBalanceVision | undefined,
  ): IBalanceVision | undefined {
    if (!brokersBalVisionFrom && !brokersBalVisionTo) return undefined;
    if (!brokersBalVisionFrom) return brokersBalVisionTo;
    if (!brokersBalVisionTo) return brokersBalVisionFrom;

    const brokersBalDiff: IBrokerBalance[] = [];
    brokersBalVisionFrom.brokersBalance?.forEach(bfrom => {
      const brokerTo: IBrokerBalance | undefined =
        brokersBalVisionTo.brokersBalance?.find(
          bto => bto.broker.id === bfrom.broker.id,
        );

      if (brokerTo) {
        brokersBalDiff.push({
          broker: bfrom.broker,
          datetime:
            bfrom.datetime > brokerTo.datetime
              ? bfrom.datetime
              : brokerTo.datetime,
          volume: brokerTo.volume - bfrom.volume,
          vwap: +(
            (brokerTo.volume * brokerTo.vwap - bfrom.volume * bfrom.vwap) /
            (brokerTo.volume + bfrom.volume)
          ).toFixed(2),
        });
      } else {
        brokersBalDiff.push(bfrom);
      }
    });
    brokersBalVisionTo.brokersBalance?.forEach(bto => {
      if (
        !brokersBalVisionFrom.brokersBalance?.find(
          bfrom => bfrom.broker.id === bto.broker.id,
        )
      )
        brokersBalDiff.push(bto);
    });

    const brokerTypesBalDiff: IBrokerTypesBalance[] = [];
    brokersBalVisionFrom.brokerTypesBalance?.forEach(tFrom => {
      const typeTo: IBrokerTypesBalance | undefined =
        brokersBalVisionTo.brokerTypesBalance?.find(
          tTo => tTo.brokerType === tFrom.brokerType,
        );

      if (typeTo) {
        brokerTypesBalDiff.push({
          brokerType: tFrom.brokerType,
          datetime:
            tFrom.datetime > typeTo.datetime ? tFrom.datetime : typeTo.datetime,
          volume: typeTo.volume - tFrom.volume,
          vwap: +(
            (typeTo.volume * typeTo.vwap - tFrom.volume * tFrom.vwap) /
            (typeTo.volume - tFrom.volume)
          ).toFixed(2),
        });
      } else {
        brokerTypesBalDiff.push(tFrom);
      }
    });
    brokersBalVisionTo.brokerTypesBalance?.forEach(tTo => {
      if (
        !brokersBalVisionFrom.brokerTypesBalance?.find(
          tFrom => tFrom.brokerType === tTo.brokerType,
        )
      )
        brokerTypesBalDiff.push(tTo);
    });

    return {
      visionName: brokersBalVisionTo.visionName,
      assets: brokersBalVisionTo.assets,
      datetime: brokersBalVisionTo.datetime,
      brokersBalance: brokersBalDiff,
      brokerTypesBalance: brokerTypesBalDiff,
    };
  }
}
export { IBroker, IBrokersVision, IBrokerBalance, IBrokerTypesBalance };
