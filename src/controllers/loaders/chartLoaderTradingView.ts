/* eslint-disable no-continue */
/* eslint-disable no-loop-func */
/* eslint-disable no-useless-escape */
/* eslint-disable no-async-promise-executor */
/* eslint-disable no-empty */
/* eslint-disable no-restricted-syntax */
import { Page } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { DateTime } from 'luxon';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { ILoadResult } from '../reportLoader';
import { loadJSONConfigFile } from '../utils';
import { IExchange, getExchange } from '../tcountry';
import { TChartDataOrigin } from '../../db/migrations/1653872110319-tbl_chartdata';

interface ITradingViewSymbol {
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

class ChartLoaderTradingView extends ReportLoaderCalendar {
  public async process(params: { dateMatch: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateMatch: ${params.dateMatch.toFormat(
        'dd/MM/yyyy HH:mmZ',
      )}`,
    );

    const results: ILoadResult[] = [];
    const symbols: ITradingViewSymbol[] = (
      await this.getAllTradingViewSymbols()
    )
      .filter(s => s.chartLoad === true)
      .map(s => {
        return {
          code: s.symbol,
          exchange: s.exchange,
        };
      })
      .filter(s => !!(s.code && s.exchange));

    if (symbols.length === 0) {
      this.logger.warn(
        `[${this.processName}] No symbols selected for chart loading.`,
      );
      return { inserted: -1, deleted: 0 };
    }

    puppeteer.use(StealthPlugin());
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--single-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--no-zygote',
        process.env.NODE_ENV === 'PROD' ? '' : '--remote-debugging-port=9228',
        process.env.NODE_ENV === 'PROD'
          ? ''
          : '--remote-debugging-address=0.0.0.0',
      ],
    });
    const page = await browser.newPage();

    try {
      for await (const symbol of symbols) {
        const res = await this.loadChartData(symbol, page);
        results.push(res);
      }
    } finally {
      try {
        if (browser) {
          const browserPId = browser.process()!.pid!;
          process.kill(browserPId);
          // await browser.close();
        }
      } catch (e) {}
    }

    return results.length > 0
      ? results.reduce((total, result) => {
          return {
            inserted: total.inserted + result.inserted,
            deleted: total.deleted + result.deleted,
          };
        })
      : { inserted: 0, deleted: 0 };
  }

  private async loadChartData(
    symbol: ITradingViewSymbol,
    page: Page,
  ): Promise<ILoadResult> {
    const sql = `INSERT INTO "chartdata" 
    ("asset-code", contract, "timestamp-open", open, close, high, low, volume, origin) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT ("asset-code", contract, "timestamp-open") DO UPDATE SET 
    open=$4, close=$5, high=$6, low=$7, volume=$8, origin=$9`;

    let inserted = 0;

    await this.sleep(
      Number(process.env.TRADINGVIEW_CHARTLOAD_QUERY_INTERVAL || '5'),
    );
    const qLastTS = await this.queryFactory.runQuery(
      `SELECT MAX("timestamp-open") lastts FROM "chartdata" WHERE "asset-code"=$1 AND contract=$2 AND origin=$3`,
      {
        assetCode: symbol.code,
        contract: 'SPOT',
        origin: TChartDataOrigin.TRADINGVIEW,
      },
    );

    let tsLastLoad: DateTime;
    if (!qLastTS || qLastTS.length === 0 || !qLastTS[0].lastts) {
      const now = DateTime.now().setZone(symbol.exchange.timezone); // (this.exchange.timezone);
      const lastTradeDate = await this.subTradeDays(
        now,
        1,
        symbol.exchange.country.code,
        // this.exchange.country.code,
      );

      tsLastLoad = lastTradeDate.set({
        hour: 9,
        minute: 0,
        second: 0,
        millisecond: 0,
      });
    } else {
      tsLastLoad = DateTime.fromJSDate(qLastTS[0].lastts, {
        zone: symbol.exchange.timezone, // this.exchange.timezone,
      });
    }

    const aCandleData: ICandle[] = await this.retry({
      action: 'GET_SYMBOL_CANDLES',
      symbol,
      page,
      tsLastLoad,
    });

    for await (const candle of aCandleData) {
      await this.queryFactory.runQuery(sql, {
        assetCode: symbol.code,
        contract: 'SPOT',
        timestampopen: candle.timestamp.toJSDate(),
        open: candle.open,
        close: candle.close,
        high: candle.high,
        low: candle.low,
        volume: candle.volume,
        origin: TChartDataOrigin.TRADINGVIEW,
      });
      inserted++;
    }

    this.logger.silly(
      `[${this.processName}] Symbol ${
        symbol.code
      } - Candles loaded: ${inserted} - DateTime From: ${tsLastLoad.toFormat(
        'dd/MM/yyyy HH:mmZ',
      )}`,
    );

    return { inserted, deleted: 0 };
  }

  public async performQuery(params: {
    action: string;
    symbol: ITradingViewSymbol;
    page: Page;
    tsLastLoad?: DateTime;
  }): Promise<ICandle[]> {
    // Read chart websocket
    if (params.action === 'GET_SYMBOL_CANDLES') {
      if (!params.symbol || !params.page)
        throw new Error(
          `[${
            this.processName
          }] PerformQuery() - Action: GET_SYMBOL_CANDLES - Missing parameters: ${JSON.stringify(
            params,
          )}`,
        );

      try {
        await params.page!.evaluate(() => window.stop());
      } catch (e) {}

      const url = `https://www.tradingview.com/chart/?symbol=${params.symbol.code}&interval=1`;

      await params.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
      );
      params.page.setDefaultNavigationTimeout(0);

      const cdp = await params.page.target().createCDPSession();
      try {
        await cdp.send('Network.clearBrowserCookies');
      } catch (e) {}
      await cdp.send('Network.enable');
      await cdp.send('Page.enable');

      const aCandle: ICandle[] = [];
      let finished = false;
      let queryTimeout: NodeJS.Timeout;
      let chartSession: string | undefined;

      await new Promise<void>(async (resolve, reject): Promise<void> => {
        const timeoutInterval =
          (Number(process.env.TRADINGVIEW_CHARTLOAD_TIMEOUT || '15') < 15
            ? 15
            : Number(process.env.TRADINGVIEW_CHARTLOAD_TIMEOUT || '15')) * 1000;
        const doTimeout = async () => {
          try {
            await params.page!.evaluate(() => window.stop());
          } catch (e) {}

          // Remove CDP listeners and detach CDP from browser
          try {
            cdp.removeAllListeners('Network.webSocketFrameReceived');
          } catch (e) {}
          try {
            await cdp.detach();
          } catch (e) {}

          reject(
            new Error(
              `[${this.processName}] Chart timed out - Symbol: ${params.symbol.code} - Candles loaded: ${aCandle.length}`,
            ),
          );
        };
        queryTimeout = setTimeout(doTimeout, timeoutInterval);

        let readingData = false;

        cdp.on('Network.webSocketFrameReceived', async res => {
          if (!res || !res.response || !res.response.payloadData) return;

          const msg = res.response.payloadData;

          // Chart data reading finished
          if (msg.match(/^\~m\~\d+\~m\~\~h\~\d+$/)) {
            await this.sleep(1);
            if (readingData) return;

            try {
              await params.page!.evaluate(() => window.stop());
            } catch (e) {}
            resolve();
            return;
          }

          const fixed = `[${msg
            .replace(/\~m\~\d+\~m\~/g, '')
            .replace(/\}\{/g, '}, {')}]`; // Fix and insert messages into an array

          let aObjMsg: any;
          try {
            aObjMsg = JSON.parse(fixed);
          } catch (e) {
            return;
          }
          for await (const objMsg of aObjMsg) {
            if (objMsg.m === 'wrong_data') {
              try {
                await params.page!.evaluate(() => window.stop());
              } catch (e) {}

              // Remove CDP listeners and detach CDP from browser
              try {
                cdp.removeAllListeners('Network.webSocketFrameReceived');
              } catch (e) {}
              try {
                await cdp.detach();
              } catch (e) {}

              reject(
                new Error(
                  `[${this.processName}] Chart wrong_data message found - Symbol: ${params.symbol.code} - Last ts chart: ${aCandle[0].timestamp} - Last ts in DB: ${params.tsLastLoad}`,
                ),
              );
            } else if (
              objMsg.m === 'timescale_update' &&
              objMsg.p &&
              objMsg.p.length > 1 &&
              objMsg.p[1].sds_1 &&
              typeof objMsg.p[1].sds_1 === 'object' &&
              objMsg.p[1].sds_1.s &&
              objMsg.p[1].sds_1.s.length > 0
            ) {
              readingData = true;
              clearTimeout(queryTimeout); // Stops timeout to process data received
              // eslint-disable-next-line prefer-destructuring
              if (objMsg.p[0]) chartSession = objMsg.p[0];

              const msgCandles: ICandle[] = [];
              for (let i = 0; i < objMsg.p[1].sds_1.s.length; i++) {
                const tsCandle = DateTime.fromMillis(
                  Number(objMsg.p[1].sds_1.s[i].v[0]) * 1000,
                  {
                    zone: params.symbol.exchange.timezone, // this.exchange.timezone,
                  },
                );
                if (
                  !(
                    tsCandle.isValid &&
                    Number(objMsg.p[1].sds_1.s[i].v[1]) > 0 &&
                    Number(objMsg.p[1].sds_1.s[i].v[2]) > 0 &&
                    Number(objMsg.p[1].sds_1.s[i].v[3]) > 0 &&
                    Number(objMsg.p[1].sds_1.s[i].v[4]) > 0 &&
                    Number(objMsg.p[1].sds_1.s[i].v[5]) > 0
                  )
                )
                  continue;

                /* if (
                  params.tsLastLoad &&
                  tsCandle.toMillis() < params.tsLastLoad.toMillis()
                ) {
                  finished = true;
                  // break;
                } */

                if (
                  !params.tsLastLoad ||
                  tsCandle.toMillis() >= params.tsLastLoad.toMillis()
                ) {
                  msgCandles.push({
                    timestamp: tsCandle,
                    open: objMsg.p[1].sds_1.s[i].v[1],
                    close: objMsg.p[1].sds_1.s[i].v[4],
                    high: objMsg.p[1].sds_1.s[i].v[2],
                    low: objMsg.p[1].sds_1.s[i].v[3],
                    volume: objMsg.p[1].sds_1.s[i].v[5],
                  });
                } else finished = true;
                /*                 if (
                  params.tsLastLoad &&
                  tsCandle.toMillis() === params.tsLastLoad.toMillis()
                ) {
                  finished = true;
                  // break;
                } */
              }

              aCandle.unshift(...msgCandles);
              if (
                aCandle.length !== 0 &&
                params.tsLastLoad &&
                aCandle[0].timestamp.toMillis() >
                  params.tsLastLoad.toMillis() &&
                !finished
              ) {
                if (!chartSession) {
                  try {
                    await params.page!.evaluate(() => window.stop());
                  } catch (e) {}

                  // Remove CDP listeners and detach CDP from browser
                  try {
                    cdp.removeAllListeners('Network.webSocketFrameReceived');
                  } catch (e) {}
                  try {
                    await cdp.detach();
                  } catch (e) {}

                  reject(
                    new Error(
                      `Couldn't find chart session - Symbol: ${params.symbol.code} - Last ts chart: ${aCandle[0].timestamp} - Last ts in DB: ${params.tsLastLoad}`,
                    ),
                  );
                }

                const candlesToRead = aCandle[0].timestamp.diff(
                  params.tsLastLoad!,
                  'minutes',
                ).minutes;

                const maxReqData =
                  Number(
                    process.env.TRADINGVIEW_CHARTLOAD_CANDLE_MAX_REQUEST_DATA ||
                      '3780',
                  ) > 3780
                    ? 3780
                    : Number(
                        process.env
                          .TRADINGVIEW_CHARTLOAD_CANDLE_MAX_REQUEST_DATA ||
                          '3780',
                      );
                const jsonReqData = `{"m":"request_more_data","p":["${chartSession}","sds_1",${
                  candlesToRead > maxReqData ? maxReqData : candlesToRead
                }]}`;
                const msgRequestData = `~m~${jsonReqData.length}~m~${jsonReqData}`;
                const wsHandler = await params.page!.evaluateHandle(
                  () => WebSocket.prototype,
                );
                const wsInstances = await params.page!.queryObjects(wsHandler);

                const msgSent = await params.page!.evaluate(
                  (wsSockets, msgReqData) => {
                    // wss://pushstream.tradingview.com/message-pipe-ws/public
                    // wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=2022_05_27-14_06
                    const wsChart = wsSockets.find(
                      (ws: any) =>
                        ws.url.includes('tradingview.com') &&
                        ws.url.includes('socket'),
                    );

                    if (wsChart) {
                      try {
                        // Send request data message
                        wsChart.send(msgReqData);
                      } catch (e) {
                        return false;
                      }
                      return true;
                    }
                    return false;
                  },
                  wsInstances,
                  msgRequestData,
                );
                try {
                  await wsInstances.dispose();
                  await wsHandler.dispose();
                } catch (e) {}

                if (!msgSent) {
                  try {
                    await params.page!.evaluate(() => window.stop());
                  } catch (e) {}

                  // Remove CDP listeners and detach CDP from browser
                  try {
                    cdp.removeAllListeners('Network.webSocketFrameReceived');
                  } catch (e) {}
                  try {
                    await cdp.detach();
                  } catch (e) {}

                  reject(
                    new Error(
                      `[${this.processName}] Couldn't send request_more_data messsage - Symbol: ${params.symbol.code} - Last ts chart: ${aCandle[0].timestamp} - Last ts in DB: ${params.tsLastLoad}`,
                    ),
                  );
                }
                // Restart timeout
                queryTimeout = setTimeout(doTimeout, timeoutInterval);
                readingData = false;
                return;
              }

              if (finished) {
                resolve();
                return;
              }

              // Restart timeout
              queryTimeout = setTimeout(doTimeout, timeoutInterval);
              readingData = false;
            }
          }
        });

        try {
          await params.page!.goto(`${url}`);
        } catch (e) {}
      });

      if (queryTimeout!) {
        try {
          clearTimeout(queryTimeout!);
        } catch (e) {}
      }
      try {
        cdp.removeAllListeners('Network.webSocketFrameReceived');
      } catch (e) {}
      try {
        await cdp.detach();
      } catch (e) {}
      // Sort candles by timestamp in ascending order
      aCandle.sort((a, b) => {
        if (a.timestamp.toMillis() > b.timestamp.toMillis()) return 1;
        if (a.timestamp.toMillis() < b.timestamp.toMillis()) return -1;
        return 0;
      });
      return aCandle.filter(
        (v, i, a) =>
          i ===
          a.findIndex(t => t.timestamp.toMillis() === v.timestamp.toMillis()),
      ); // Remove candle timestamp duplicates
    }

    throw new Error(
      `[${
        this.processName
      }] PerformQuery() - Unknown action parameter: ${JSON.stringify(params)}`,
    );
  }

  public async getAllTradingViewSymbols(): Promise<any[]> {
    const symbols: any[] = (
      await loadJSONConfigFile('loadconfig_tradingview.json')
    ).map((s: any) => {
      return {
        symbol: s.symbol,
        exchange: getExchange(s.exchange),
        chartLoad: s.chartLoad,
      };
    });

    if (!symbols || symbols.length === 0)
      throw new Error(
        'Empty TradindView Config File: config/loadconfig_tradingview.json',
      );

    if (symbols.find((s: any) => !s.exchange))
      throw new Error(
        `Wrong Exchange in TradindView Config File: config/loadconfig_tradingview.json: ${JSON.stringify(
          symbols.filter((s: any) => !s.exchange),
        )}`,
      );

    return symbols.filter((s: any) => !!s.exchange);
  }
}

export default ChartLoaderTradingView;
