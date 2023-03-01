/* eslint-disable @typescript-eslint/no-unused-vars */
import tf from '@tensorflow/tfjs';
import { DateTime } from 'luxon';
import path from 'path';
import { QueryFactory } from '../../db/queryFactory';
import BaseAIAnalyser from './baseAIAnalyser';
import ReportLoaderCalendar, { TCountryCode } from '../reportLoaderCalendar';

const DAYS_LOOK_BACK = 30;

enum TTrendType {
  HIGH = 1,
  RANGE = 0,
  LOW = -1,
}

interface IDolData {
  doy: number;
  dow: number;
  isPayroll: boolean;
  isUSAHoliday: boolean;
  qttyUSAEventsHigh: number;
  qttyBRLEventsHigh: number;
  open: number;
  high: number;
  low: number;
  close: number;
  adjust: number;
  stddev: number;
  stddevd5: number;
  stddevd30: number;
  volume: number;
  quantity: number;
  vwap: number;
  vwapd5: number;
  vwapd30: number;
  poc: number;
  pocd5: number;
  pocd30: number;
  ptax: number;
  frp0vwap: number;
  frp0volume: number;
  frp1vwap: number;
  spotsettlevwap: number;
  spotsettlevolume: number;
  oiDOLcontract: number;
  oiDOLforeigns: number;
  oiDOLbanks: number;
  oiDOLnationals: number;
  di1a1open: number;
  di1a1close: number;
  di1a2open: number;
  di1a2close: number;
  volatilitymeand5: number;
  volatilitystddevd5: number;
}

interface IDolDataToPredict {
  doy: number;
  dow: number;
  open: number;
  frp0vwap: number;
  di1a1open: number;
  di1a2open: number;
  previousData: IDolData[];
  trendhigh: number;
  trendrange: number;
  trendlow: number;
}

export default class DolTrendAIAnalyser extends BaseAIAnalyser {
  constructor(name: string, dateRef: DateTime, queryFactory: QueryFactory) {
    const CSV_COLUMNS_CONFIG: { [key: string]: tf.data.ColumnConfig } = {
      doy: { isLabel: false },
      dow: { isLabel: false },
      isPayroll: { isLabel: false },
      isUSAHoliday: { isLabel: false },
      qttyUSAEventsHigh: { isLabel: false },
      qttyBRLEventsHigh: { isLabel: false },
      opend1: { isLabel: false },
      closed1: { isLabel: false },
      highd1: { isLabel: false },
      lowd1: { isLabel: false },
      adjustd1: { isLabel: false },
      stddevd1: { isLabel: false },
      stddevd1d5: { isLabel: false },
      stddevd1d30: { isLabel: false },
      quantityd1: { isLabel: false },
      volumed1: { isLabel: false },
      vwapd1: { isLabel: false },
      vwapd1d5: { isLabel: false },
      vwapd1d30: { isLabel: false },
      pocd1: { isLabel: false },
      pocd1d5: { isLabel: false },
      pocd1d30: { isLabel: false },
      ptaxd1: { isLabel: false },
      frp0vwapd1: { isLabel: false },
      frp0volumed1: { isLabel: false },
      frp1vwapd1: { isLabel: false },
      spotsettlevwap: { isLabel: false },
      spotsettlevolume: { isLabel: false },
      oicontractd1: { isLabel: false },
      oiforeignsd1: { isLabel: false },
      oinationalsd1: { isLabel: false },
      oibanksd1: { isLabel: false },
      di1a1opend1: { isLabel: false },
      di1a2opend1: { isLabel: false },
      di1a1closed1: { isLabel: false },
      di1a2closed1: { isLabel: false },
      open: { isLabel: true },
      frp0vwap: { isLabel: true },
      di1a1open: { isLabel: true },
      di1a2open: { isLabel: true },
      trendhigh: { isLabel: true },
      trendlow: { isLabel: true },
      trendrange: { isLabel: true },
    };
    super(name, dateRef, queryFactory, CSV_COLUMNS_CONFIG);
  }

  public buildModel(): tf.LayersModel {
    const model = tf.sequential();
    model.add(
      // input layer
      tf.layers.lstm({
        units: 64,
        activation: 'relu',
        inputShape: [
          Object.keys(this.csvColumnsConfig).filter(
            key => !this.csvColumnsConfig[key].isLabel,
          ).length,
          DAYS_LOOK_BACK,
        ], // D-1: tradeday#, isPayroll, isUSAHoliday, OHLC, adjust, stddev, stddev-d5, stddev-d30, quantity, volume, vwap, vwap-d5, vwap-d30, ptax, frp0-vwap, frp0-volume, oi_foreigns, oi_nationals, oi_banks
        returnSequences: true,
        recurrentDropout: 0.1,
      }),
    );

    // hidden layer
    model.add(
      tf.layers.lstm({
        units: 32,
        activation: 'relu',
        returnSequences: false,
        recurrentDropout: 0.1,
      }),
    );

    // output layer: trend high, range or low [0-100%]
    model.add(
      tf.layers.dense({
        units: Object.keys(this.csvColumnsConfig).filter(
          key => this.csvColumnsConfig[key].isLabel,
        ).length,
        activation: 'softmax',
      }),
    );

    model.compile({
      loss: 'meanSquaredError',
      optimizer: 'sgd',
      metrics: ['accuracy'],
    });

    return model;
  }

