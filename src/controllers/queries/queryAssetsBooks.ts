import { DateTime } from 'luxon';
import Query from './query';
import { QueryFactory } from '../../db/queryFactory';
import { IAssetWeight } from './queryPlayers';
import BaseBot, { TUserType } from '../../bot/baseBot';

interface IAssetBookDepth {
  datetime: Date;
  asset: IAssetWeight;
  volumeBuy: number;
  vwapBuy: number;
  volumeSell: number;
  vwapSell: number;
}

interface IMergedBooks extends Omit<IAssetBookDepth, 'datetime' | 'asset'> {
  vwap: number;
  volume: number;
}

interface IAssetsBookDepth {
  assetsBookDepth: IAssetBookDepth[];
  mergedBooks: IMergedBooks | undefined;
}

export default class QueryAssetsBooks extends Query {
  public async process(params: {
    assets: IAssetWeight[];
    dateRef: DateTime;
    chatId?: number;
    messageId?: number;
  }): Promise<any> {
    const msgHeader = `ASSET BOOK - Asset: ${params.assets.map(
      a => a.asset,
    )} - Date from: ${params.dateRef.toFormat('dd/MM/yyyy HH:mm:ss')}\n`;

    let botResponse;
    const assetsBooks = await QueryAssetsBooks.calculate(
      this.queryFactory,
      params.assets,
      params.dateRef,
    );

    if (assetsBooks) {
      botResponse = BaseBot.printJSON(assetsBooks);
    } else botResponse = 'Not enought data.';

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
    return !!assetsBooks;
  }

  public static async calculate(
    queryFactory: QueryFactory,
    assets: IAssetWeight[],
    dateRef: DateTime,
  ): Promise<IAssetsBookDepth | undefined> {
    const assetsBook: IAssetBookDepth[] = [];

    // eslint-disable-next-line no-restricted-syntax
    for await (const asset of assets) {
      const assetBook = await this.getAssetBook(queryFactory, dateRef, asset);
      if (assetBook) assetsBook.push(assetBook);
    }

    if (assetsBook.length === 0) return undefined;

    return {
      assetsBookDepth: assetsBook,
      mergedBooks: QueryAssetsBooks.mergeAssetsBook(assetsBook),
    };
  }

  public static async getAssetBook(
    queryFactory: QueryFactory,
    dateRef: DateTime,
    asset: IAssetWeight,
  ): Promise<IAssetBookDepth | undefined> {
    const qBook = await queryFactory.runQuery(
      `select datetime, asset, sum("buyVolume") volbuy, 
      sum("buyLevel"*"buyVolume")/nullif(sum("buyVolume"), 0) vwapbuy, 
      sum("sellVolume") volsell, 
      sum("sellLevel"*"sellVolume")/nullif(sum("sellVolume"), 0) vwapsell
      from (        
      select q.datetime, q.asset, booktype."buyVolume", booktype."buyLevel", 
      booktype."sellLevel", booktype."sellVolume" 
      from (
      select * from "b3-assetsbooks" 
      where asset=$1 AND datetime::TIMESTAMPTZ<=$2::TIMESTAMPTZ AND datetime::DATE=$2::DATE 
      order by datetime desc limit 1) q,
      jsonb_to_recordset(q."book-price") as 
      booktype("buyLevel" decimal, "buyOffers" int, "buyVolume" int, 
      "sellLevel" decimal, "sellOffers" int, "sellVolume" int)
      ) qb
      group by datetime, asset`,
      {
        asset: asset.asset,
        dateRef: dateRef.toJSDate(),
      },
    );

    if (!qBook || qBook.length === 0) return undefined;

    return {
      datetime: qBook[0].datetime,
      asset,
      volumeBuy: Number(qBook[0].volbuy),
      vwapBuy: +Number(qBook[0].vwapbuy).toFixed(2),
      volumeSell: Number(qBook[0].volsell),
      vwapSell: +Number(qBook[0].vwapsell).toFixed(2),
    };
  }

  public static mergeAssetsBook(
    assetsBook: IAssetBookDepth[],
  ): IMergedBooks | undefined {
    if (assetsBook.length === 0) return undefined;

    let volumeBuy = 0;
    let vwapBuy = 0;
    let volumeSell = 0;
    let vwapSell = 0;

    assetsBook.forEach(b => {
      volumeBuy += b.volumeBuy * b.asset.weight;
      vwapBuy += b.volumeBuy * b.asset.weight * b.vwapBuy;

      volumeSell += b.volumeSell * b.asset.weight;
      vwapSell += b.volumeSell * b.asset.weight * b.vwapSell;
    });

    return {
      volumeSell: volumeSell > 0 ? +Number(volumeSell).toFixed(2) : 0,
      vwapSell: volumeSell > 0 ? +Number(vwapSell / volumeSell).toFixed(2) : 0,
      vwapBuy: volumeBuy > 0 ? +Number(vwapBuy / volumeBuy).toFixed(2) : 0,
      volumeBuy: volumeBuy > 0 ? +Number(volumeBuy).toFixed(2) : 0,
      vwap:
        volumeBuy + volumeSell > 0
          ? (vwapBuy + vwapSell) / (volumeBuy + volumeSell)
          : 0,
      volume:
        volumeBuy > 0 || volumeSell > 0
          ? +Number(volumeBuy - volumeSell).toFixed(2)
          : 0,
    };
  }
}
