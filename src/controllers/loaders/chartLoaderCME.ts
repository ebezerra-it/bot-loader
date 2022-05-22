/* eslint-disable no-nested-ternary */
/* eslint-disable no-loop-func */
/* eslint-disable no-empty-pattern */
/* eslint-disable no-useless-escape */
/* eslint-disable no-async-promise-executor */
/* eslint-disable no-continue */
/* eslint-disable no-empty */
/* eslint-disable no-restricted-syntax */
import { Page } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { DateTime } from 'luxon';
import axios from 'axios';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { ILoadResult } from '../reportLoader';
import SummaryCME, { IAsset } from './summaryCME';

interface IContract {
  code: string;
  letter: string;
  year: number;
  volumeDay: number;
  exchangeCode: string | undefined;
}

interface ICandle {
  timestamp: DateTime;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

class ChartLoaderCME extends ReportLoaderCalendar {
  public async process(params: { dateMatch: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateMatch: ${params.dateMatch.toFormat(
        'dd/MM/yyyy HH:mmZ',
      )}`,
    );

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

    const results: ILoadResult[] = [];
    const assets = (await this.getAllCMEAssets()).filter(
      a => a.chartLoadFutures,
    );
    try {
      for await (const asset of assets) {
        const res = await this.loadChartDataAsset(asset, page);
        this.logger.silly(
          `[${this.processName}] Asset ${
            asset.globexcode
          } - Candles loaded: ${JSON.stringify(res)}`,
        );
        results.push(res);
      }
    } finally {
      try {
        if (browser) await browser.close();
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

  private async loadChartDataAsset(
    asset: IAsset,
    page: Page,
  ): Promise<ILoadResult> {
    const sql = `INSERT INTO "cme-chartdata" 
    (globexcode, contract, "product-id", "timestamp-open", open, close, high, low, volume) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (globexcode, contract, "timestamp-open") DO UPDATE SET 
    open=$5, close=$6, high=$7, low=$8, volume=$9`;

    let inserted = 0;

    let contracts: IContract[] = await this.retry({
      action: 'GET_ASSET_CONTRACTS',
      asset,
    });
    const qContracts = await this.queryFactory.runQuery(
      `SELECT contract FROM "cme-summary" 
      WHERE globexcode=$1 AND SUBSTRING(contract, 2, 2) >= $2
      GROUP BY contract 
      ORDER BY SUBSTRING(contract, 2, 2) ASC, SUBSTRING(contract, 1, 1) ASC`,
      {
        globexcode: asset.globexcode,
        year: String(DateTime.now().year - 1).substring(2, 4),
      },
    );
    if (qContracts && qContracts.length > 0) {
      contracts = contracts.filter(c =>
        qContracts.find((qc: any) => qc.contract === c.code || c.volumeDay > 0),
      );
    }

    if (!contracts) return { inserted: 0, deleted: 0 };

    for await (const contract of contracts) {
      if (!contract.exchangeCode) {
        this.logger.warn(
          `[${
            this.processName
          }] Unindentified contract exchange code - Asset: ${
            asset.globexcode
          } - Contract: ${JSON.stringify(contract)}`,
        );
        // continue; // keep it processing and the exchangecode is ignored in TradingView url
      }

      await this.sleep(Number(process.env.CME_CHARTLOAD_QUERY_INTERVAL || '5'));
      const qLastTS = await this.queryFactory.runQuery(
        `SELECT MAX("timestamp-open") lastts FROM "cme-chartdata" WHERE globexcode=$1 AND contract=$2`,
        {
          globexcode: asset.globexcode,
          contract: contract.code,
        },
      );

      let tsLastLoad: DateTime;
      if (!qLastTS || qLastTS.length === 0 || !qLastTS[0].lastts) {
        const now = DateTime.now().setZone(this.exchange.timezone);
        const lastTradeDate = await this.subTradeDays(
          now,
          1,
          this.exchange.country.code,
        );

        tsLastLoad = lastTradeDate.set({
          hour: 16,
          minute: 0,
          second: 0,
          millisecond: 0,
        });
      } else {
        tsLastLoad = DateTime.fromJSDate(qLastTS[0].lastts, {
          zone: this.exchange.timezone,
        });
      }

      const aCandleData: ICandle[] = await this.retry({
        action: 'GET_ASSET_CONTRACT_CANDLES',
        asset,
        contract,
        page,
        tsLastLoad,
      });

      let insertedContract = 0;
      for await (const candle of aCandleData) {
        await this.queryFactory.runQuery(sql, {
          globexcode: asset.globexcode,
          contract: contract.code,
          productId: asset.productId,
          timestampopen: candle.timestamp.toJSDate(),
          open: candle.open,
          close: candle.close,
          high: candle.high,
          low: candle.low,
          volume: candle.volume,
        });
        inserted++;
        insertedContract++;
      }

      this.logger.silly(
        `[${this.processName}] Asset ${asset.globexcode} - Contract ${
          contract.code
        } - Candles loaded: ${insertedContract} - DateTime From: ${tsLastLoad.toFormat(
          'dd/MM/yyyy HH:mmZ',
        )}`,
      );
    }
    return { inserted, deleted: 0 };
  }

  public async performQuery(params: {
    action: string;
    pageNumber?: string;
    asset?: IAsset;
    contract?: IContract;
    page?: Page;
    tsLastLoad?: DateTime;
  }): Promise<
    IContract[] | ICandle[] | { assets: IAsset[]; totalPages: number }
  > {
    if (params.action === 'GET_ASSETS') {
      if (!params.pageNumber)
        throw new Error(
          `[${this.processName}] PerformQuery() - Action: GET_ASSETS - Missing parameters`,
        );

      const url = `https://www.cmegroup.com/services/product-slate?sortAsc=false&pageNumber=${
        params.pageNumber
      }&cleared=Futures&pageSize=${process.env.CME_REQUEST_PAGESIZE || '5000'}`;

      const headers = {
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=0',
      };
      const api = axios.create();
      const aAssets: IAsset[] = [];
      const res = (await api.get(url, { headers })).data;
      if (res && res.products && res.products.length > 0) {
        res.products.forEach((p: any) => {
          aAssets.push({
            globexcode: p.globex,
            caption: p.name,
            productId: p.id,
            summaryFutures: false,
            summaryOptions: false,
            chartLoadFutures: false,
          });
        });
      }
      return { assets: aAssets, totalPages: res.props.pageTotal };
    }

    if (params.action === 'GET_ASSET_CONTRACTS') {
      if (!params.asset)
        throw new Error(
          `[${
            this.processName
          }] PerformQuery() - Action: GET_ASSET_CONTRACTS - Missing parameters: ${JSON.stringify(
            params,
          )}`,
        );

      const contracts: IContract[] = [];
      const url = `https://www.cmegroup.com/CmeWS/mvc/Quotes/Future/${params.asset.productId}/G`;

      const headers = {
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=0',
      };
      const api = axios.create();
      const resContracts = (await api.get(url, { headers })).data;
      if (resContracts.quotes && resContracts.quotes.length > 0) {
        resContracts.quotes.forEach((c: any) => {
          if (c.priceChart) {
            contracts.push({
              code: [
                c.priceChart.monthYear.slice(0, 1),
                String(c.priceChart.year).slice(2, 4),
              ].join(''),
              letter: c.priceChart.monthYear.slice(0, 1),
              year: c.priceChart.year,
              volumeDay: Number(String(c.volume).replace(/,/g, '')),
              exchangeCode:
                c.exchangeCode === 'XCME'
                  ? 'CME_GBX'
                  : c.exchangeCode === 'XNYM'
                  ? 'NYMEX_GBX'
                  : c.exchangeCode === 'XCBT'
                  ? 'CBOT_GBX'
                  : c.exchangeCode === 'XCEC'
                  ? 'COMEX_GBX'
                  : undefined,
            });
          }
        });
      }
      return contracts;
    }

