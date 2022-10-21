/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
import { DateTime } from 'luxon';
import path from 'path';
import Query from './query';
import TelegramBot, { TUserType } from '../../bot/telegramBot';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { TCountryCode } from '../tcountry';
import { QueryFactory } from '../../db/queryFactory';
import { loadJSONFile } from '../utils';

enum TBrokerType {
  NATIONAL = 'N',
  FOREIGN = 'F',
  OTHER = 'O',
}

interface IAsset {
  name: string;
  weight: number;
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
  assets: IAsset[];
  datetime: DateTime;
  brokerTypesBalance?: IBrokerTypesBalance[] | undefined;
  brokersBalance?: IBrokerBalance[] | undefined;
}

const VISION_BROKERS_DB_TABLE = 'Brokers DB Table';

export default class QueryBrokersBalance extends Query {
  public async process(params: {
    assets: IAsset[];
    datetime: DateTime;
    visionName?: string;
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    let botResponse;
    let balanceVision: IBalanceVision | undefined;
    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.queryFactory,
        params.datetime,
        TCountryCode.BR,
      ))
    )
      botResponse = 'Reference date is not a trade day.';
    else {
      const brokersVision = await QueryBrokersBalance.getBrokersVision(
        this.queryFactory,
        params.visionName,
      );

      if (!brokersVision) return false;

      balanceVision = await QueryBrokersBalance.getBalanceVision(
        this.queryFactory,
        brokersVision,
        params.datetime,
        params.assets,
      );

      if (balanceVision) {
        delete balanceVision.brokersBalance;

        botResponse = TelegramBot.printJSON(balanceVision);
      } else botResponse = 'Not enought data.';
    }

    const msgHeader = `BROKERS BALANCE - Assets: ${params.assets.map(
      a => a.name,
    )} - Datetime: ${params.datetime.toFormat('dd/MM/yyyy HH:mm:ss')}\n`;

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
    return !!balanceVision;
  }

  public static async getBalanceVision(
    queryFactory: QueryFactory,
    brokersVision: IBrokersVision,
    datetime: DateTime,
    assets: IAsset[],
  ): Promise<IBalanceVision | undefined> {
    const assetsBrokersBalance: IBrokerBalance[] = [];

    for await (const asset of assets) {
      const qBrokersBalance = await queryFactory.runQuery(
        `SELECT * FROM 
        (SELECT DISTINCT ON ("broker-id") "broker-id" brokerid, datetime, asset, volume, vwap 
        FROM "b3-brokersbalance" 
        WHERE asset=$1 AND datetime::TIMESTAMPTZ<=$2::TIMESTAMPTZ AND datetime::DATE=$2::DATE
        ORDER BY "broker-id" ASC, datetime DESC) q 
        ORDER BY volume DESC, vwap DESC`,
        {
          asset: asset.name,
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

        const sumVolume = assetsBroker
          .map(b => b.volume)
          .reduce((acum, curr) => {
            return acum + curr;
          });
        const sumPriceVolume = assetsBroker
          .map(b => b.volume * b.vwap)
          .reduce((acum, curr) => {
            return acum + curr;
          });

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

        const sumVolume = assetsBrokersType
          .map(b => b.volume)
          .reduce((acum, curr) => {
            return acum + curr;
          });
        const sumPriceVolume = assetsBrokersType
          .map(b => b.volume * b.vwap)
          .reduce((acum, curr) => {
            return acum + curr;
          });
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
}
export { IAsset, IBroker, IBrokersVision, IBrokerBalance, IBrokerTypesBalance };
