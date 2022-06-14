/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
// https://query1.finance.yahoo.com/v8/finance/chart/TSLA?symbol=TSLA&period1=1653436214&period2=1653954614&useYfid=true&interval=1m
// https://query1.finance.yahoo.com/v8/finance/chart/TSLA?symbol=TSLA&period1=1653436214&period2=1653954614&useYfid=true&interval=1m&includePrePost=true&events=div%7Csplit%7Cearn&lang=pt-BR&region=BR&crumb=VpfinU0LFZd&corsDomain=br.financas.yahoo.com
import { DateTime } from 'luxon';
import axios from 'axios';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { ILoadResult } from '../reportLoader';
import { loadJSONConfigFile } from '../utils';
import { IExchange, getExchange } from '../tcountry';
import { TChartDataOrigin } from '../../db/migrations/1653872110319-tbl_chartdata';

enum TYahooChartInterval {
  MINUTE_1 = '1m',
  HOUR_1 = '1h',
  DAY_1 = '1d',
}

interface IYahooSymbol {
  code: string;
  exchange: IExchange;
}

interface ICandle {
  timestamp: DateTime;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

const DEFAULT_CHART_INTERVAL = TYahooChartInterval.MINUTE_1;

export default class ChartLoaderYahoo extends ReportLoaderCalendar {
  public async process(params: { dateMatch: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateMatch: ${params.dateMatch.toFormat(
        'dd/MM/yyyy HH:mmZ',
      )}`,
    );

    const symbols: IYahooSymbol[] = (await this.getAllYahooSymbols())
      .filter(s => s.chartLoad === true)
      .map(s => {
        return { code: s.symbol, exchange: s.exchange };
      });

    let inserted = 0;
    for await (const symbol of symbols) {
      const qLastLoad = await this.queryFactory.runQuery(
        `SELECT MAX("timestamp-open") lastload FROM "chartdata" WHERE "asset-code"=$1 AND contract=$2 AND origin=$3`,
        {
          assetCode: symbol.code,
          contract: 'SPOT',
          origin: TChartDataOrigin.YAHOO,
        },
      );

      let tsLastLoad: DateTime;
      if (
        qLastLoad &&
        qLastLoad.length > 0 &&
        DateTime.fromJSDate(qLastLoad[0].lastload).isValid
      ) {
        tsLastLoad = DateTime.fromJSDate(qLastLoad[0].lastload, {
          zone: symbol.exchange.timezone,
        });
      } else
        tsLastLoad = (
          await ReportLoaderCalendar.subTradeDays(
            this.queryFactory,
            DateTime.now().setZone(symbol.exchange.timezone),
            1,
            symbol.exchange.country.code,
          )
        ).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

      const candles: ICandle[] = await this.retry({
        action: 'GET_CANDLES',
        symbol,
        tsLastLoad: tsLastLoad.set({ millisecond: 0 }),
      });

      const sql = `INSERT INTO "chartdata" 
        ("asset-code", contract, "timestamp-open", open, close, high, low, volume, origin) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT ("asset-code", contract, "timestamp-open") DO UPDATE SET 
        open=$4, close=$5, high=$6, low=$7, volume=$8, origin=$9`;

      for await (const candle of candles) {
        await this.queryFactory.runQuery(sql, {
          assetCode: symbol.code,
          contract: 'SPOT',
          timestamp: candle.timestamp.toJSDate(),
          open: candle.open,
          close: candle.close,
          high: candle.high,
          low: candle.low,
          volume: candle.volume,
          origin: TChartDataOrigin.YAHOO,
        });

        inserted++;
      }
      this.logger.silly(
        `[${this.processName}] Symbol: ${symbol.code} - Candles loaded: ${
          candles.length
        } - DateTime From: ${tsLastLoad.toFormat('dd/MM/yyyy HH:mmZ')}`,
      );
    }

    return { inserted, deleted: 0 };
  }

  public async performQuery(params: {
    action: string;
    symbol: IYahooSymbol;
    tsLastLoad: DateTime;
  }): Promise<ICandle[]> {
    if (params.action === 'GET_CANDLES') {
      if (params.tsLastLoad && !params.tsLastLoad.isValid)
        throw new Error(
          `PerformQuery() - Invalid tsLastLoad parameters - Parameters: ${JSON.stringify(
            params,
          )}`,
        );

      const now = DateTime.now().set({ millisecond: 0 });

      if (params.tsLastLoad.toMillis() >= now.toMillis())
        throw new Error(
          `PerformQuery() - tsLastLoad parameter (${params.tsLastLoad.toMillis()}) can't be higher now(${now.toMillis()}) - Parameters: ${JSON.stringify(
            params,
          )}`,
        );

      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${
        params.symbol.code
      }?symbol=${params.symbol.code}&period1=${
        params.tsLastLoad.toMillis() / 1000
      }&period2=${
        now.toMillis() / 1000
      }&useYfid=true&interval=${DEFAULT_CHART_INTERVAL}`;
      const headers = {
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=0',
      };
      const api = axios.create();
      const res = (await api.get(url, { headers })).data;