    // Read chart websocket
    if (params.action === 'GET_ASSET_CONTRACT_CANDLES') {
      if (!params.asset || !params.contract || !params.page)
        throw new Error(
          `[${
            this.processName
          }] PerformQuery() - Action: GET_ASSET_CONTRACT_CANDLES - Missing parameters: ${JSON.stringify(
            params,
          )}`,
        );

      try {
        await params.page!.evaluate(() => window.stop());
      } catch (e) {}
      const url = `https://s.tradingview.com/cmewidgetembed/?frameElementId=tradingview_fa45f&symbol=${
        params.contract.exchangeCode
          ? params.contract.exchangeCode.concat('%3A') // 'CME:6LM2022'
          : ''
      }${params.asset.globexcode}${params.contract.letter}${
        params.contract.year
      }&interval=1&hidesidetoolbar=0&symboledit=1&saveimage=1&toolbarbg=E4E8EB&studies=%5B%5D&style=0&studies_overrides=%7B%7D&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&venue=0&utm_source=www.cmegroup.com&utm_medium=widget&utm_campaign=chart&utm_term=${
        params.contract.exchangeCode
          ? params.contract.exchangeCode.concat('%3A')
          : ''
      }${params.asset.globexcode}${params.contract.letter}${
        params.contract.year
      }`;

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
      let queryTimeout: NodeJS.Timeout;
      let chartSession: string | undefined;

      await new Promise<void>(async (resolve, reject): Promise<void> => {
        const timeoutInterval =
          (Number(process.env.CME_CHARTLOAD_TIMEOUT || '15') < 15
            ? 15
            : Number(process.env.CME_CHARTLOAD_TIMEOUT || '15')) * 1000;
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
              `[${this.processName}] Chart timed out - Asset: ${
                params.asset!.globexcode
              } - Contract: ${params.contract!.code} - Candles loaded: ${
                aCandle.length
              }`,
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
                  `[${this.processName}] Chart wrong_data message found - Asset: ${params.asset?.globexcode} - Contract: ${params.contract?.code} - Last ts chart: ${aCandle[0].timestamp} - Last ts in DB: ${params.tsLastLoad}`,
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
                    zone: this.exchange.timezone,
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
                }
              }

              aCandle.unshift(...msgCandles);
              if (
                aCandle.length !== 0 &&
                params.tsLastLoad &&
                aCandle[0].timestamp.toMillis() > params.tsLastLoad.toMillis()
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
                      `Couldn't find chart session - Asset: ${params.asset?.globexcode} - Contract: ${params.contract?.code} - Last ts chart: ${aCandle[0].timestamp} - Last ts in DB: ${params.tsLastLoad}`,
                    ),
                  );
                }

