/* eslint-disable no-nested-ternary */
import { DateTime } from 'luxon';
import Query from './query';
import { QueryFactory } from '../../db/queryFactory';
import { IAssetWeight } from './queryPlayers';
import BaseBot, { TUserType } from '../../bot/baseBot';

interface IAssetQuotes {
  datetime: Date;
  asset: IAssetWeight;
  open: number | undefined;
  high: number | undefined;
  low: number | undefined;
  last: number | undefined;
  vwap: number | undefined;
  quantity: number | undefined;
  volume: number | undefined;
  aggressionQuantityBuy: number | undefined;
  aggressionQuantitySell: number | undefined;
  aggressionVolumeBuy: number | undefined;
  aggressionVolumeSell: number | undefined;
  theoricalLevel: number | undefined;
  theoricalVolumeBuy: number | undefined;
  theoricalVolumeSell: number | undefined;
  state: string;
  auction: boolean;
}

interface IMergedQuotes {
  high: number;
  low: number;
  last: number;
  vwap: number;
  volume: number;
  aggressionVolumeBalance: number;
  theoricalLevel: number;
  theoricalVolumeBuy: number;
  theoricalVolumeSell: number;
  volatility: number;
}

interface IAssetsQuotes {
  assets: IAssetWeight[];
  assetsQuotes: IAssetQuotes[];
  mergedQuotes: IMergedQuotes | undefined;
}

export default class QueryAssetsQuotes extends Query {
  public async process(params: {
    assets: IAssetWeight[];
    dateRef: DateTime;
    chatId?: number;
    messageId?: number;
  }): Promise<any> {
    const msgHeader = `ASSET QUOTES - Asset: ${params.assets.map(
      a => a.asset,
    )} - Date from: ${params.dateRef.toFormat('dd/MM/yyyy HH:mm:ss')}\n`;

    let botResponse;
    const assetsQuotes = await QueryAssetsQuotes.calculate(
      this.queryFactory,
      params.assets,
      params.dateRef,
    );

    if (assetsQuotes) {
      botResponse = BaseBot.printJSON(assetsQuotes);
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
    return !!assetsQuotes;
  }

  public static async calculate(
    queryFactory: QueryFactory,
    assets: IAssetWeight[],
    dateRef: DateTime,
  ): Promise<IAssetsQuotes | undefined> {
    const assetsQuotes: IAssetQuotes[] = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const asset of assets) {
      const assetQuotes = await QueryAssetsQuotes.getAssetQuotes(
        queryFactory,
        dateRef,
        asset,
      );
      if (assetQuotes) assetsQuotes.push(assetQuotes);
    }

    if (assetsQuotes.length === 0) return undefined;

    return {
      assets,
      assetsQuotes,
      mergedQuotes: QueryAssetsQuotes.mergeAssetsQuotes(assetsQuotes),
    };
  }

  public static async getAssetQuotes(
    queryFactory: QueryFactory,
    dateRef: DateTime,
    asset: IAssetWeight,
  ): Promise<IAssetQuotes | undefined> {
    /* const orderBy =
      dateRef.get('hour') >= 18 && dateRef.get('minute') >= 30 ? 'DESC' : 'ASC'; */

    const qQuotes = await queryFactory.runQuery(
      `SELECT datetime, asset, open, high, low, last, vwap, quantity, volume, 
      "aggression-quantity-buy" aggqttybuy, "aggression-quantity-sell" aggqttysell, 
      "aggression-volume-buy" aggvolbuy, "aggression-volume-sell" aggvolsell, 
      "theorical-level" theoricallevel, "theorical-volume-buy" theoricalvolbuy, 
      "theorical-volume-sell" theoricalvolsell, state, auction 
      FROM "b3-assetsquotes" 
      WHERE asset=$1 AND datetime::TIMESTAMPTZ<=$2::TIMESTAMPTZ AND datetime::DATE=$2::DATE
      ORDER BY datetime DESC LIMIT 1`,
      {
        asset: asset.asset,
        dateRef: dateRef.toJSDate(),
      },
    );

    if (!qQuotes || qQuotes.length === 0) return undefined;

    return {
      datetime: new Date(qQuotes[0].datetime),
      asset,
      open: Number(qQuotes[0].open) || undefined,
      high: Number(qQuotes[0].high) || undefined,
      low: Number(qQuotes[0].low) || undefined,
      last: Number(qQuotes[0].last) || undefined,
      vwap: Number(qQuotes[0].vwap) || undefined,
      quantity: Number(qQuotes[0].quantity) || undefined,
      volume: Number(qQuotes[0].volume) || undefined,
      aggressionQuantityBuy: Number(qQuotes[0].aggqttybuy) || undefined,
      aggressionQuantitySell: Number(qQuotes[0].aggqttysell) || undefined,
      aggressionVolumeBuy: Number(qQuotes[0].aggvolbuy) || undefined,
      aggressionVolumeSell: Number(qQuotes[0].aggvolsell) || undefined,
      theoricalLevel: Number(qQuotes[0].theoricallevel) || undefined,
      theoricalVolumeBuy: Number(qQuotes[0].theoricalvolbuy) || undefined,
      theoricalVolumeSell: Number(qQuotes[0].theoricalvolsell) || undefined,
      state: qQuotes[0].state,
      auction: !!qQuotes[0].auction,
    };
  }

  public static mergeAssetsQuotes(
    assetsQuotes: IAssetQuotes[],
  ): IMergedQuotes | undefined {
    if (assetsQuotes.length === 0) return undefined;

    let high = 0;
    let low = 0;
    let last = 0;
    let volume = 0;
    let sumVwapVolume = 0;
    let aggvolbuy = 0;
    let aggvolsell = 0;
    let theoricallevel = 0;
    let theoricalvolbuy = 0;
    let theoricalvolsell = 0;

    assetsQuotes.forEach(q => {
      if ((q.high || 0) > high) high = q.high || 0;

      if ((q.low || 0) < low || low === 0) low = q.low || 0;

      if (last === 0 && (q.last || 0) > 0) last = q.last || 0;
      else if (last > 0 && (q.last || 0) > 0) last = (last + (q.last || 0)) / 2;

      volume += (q.volume || 0) * q.asset.weight;

      sumVwapVolume += (q.vwap || 0) * (q.volume || 0) * q.asset.weight;

      aggvolbuy += (q.aggressionVolumeBuy || 0) * q.asset.weight;

      aggvolsell += (q.aggressionVolumeSell || 0) * q.asset.weight;

      if (theoricallevel === 0 && (q.theoricalLevel || 0) > 0)
        theoricallevel = q.theoricalLevel || 0;
      else if (theoricallevel > 0 && (q.theoricalLevel || 0) > 0)
        theoricallevel = (theoricallevel + (q.theoricalLevel || 0)) / 2;

      theoricalvolbuy += (q.theoricalVolumeBuy || 0) * q.asset.weight;

      theoricalvolsell += (q.theoricalVolumeSell || 0) * q.asset.weight;
    });

    return {
      high,
      low,
      last,
      vwap: volume > 0 ? +Number(sumVwapVolume / volume).toFixed(2) : 0,
      volume,
      aggressionVolumeBalance: aggvolbuy - aggvolsell,
      theoricalLevel:
        theoricallevel > 0 ? +Number(theoricallevel).toFixed(2) : 0,
      theoricalVolumeBuy: theoricalvolbuy,
      theoricalVolumeSell: theoricalvolsell,
      volatility: high - low,
    };
  }
}