      if (res.chart.error)
        throw new Error(
          `PerformQuery() - API returned error: ${JSON.stringify(
            res.chart.error,
          )} - Parameters: ${JSON.stringify(params)}`,
        );

      if (
        res &&
        res.chart.result &&
        res.chart.result.length > 0 &&
        res.chart.result[0] &&
        res.chart.result[0].timestamp &&
        res.chart.result[0].timestamp.length > 0 &&
        res.chart.result[0].indicators.quote &&
        res.chart.result[0].indicators.quote.length > 0 &&
        res.chart.result[0].indicators.quote[0].open &&
        res.chart.result[0].indicators.quote[0].open.length > 0 &&
        res.chart.result[0].indicators.quote[0].close &&
        res.chart.result[0].indicators.quote[0].close.length > 0 &&
        res.chart.result[0].indicators.quote[0].high &&
        res.chart.result[0].indicators.quote[0].high.length > 0 &&
        res.chart.result[0].indicators.quote[0].low &&
        res.chart.result[0].indicators.quote[0].low.length > 0 &&
        res.chart.result[0].indicators.quote[0].volume &&
        res.chart.result[0].indicators.quote[0].volume.length > 0
      ) {
        const candles: ICandle[] = [];

        for (let i = 0; i < res.chart.result[0].timestamp.length; i++) {
          const tsCandle: DateTime = DateTime.fromMillis(
            res.chart.result[0].timestamp[i] * 1000,
            { zone: params.symbol.exchange.timezone },
          );
          if (
            !tsCandle.isValid ||
            !res.chart.result[0].indicators.quote[0].open[i] ||
            !res.chart.result[0].indicators.quote[0].close[i] ||
            !res.chart.result[0].indicators.quote[0].high[i] ||
            !res.chart.result[0].indicators.quote[0].low[i] ||
            !res.chart.result[0].indicators.quote[0].volume[i]
          )
            continue;

          candles.push({
            timestamp: tsCandle,
            open: Number(res.chart.result[0].indicators.quote[0].open[i]),
            close: Number(res.chart.result[0].indicators.quote[0].close[i]),
            high: Number(res.chart.result[0].indicators.quote[0].high[i]),
            low: Number(res.chart.result[0].indicators.quote[0].low[i]),
            volume: Number(res.chart.result[0].indicators.quote[0].volume[i]),
          });
        }

        return candles;
      }
    }
    throw new Error(
      `PerformQuery() - Missing parameters: ${JSON.stringify(params)}`,
    );
  }

  public async getAllYahooSymbols(): Promise<any[]> {
    const symbols: any[] = (
      await loadJSONConfigFile('loadconfig_yahoo.json')
    ).map((s: any) => {
      return {
        symbol: s.symbol,
        exchange: getExchange(s.exchange),
        chartLoad: s.chartLoad,
      };
    });

    if (!symbols || symbols.length === 0)
      throw new Error(
        'Empty TradindView Config File: config/loadconfig_yahoo.json',
      );

    if (symbols.find((s: any) => !s.exchange))
      throw new Error(
        `Wrong Exchange in TradindView Config File: config/loadconfig_yahoo.json: ${JSON.stringify(
          symbols.filter((s: any) => !s.exchange),
        )}`,
      );

    return symbols.filter((s: any) => !!s.exchange);
  }
}