                const candlesToRead = aCandle[0].timestamp.diff(
                  params.tsLastLoad!,
                  'minutes',
                ).minutes;

                const maxReqData =
                  Number(
                    process.env.CME_CHARTLOAD_CANDLE_MAX_REQUEST_DATA || '3780',
                  ) > 3780
                    ? 3780
                    : Number(
                        process.env.CME_CHARTLOAD_CANDLE_MAX_REQUEST_DATA ||
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
                    // wss://data-cme-v2.tradingview.com/socket.io/websocket?from=cmewidgetembed%2F&date=2022_03_14-11_19
                    // wss://pushstream.tradingview.com/message-pipe-ws/public
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
                      `[${this.processName}] Couldn't send request_more_data messsage - Asset: ${params.asset?.globexcode} - Contract: ${params.contract?.code} - Last ts chart: ${aCandle[0].timestamp} - Last ts in DB: ${params.tsLastLoad}`,
                    ),
                  );
                }
                // Restart timeout
                queryTimeout = setTimeout(doTimeout, timeoutInterval);
                readingData = false;
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

  public async getAllCMEAssets(): Promise<IAsset[]> {
    const aAssets: IAsset[] = [];
    let pageNumber = 1;
    let totalPages = 1;

    while (pageNumber <= totalPages) {
      const res = await this.retry({ action: 'GET_ASSETS', pageNumber });
      aAssets.push(...res.assets);

      totalPages = res.totalPages;
      pageNumber++;

      if (pageNumber <= totalPages)
        await this.sleep(Number(process.env.CME_QUERY_INTERVAL || '0'));
    }

    if (aAssets.length === 0)
      throw new Error(
        `[${this.processName}] getAllCMEAssets() - Unable to retrieve assets from CME - GET_ASSETS`,
      );

    return (await SummaryCME.getCMEAssets())
      .map(a => {
        const asset = aAssets.find(aa => aa.globexcode === a.globexcode);
        if (!asset) {
          this.logger.warn(
            `[${
              this.processName
            }] getAllCMEAssets() - CME/JSON file asset not found in CME data or productId mismatch - CME data Asset: ${JSON.stringify(
              asset,
            )} - JSON file Asset: ${JSON.stringify(a)}`,
          );
        }
        return {
          globexcode: a.globexcode,
          caption: asset ? asset.caption : '',
          productId: asset ? asset.productId : 0,
          summaryFutures: a.summaryFutures,
          summaryOptions: a.summaryOptions,
          chartLoadFutures: a.chartLoadFutures,
        };
      })
      .filter(aaa => aaa.productId > 0);
  }
}

export default ChartLoaderCME;