  public async trainModel(): Promise<tf.History> {
    // generate csvTrainData
    const pathToCSVTrainData = path.join(
      __dirname,
      '../../../../ai-data',
      `ai_${this.name}_${this.dateRef.toFormat('yyyyMMdd')}.csv`,
    );
    const csvTrainDataset = tf.data.csv(`file://${pathToCSVTrainData}`, {
      columnConfigs: this.csvColumnsConfig,
    });

    const flattenedDataset = csvTrainDataset
      .map(({ xs, ys }: any) => {
        // Convert xs(features) and ys(labels) from object form (keyed by
        // column name) to array form.
        return { xs: Object.values(xs), ys: Object.values(ys) };
      })
      .batch(10);

    const result = await this.model.fitDataset(flattenedDataset, {
      epochs: 10,
      batchesPerEpoch: 16,
    });

    return result;
  }

  public async generateCsvTrainingData(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  private async getTrainingData(dateRef: DateTime): Promise<any> {
    const isPayroll = await ReportLoaderCalendar.isPayroll(
      dateRef,
      this.queryFactory,
    );

    const isUSAHoliday = await ReportLoaderCalendar.isHoliday(
      this.queryFactory,
      dateRef,
      TCountryCode.US,
    );

    const ptax = await (async () => {
      const qPtax = await this.queryFactory.runQuery(
        `SELECT "pbrl_ptax_sell" ptax FROM "bcb-ptax" WHERE date=$1`,
        { date: dateRef.toJSDate() },
      );

      if (qPtax && qPtax.length > 0) return Number(qPtax[0].ptax) * 1000;
      return undefined;
    })();

    const contract = 'H23';

    const ohlc = await (async () => {
      const qohlc = await this.queryFactory.runQuery(
        `SELECT MAX(open) FILTER(WHERE rn_asc=1) AS open, 
        MAX(close) FILTER(WHERE rn_desc=1) AS close, 
        MAX(high) AS high, MIN(low) AS low
        FROM (SELECT t.*,
          ROW_NUMBER() OVER (ORDER BY "timestamp-open" ASC) rn_asc,
          ROW_NUMBER() OVER (ORDER BY "timestamp-open" DESC) rn_desc 
        FROM (SELECT t.* FROM "b3-ts-summary" t where
        "timestamp-open"::DATE =$1 and asset = ANY('{DOL${contract},WDO${contract}}')) t) t`,
        { date: dateRef.toJSDate() },
      );

      if (qohlc && qohlc.length > 0) {
        return {
          open: Number(qohlc[0].open),
          high: Number(qohlc[0].high),
          low: Number(qohlc[0].low),
          close: Number(qohlc[0].close),
        };
      }
      return undefined;
    })();

    const voldata = await (async () => {
      const qvoldata = await this.queryFactory.runQuery(
        `SELECT (comb).qtty AS volume, (comb).mean AS vwap, (comb).sd AS stddev, qtty FROM 
        (SELECT stddev_combine(volume, vwap, sigma) comb, sum(quantity) AS qtty FROM 
        (SELECT volume*0.2 volume, vwap, sigma, quantity FROM "b3-ts-summary" WHERE asset = 'WDO${contract}' AND volume>0 AND "timestamp-open"::DATE = $1::DATE
        UNION ALL 
        SELECT volume, vwap, sigma, quantity FROM "b3-ts-summary" WHERE asset = 'DOL${contract}' AND volume>0 AND "timestamp-open"::DATE = $1::DATE) q) q2`,
        { date: dateRef.toJSDate() },
      );

      if (qvoldata && qvoldata.length > 0) {
        return {
          quantity: Number(qvoldata[0].qtty),
          volume: Number(qvoldata[0].volume),
          vwap: Number(qvoldata[0].vwap),
          stddev: Number(qvoldata[0].stddev),
        };
      }
      return undefined;
    })();

    const summary = await (async () => {
      const qsummary = await this.queryFactory.runQuery(
        `SELECT (q1.adjust + q2.adjust)/2 AS adjust, (q1.oi+q2.oi) AS oicontract FROM 
        (SELECT settle AS adjust, "oi-close" - "oi-open" AS oi FROM "b3-summary" WHERE asset = 'DOL${contract}' AND "date" = $1::DATE) q1,
        (SELECT settle AS adjust, ("oi-close" - "oi-open")*0.2 AS oi FROM "b3-summary" WHERE asset = 'WDO${contract}' AND "date" = $1::DATE) q2`,
        { date: dateRef.toJSDate() },
      );

      if (qsummary && qsummary.length > 0) {
        return {
          adjust: Number(qsummary[0].adjust),
          oicontract: Number(qsummary[0].oicontract),
        };
      }
      return undefined;
    })();

    const players = await (async () => {
      const qplayers = await this.queryFactory.runQuery(
        `select sum(oiforeigns) oiforeigns, sum(oibanks) oibanks, sum(oinationals) oinationals from 
        (select ("for_inv_buy" - "for_inv_sell")*0.2 as oiforeigns, ("fin_corp_banks_buy" - "fin_corp_banks_sell")*0.2 as oibanks, ("inst_inv_national_investor_buy" - "inst_inv_national_investor_sell")*0.2 as oinationals from "b3-oi-players" where date = $1 and "asset-code" = 'WDO' and "asset-type"='FUTURES'
        union all
        select "for_inv_buy" - "for_inv_sell" as oiforeigns, ("fin_corp_banks_buy" - "fin_corp_banks_sell") as oibanks, ("inst_inv_national_investor_buy" - "inst_inv_national_investor_sell") as oinationals from "b3-oi-players" where date = $1 and "asset-code" = 'DOL' and "asset-type"='FUTURES') q;`,
        { date: dateRef.toJSDate() },
      );

      if (qplayers && qplayers.length > 0) {
        return {
          oiforeigns: Number(qplayers[0].adjust),
          oibanks: Number(qplayers[0].oibanks),
          oinationals: Number(qplayers[0].oinationals),
        };
      }
      return undefined;
    })();

    const frp = await (async () => {
      const qfrp0 = await this.queryFactory.runQuery(
        `SELECT "volume-size" volume, vwap FROM "b3-summary" WHERE date=$1::DATE AND asset='FRP0'`,
        { date: dateRef.toJSDate() },
      );
      const qfrp1 = await this.queryFactory.runQuery(
        `SELECT vwap FROM "b3-summary" WHERE date<$1::DATE AND asset='FRP1' ORDER BY date DESC LIMIT 1`,
        { date: dateRef.toJSDate() },
      );

      if (qfrp0 && qfrp0.length > 0 && qfrp1 && qfrp1.length > 0) {
        return {
          frp0vwap: Number(qfrp0[0].vwap),
          frp0volume: Number(qfrp0[0].volume),
          frp1vwap: Number(qfrp1[0].vwap),
        };
      }
      return undefined;
    })();

    const spotsettle = await (async () => {
      const qspot = await this.queryFactory.runQuery(``, {
        date: dateRef.toJSDate(),
      });

      if (qspot && qspot.length > 0) {
        return {
          spotsettlevolume: Number(qspot[0].spotsettlevolume),
          spotsettlevwap: Number(qspot[0].spotsettlevwap),
        };
      }
      return undefined;
    })();

    const volatility = await (async () => {
      // TO DO: deal with contract change
      const days = 5;
      const qvolatility = await this.queryFactory.runQuery(
        `select AVG(high-low) mean, stddev(high-low) sd from (select * from "b3-summary" where asset = 'DOL${contract}' and "date" <= $1 order by date desc limit ${days}) q`,
        { date: dateRef.toJSDate() },
      );

      if (qvolatility && qvolatility.length > 0) {
        return {
          volatilitymeand5: Number(qvolatility[0].mean),
          volatilitystddevd5: Number(qvolatility[0].sd),
        };
      }
      return undefined;
    })();

    const trendType = await (async () => {
      const qHigh = await this.queryFactory.runQuery(
        `select "timestamp-open" datetime, q.high level from "b3-ts-summary" b, (select MAX(high) high from "b3-ts-summary" where asset=any('{DOL${contract},WDO${contract}}') and "timestamp-open"::DATE = '2023-02-13') q where asset=any('{DOLH23}') and "timestamp-open"::DATE = $1 and b.high = q.high order by "timestamp-open" asc limit 1`,
        {
          date: dateRef.toJSDate(),
        },
      );

      const qLow = await this.queryFactory.runQuery(
        `select "timestamp-open" datetime, q.low level from "b3-ts-summary" b, (select MIN(low) low from "b3-ts-summary" where asset=any('{DOL${contract},WDO${contract}}') and "timestamp-open"::DATE = '2023-02-13') q where asset=any('{DOLH23}') and "timestamp-open"::DATE = $1 and b.low = q.low order by "timestamp-open" asc limit 1`,
        {
          date: dateRef.toJSDate(),
        },
      );

      if (qHigh && qHigh.length > 0 && qLow && qLow.length > 0)
        return qHigh[0].datetime < qLow[0].datetime
          ? TTrendType.LOW
          : TTrendType.HIGH;
      return undefined;
    })();
  }

  public async predict(): Promise<number> {
    throw new Error('Method not implemented.');
  }
}
