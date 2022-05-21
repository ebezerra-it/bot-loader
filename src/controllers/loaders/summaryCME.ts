/* eslint-disable prefer-destructuring */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-continue */
/* eslint-disable no-cond-assign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable camelcase */
import axios from 'axios';
import { DateTime } from 'luxon';
import { isNumber, loadJSONConfigFile } from '../utils';
import { ILoadResult } from '../reportLoader';
import ReportLoaderCalendar from '../reportLoaderCalendar';

/*
https://www.cmegroup.com/market-data/daily-bulletin.html
The previous trade date Daily Bulletin is as Preliminary report at ~9:00pm CT,
and the Final report updates at ~10:00am CT next business day.

Schedule for FINAL REPORT: 0 30 10 * * MON-FRI (America/Chicago)
*/
enum TReportType {
  PRELIMINARY = 'P',
  FINAL = 'F',
}

enum TOptionType {
  PUT = 'PUT',
  CALL = 'CALL',
}

enum TTradeSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

interface IBlockTradeCMELeg {
  exchange: string;
  type: string;
  matMonthYear: DateTime;
  matDate: DateTime;
  symbol: string;
  globexCode: string;
  productId: number;
  contract: string;
  optionType: TOptionType | undefined;
  optionStrikePrice: number | undefined;
  ratio: number;
  tradeSide: TTradeSide;
  size: number;
  price: number;
  settle: number;
}

interface IBlockTradeCME {
  calendarDate: DateTime;
  tradeDate: DateTime;
  exchange: string;
  action: string;
  type: string;
  symbol: string;
  globexCode: string | undefined;
  productId: number | undefined;
  contract: string | undefined;
  optionType: TOptionType | undefined;
  optionStrikePrice: number | undefined;
  matMonthYear: DateTime;
  matDate: DateTime;
  size: number | undefined;
  price: number | undefined;
  settle: number | undefined;
  tradeLegs: IBlockTradeCMELeg[];
}

interface IAsset {
  productId: number;
  globexcode: string;
  caption: string;
  summaryFutures: boolean;
  summaryOptions: boolean;
  chartLoadFutures: boolean;
}

interface ISettleData {
  month: string;
  open: string;
  high: string;
  low: string;
  last: string;
  change: string;
  settle: string;
  volume: string;
  openInterest: string;
}

interface IVolumeData {
  month: string;
  monthID: string;
  globex: string;
  openOutcry: string;
  totalVolume: string;
  blockVolume: string;
  efpVol: string;
  efrVol: string;
  eooVol: string;
  efsVol: string;
  subVol: string;
  pntVol: string;
  tasVol: string;
  deliveries: string;
  opnt: string;
  aon: string;
  atClose: string;
  change: string;
  strike: string;
  exercises: string;
}

interface ISettle {
  empty: boolean;
  settlements: ISettleData[];
}

interface IVolume {
  tradeDate: string;
  totals: IVolumeData;
  monthData: IVolumeData[];
  empty: boolean;
}

class SummaryCME extends ReportLoaderCalendar {
  reportType: TReportType;

  async process(params: {
    dateRef: DateTime;
    dateMatch: DateTime;
  }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );

    const repType = await this.getReportType(params.dateRef);
    if (!repType || repType !== TReportType.FINAL) {
      this.logger.warn(
        `[${
          this.processName
        }] Final Report Type unavailable for trade date: ${params.dateRef.toFormat(
          'dd/MM/yyyy',
        )}`,
      );
      return { inserted: 0, deleted: 0 };
    }
    this.reportType = repType;

    await this.sleep(Number(process.env.CME_QUERY_INTERVAL || '2'));

    const result: ILoadResult = { inserted: 0, deleted: 0 };
    let res: ILoadResult = { inserted: 0, deleted: 0 };

    res = await this.getBlockTradesCME(params.dateRef);
    this.logger.silly(
      `[${
        this.processName
      }] Block Trades loaded - DateRef: [${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )}]: ${JSON.stringify(res)}`,
    );

    result.inserted += res.inserted;
    result.deleted += res.deleted;

    res = await this.getCMEReportAssets(params.dateRef);
    result.inserted += res.inserted;
    result.deleted += res.deleted;

    return result;
  }

  async performQuery(params: { action: string; url: string }): Promise<any> {
    if (params.action === 'SUMMARY') {
      const headers = {
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=0',
      };
      const api = axios.create();
      return (await api.get(params.url, { headers })).data;
    }
    throw new Error(
      `[${
        this.processName
      }] performQuery() - Unknown action parameter: ${JSON.stringify(params)}`,
    );
  }

  public async getCMEReportAssets(dateRef: DateTime): Promise<ILoadResult> {
    const loadResults: ILoadResult[] = [];
    const assets = await this.getAllCMEAssets();

    for await (const asset of assets) {
      let loadResult: ILoadResult;

      if (
        ((process.env.CME_SUMMARY_ASSETS_FUTURES || '')
          .split(',')
          .find(
            globexcode => asset.globexcode === globexcode.trim().toUpperCase(),
          ) ||
          String(process.env.CME_SUMMARY_ASSETS_FUTURES)
            .trim()
            .toUpperCase() === 'ALL') &&
        asset.summaryFutures
      ) {
        await this.sleep(Number(process.env.CME_QUERY_INTERVAL || '2'));

        loadResult = await this.getCMEReport(dateRef, asset);
        loadResults.push(loadResult);

        this.logger.silly(
          `${this.processName} - Futures Summary - DateRef: [${dateRef.toFormat(
            'dd/MM/yyyy',
          )}] - Globexcode: ${asset.globexcode}: ${JSON.stringify(loadResult)}`,
        );
      }

      if (
        ((process.env.CME_SUMMARY_ASSETS_OPTIONS || '')
          .split(',')
          .find(
            globexcode => asset.globexcode === globexcode.trim().toUpperCase(),
          ) ||
          String(process.env.CME_SUMMARY_ASSETS_OPTIONS)
            .trim()
            .toUpperCase() === 'ALL') &&
        asset.summaryOptions
      ) {
        await this.sleep(Number(process.env.CME_QUERY_INTERVAL || '2'));

        loadResult = await this.getOptionsSummary(dateRef, asset);
        loadResults.push(loadResult);
        this.logger.silly(
          `${this.processName} - Options Summary - DateRef: [${dateRef.toFormat(
            'dd/MM/yyyy',
          )}] - Globexcode: ${asset.globexcode}: ${JSON.stringify(loadResult)}`,
        );
      }
    }
    return loadResults.length > 0
      ? loadResults.reduce((total, result) => {
          return {
            inserted: total.inserted + result.inserted,
            deleted: total.deleted + result.deleted,
          };
        })
      : { inserted: 0, deleted: 0 };
  }

  public async getCMEReport(dt: DateTime, asset: IAsset): Promise<ILoadResult> {
    const { globexcode } = asset;

    const urlSettle = `https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/${
      asset.productId
    }/FUT?tradeDate=${dt.toFormat('MM/dd/yyyy')}`;
    const urlVolume = `https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/${
      asset.productId
    }/${dt.toFormat('yyyyMMdd')}/${
      this.reportType === TReportType.FINAL ? 'F' : 'P'
    }`;

    const resSettle: ISettle = await this.retry({
      action: 'SUMMARY',
      url: urlSettle,
    });
    await this.sleep(Number(process.env.CME_QUERY_INTERVAL || '2'));
    const resVolume: IVolume = await this.retry({
      action: 'SUMMARY',
      url: urlVolume,
    });

    // Data is written only when both APIs were not empty
    if (resSettle.empty || resVolume.empty) return { inserted: 0, deleted: 0 };

    const sql = `INSERT INTO "cme-summary" 
      (date, globexcode, month, contract, "product-id", open, high, low, last, 
      change, settle, volume_globex, volume_openoutcry, volume_total, block_vol, 
      efp_vol, efr_vol, eoo_vol, efs_vol, sub_vol, pnt_vol, tas_vol, deliveries, 
      oi_open, oi_close, oi_change) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`;

    let deleted = '';
    if (resVolume.monthData.length > 0) {
      const sqlDel = `DELETE FROM "cme-summary" WHERE date=$1 AND globexcode=$2`;
      [, deleted] = await this.queryFactory.runQuery(sqlDel, {
        date: dt.startOf('day').toJSDate(),
        globexcode,
      });
    }

    let inserted = 0;
    for await (const volData of resVolume.monthData) {
      const settleData: ISettleData | undefined = resSettle.settlements.find(
        s => this.getContract(s.month) === this.getContract(volData.month),
      );

      // eslint-disable-next-line no-continue
      if (settleData === undefined) continue;

      const contract = this.getContract(settleData.month);
      if (contract === 'UNKNOWN') {
        this.logger.warn(
          `${this.processName} - Futures Summary - DateRef: [${dt.toFormat(
            'dd/MM/yyyy',
          )}] - Globexcode: [${globexcode}] - 
          Unable to map contract code from month: [${settleData.month}]`,
        );
      }

      await this.queryFactory.runQuery(sql, {
        date: dt.toJSDate(),
        globexCode: asset.globexcode,
        month: settleData.month,
        contract,
        productId: asset.productId,
        open: this.ParseNumber(settleData.open) || null,
        high: this.ParseNumber(settleData.high) || null,
        low: this.ParseNumber(settleData.low) || null,
        last: this.ParseNumber(settleData.last) || null,
        change: this.ParseNumber(settleData.change) || null,
        settle: this.ParseNumber(settleData.settle) || null,
        volume_globex: this.ParseNumber(volData.globex) || null,
        volume_openoutcry: this.ParseNumber(volData.openOutcry) || null,
        volume_total: this.ParseNumber(volData.totalVolume) || null,
        block_vol: this.ParseNumber(volData.blockVolume) || null,
        efp_vol: this.ParseNumber(volData.efpVol) || null,
        efr_vol: this.ParseNumber(volData.efrVol) || null,
        eoo_vol: this.ParseNumber(volData.eooVol) || null,
        efs_vol: this.ParseNumber(volData.efsVol) || null,
        sub_vol: this.ParseNumber(volData.subVol) || null,
        pnt_vol: this.ParseNumber(volData.pntVol) || null,
        tas_vol: this.ParseNumber(volData.tasVol) || null,
        deliveries: this.ParseNumber(volData.deliveries),
        oi_open: this.ParseNumber(settleData.openInterest) || null,
        oi_close: this.ParseNumber(volData.atClose) || null,
        oi_change: this.ParseNumber(volData.change) || null,
      });

      inserted++;
    }
    return { inserted, deleted: parseInt(deleted) || 0 };
  }

  private async getOptionsSummary(
    dateRef: DateTime,
    asset: IAsset,
  ): Promise<ILoadResult> {
    const urlOptions = `https://www.cmegroup.com/CmeWS/mvc/Settlements/Options/TradeDateAndExpirations/${asset.productId}`;
    const resOptions = await this.retry({
      action: 'SUMMARY',
      url: urlOptions,
    });

    let deleted;
    let inserted = 0;

    if (resOptions) {
      const pageSize = process.env.CME_REQUEST_PAGESIZE || '500';
      const sqlOpt = `INSERT INTO "cme-opts-summary" (date, globexcode, 
        "product-id", contract, "option-type", strike, open, high, low, 
        last, change, settle, volume, volume_globex, volume_openoutcry, volume_total, 
        block_vol, efp_vol, efr_vol, eoo_vol, efs_vol, sub_vol, pnt_vol, 
        tas_vol, deliveries, opnt, aon, exercises, oi_open, oi_close, oi_change) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, 
        $30, $31)`;

      const sqlDel = `DELETE FROM "cme-opts-summary" WHERE date=$1 AND globexcode=$2`;
      [, deleted] = await this.queryFactory.runQuery(sqlDel, {
        date: dateRef.startOf('day').toJSDate(),
        globexcode: asset.globexcode,
      });

      for await (const option of resOptions) {
        for await (const exp of option.expirations) {
          if (!exp.lastTradeDate || !exp.lastTradeDate.timestamp) break;

          const lastDate = DateTime.fromMillis(exp.lastTradeDate.timestamp, {
            zone: this.exchange.timezone,
          });
          if (
            !lastDate.isValid ||
            lastDate.startOf('day').toMillis() < dateRef.toMillis()
          ) {
            break; // Ignore expired contracts
          }

          const { productId, contractId } = exp;
          const contract = exp.expiration.twoDigitsCode;
          const contractCode = exp.expiration.code;
          let putsVolume = 0;
          let callsVolume = 0;

          const urlVolume = `https://www.cmegroup.com/CmeWS/mvc/Volume/Options/Details?productid=${productId}&tradedate=${dateRef.toFormat(
            'yyyyMMdd',
          )}&expirationcode=${contract}&reporttype=${this.reportType}`;

          const urlSettle = `https://www.cmegroup.com/CmeWS/mvc/Settlements/Options/Settlements/${productId}/OOF?optionProductId=${productId}&monthYear=${contractId}&optionExpiration=${productId}-${contractCode}&tradeDate=${dateRef.toFormat(
            'MM/dd/yyyy',
          )}&pageSize=${pageSize}`;

          await this.sleep(Number(process.env.CME_QUERY_INTERVAL || '2'));

          const resSettle = await this.retry({
            action: 'SUMMARY',
            url: urlSettle,
          });
          await this.sleep(Number(process.env.CME_QUERY_INTERVAL || '2'));
          const resVolume = await this.retry({
            action: 'SUMMARY',
            url: urlVolume,
          });

          if (!resSettle.empty && !resVolume.empty) {
            for await (const optSettle of resSettle.settlements) {
              if (this.ParseNumber(optSettle.strike)) {
                const optType =
                  String(optSettle.type).trim().toUpperCase() === 'CALL'
                    ? TOptionType.CALL
                    : TOptionType.PUT;
                let optVol;
                if (optType === TOptionType.CALL) {
                  optVol = resVolume.monthData[0].strikeData.find(
                    (opt: any) => opt.strike === optSettle.strike,
                  );
                } else {
                  optVol = resVolume.monthData[1].strikeData.find(
                    (opt: any) => opt.strike === optSettle.strike,
                  );
                }
                if (
                  optVol &&
                  this.ParseNumber(optSettle.openInterest) &&
                  this.ParseNumber(optVol.atClose) &&
                  this.ParseNumber(optVol.change)
                ) {
                  await this.queryFactory.runQuery(sqlOpt, {
                    date: dateRef.toJSDate(),
                    globexcode: asset.globexcode,
                    productid: productId,
                    contract,
                    optiontype: optType,
                    strike: this.ParseNumber(optSettle.strike) || null,
                    open: this.ParseNumber(optSettle.open) || null,
                    high: this.ParseNumber(optSettle.high) || null,
                    low: this.ParseNumber(optSettle.low) || null,
                    last: this.ParseNumber(optSettle.last) || null,
                    change: this.ParseNumber(optSettle.change) || null,
                    settle: this.ParseNumber(optSettle.settle) || null,
                    volume: this.ParseNumber(optSettle.volume) || null,
                    volume_globex: this.ParseNumber(optVol.globex) || null,
                    volume_openoutcry:
                      this.ParseNumber(optVol.openOutcry) || null,
                    volume_total: this.ParseNumber(optVol.totalVolume) || null,
                    block_vol: this.ParseNumber(optVol.blockVolume) || null,
                    efp_vol: this.ParseNumber(optVol.efpVol) || null,
                    efr_vol: this.ParseNumber(optVol.efrVol) || null,
                    eoo_vol: this.ParseNumber(optVol.eooVol) || null,
                    efs_vol: this.ParseNumber(optVol.efsVol) || null,
                    sub_vol: this.ParseNumber(optVol.subVol) || null,
                    pnt_vol: this.ParseNumber(optVol.pntVol) || null,
                    tas_vol: this.ParseNumber(optVol.tasVol) || null,
                    deliveries: this.ParseNumber(optVol.deliveries) || null,
                    opnt: this.ParseNumber(optVol.opnt) || null,
                    aon: this.ParseNumber(optVol.aon) || null,
                    exercises: this.ParseNumber(optVol.exercises) || null,
                    oi_open: this.ParseNumber(optSettle.openInterest) || null,
                    oi_close: this.ParseNumber(optVol.atClose) || null,
                    oi_change: this.ParseNumber(optVol.change) || null,
                  });
                  inserted++;
                  if (optType === TOptionType.CALL)
                    callsVolume += this.ParseNumber(optSettle.volume)!;
                  else putsVolume += this.ParseNumber(optSettle.volume)!;
                }
              }
            }
          }

          this.logger.silly(
            `${
              this.processName
            } - Options Summary - DateRef: ${dateRef.toFormat(
              'dd/MM/yyyy',
            )} - Asset: ${
              asset.globexcode
            } Contract: ${contract} => Vol CALL: ${callsVolume} Vol PUT: ${putsVolume}`,
          );
        }
      }
    }
    return { inserted, deleted: parseInt(deleted) || 0 };
  }

  private async getReportType(
    dateRef: DateTime,
  ): Promise<TReportType | undefined> {
    const urlTradeDates =
      'https://www.cmegroup.com/CmeWS/mvc/Volume/TradeDates?exchange=CME';
    const resTradeDates = await this.retry({
      action: 'SUMMARY',
      url: urlTradeDates,
    });

    if (!resTradeDates) return undefined;

    const tradeRef = resTradeDates.find(
      (trade: any) => trade.tradeDate === dateRef.toFormat('yyyyMMdd'),
    );
    // eslint-disable-next-line no-nested-ternary
    return tradeRef
      ? tradeRef.reportType === 'PRELIMINARY'
        ? TReportType.PRELIMINARY
        : TReportType.FINAL
      : undefined;
  }

  private async getBlockTradesCME(dtRef: DateTime): Promise<ILoadResult> {
    let pageSize = parseInt(process.env.CME_REQUEST_PAGESIZE || '5000');
    const filter = process.env.CME_BLOCKTRADES_FILTER || 'F,O,I';
    let urlBlockTrades = `https://www.cmegroup.com/services/blocktrades-search?foi=${filter}&tradeDate=${dtRef.toFormat(
      'yyyy-MM-dd',
    )}&sortField=entryDateUTC&sortOrder=asc&pageSize=${pageSize}`;
    let resBlockTradesCME = await this.retry({
      action: 'SUMMARY',
      url: urlBlockTrades,
    });

    if (resBlockTradesCME.total > pageSize) {
      pageSize = parseInt(resBlockTradesCME.total);
      urlBlockTrades = `https://www.cmegroup.com/services/blocktrades-search?foi=${filter}&tradeDate=${dtRef.toFormat(
        'yyyy-MM-dd',
      )}&sortField=entryDateUTC&sortOrder=asc&pageSize=${pageSize}`;
      await this.sleep(Number(process.env.CME_QUERY_INTERVAL || '2'));
      this.logger.warn(
        `${
          this.processName
        } - BlockTrades - Undersized page size: ${pageSize} - DateRef: ${dtRef.toFormat(
          'dd/mm/yyyy',
        )}`,
      );
      resBlockTradesCME = await this.retry({
        action: 'SUMMARY',
        url: urlBlockTrades,
      });
    }

    const blockTrades: IBlockTradeCME[] = resBlockTradesCME.results.map(
      (res: any): IBlockTradeCME => {
        let globexCode;
        let contract;

        if (res.globexCode) {
          const symbol = res.globexCode
            .toUpperCase()
            .match(/^(.*)([F|G|H|J|K|M|N|Q|U|V|X|Z](\d{1,3}))$/);

          if (symbol) {
            globexCode = symbol[1];
            contract =
              symbol[3].length === 1
                ? this.futuresContractConvert2DigitsYear(symbol[2], dtRef)
                : symbol[2];
          } else {
            this.logger.silly(
              `[${this.processName}] Unknown blocktrade globexCode: ${res.globexCode}`,
            );
            globexCode = `UNKNOWN_${res.globexCode}`;
            contract = `UNKNOWN_${res.globexCode}`;
          }
        }

        return {
          calendarDate: DateTime.fromISO(res.tradeDate, {
            zone: this.exchange.timezone,
          }),
          tradeDate: DateTime.fromISO(res.entryDateUTC, {
            zone: this.exchange.timezone,
          }),
          action: String(res.action).trim().toUpperCase(),
          exchange: String(res.exchange).trim().toUpperCase(),
          globexCode,
          productId: res.productId ? Number(res.productId) : undefined,
          contract,
          symbol: String(res.symbol).trim().toUpperCase(),
          type: String(res.secType).trim().toUpperCase(),
          optionType: res.putOrCall
            ? res.putOrCall === '1'
              ? TOptionType.CALL
              : TOptionType.PUT
            : undefined,
          optionStrikePrice: Number(res.strikePrice),
          matMonthYear: res.matMonYr,
          matDate: DateTime.fromISO(res.matDate, {
            zone: this.exchange.timezone,
          }),
          size: res.size ? Number(res.size.replace(/[.,]/g, '')) : undefined,
          price: res.price ? Number(res.price.replace(/[']/g, '.')) : undefined,
          settle: res.settle ? Number(res.settle) : undefined,
          tradeLegs: res.tradeLegs
            ? res.tradeLegs.legs.map((leg: any): IBlockTradeCMELeg => {
                let legGlobexcode: string;
                let legContract: string;

                const symbolLeg = leg.legGlobexCode
                  .toUpperCase()
                  .match(/^(.*)([F|G|H|J|K|M|N|Q|U|V|X|Z](\d{1,3}))$/);
                if (symbolLeg) {
                  legGlobexcode = symbolLeg[1];
                  legContract =
                    symbolLeg[3].length === 1
                      ? this.futuresContractConvert2DigitsYear(
                          symbolLeg[2],
                          dtRef,
                        )
                      : symbolLeg[2];
                } else {
                  this.logger.silly(
                    `[${this.processName}] Unknown blocktrade leg globexCode: ${leg.legGlobexCode}`,
                  );
                  legGlobexcode = `UNKNOWN_${leg.legGlobexCode}`;
                  legContract = `UNKNOWN_${leg.legGlobexCode}`;
                }

                return {
                  type: String(leg.legSecType).trim().toUpperCase(),
                  exchange: String(leg.legSecExch).trim().toUpperCase(),
                  matMonthYear: leg.legMatMonYr,
                  matDate: DateTime.fromISO(leg.legMatDate, {
                    zone: this.exchange.timezone,
                  }),
                  symbol: String(leg.legSymbol).trim().toUpperCase(),
                  globexCode: legGlobexcode,
                  productId: Number(leg.legProductId),
                  contract: legContract,
                  optionType: leg.putOrCall
                    ? leg.putOrCall === '1'
                      ? TOptionType.CALL
                      : TOptionType.PUT
                    : undefined,
                  optionStrikePrice: Number(leg.legStrike.replace(/[']/g, '.')),
                  ratio: Number(leg.legRatio),
                  tradeSide:
                    String(leg.legSide).trim().toUpperCase() === 'BUY'
                      ? TTradeSide.BUY
                      : TTradeSide.SELL,
                  size: Number(leg.legSize.replace(/[.,]/g, '')),
                  price: Number(leg.legPrice.replace(/[']/g, '.')),
                  settle: Number(leg.legSettle.replace(/[']/g, '.')),
                };
              })
            : [],
        };
      },
    );

    let deleted;
    if (blockTrades && blockTrades.length > 0) {
      const sqlDel = `DELETE FROM "cme-blocktrades" WHERE "calendar-date"=$1`;
      [, deleted] = await this.queryFactory.runQuery(sqlDel, {
        calendardate: dtRef.startOf('day').toJSDate(),
      });
    }

    const sqlBT = `INSERT INTO "cme-blocktrades" ("calendar-date", tradedate, 
      action, type, "blocktrade-id", exchange, globexcode, "product-id", contract, symbol, 
      optiontype, optionstrikeprice, ratio, matmonthyear, matdate, tradeside, 
      size, price, settle) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 
      $16, $17, $18, $19) RETURNING id`;

    let inserted = 0;

    for await (const bt of blockTrades) {
      const qIdBT = await this.queryFactory.runQuery(sqlBT, {
        calendardate: bt.calendarDate.toJSDate(),
        tradedate: bt.tradeDate.toJSDate(),
        action: bt.action,
        type: bt.type,
        blocktradeId: null,
        exchange: bt.exchange,
        globexcode: bt.globexCode || null,
        productId: bt.productId || null,
        contract: bt.contract || null,
        symbol: bt.symbol || null,
        optiontype: bt.optionType || null,
        optionstrikeprice: bt.optionStrikePrice || null,
        ratio: null,
        matmonthyear: bt.matMonthYear || null,
        matdate: bt.matDate.toJSDate() || null,
        tradeside: null,
        size: bt.size || null,
        price: bt.price || null,
        settle: bt.settle || null,
      });
      inserted++;

      for await (const leg of bt.tradeLegs) {
        await this.queryFactory.runQuery(sqlBT, {
          calendardate: bt.calendarDate.toJSDate(),
          tradedate: bt.tradeDate.toJSDate(),
          action: bt.action,
          type: leg.type,
          blocktradeId: qIdBT[0].id,
          exchange: leg.exchange,
          globexcode: leg.globexCode,
          productId: bt.productId || null,
          contract: leg.contract,
          symbol: leg.symbol,
          optiontype: leg.optionType || null,
          optionstrikeprice: leg.optionStrikePrice || null,
          ratio: leg.ratio || null,
          matmonthyear: leg.matMonthYear || null,
          matdate: leg.matDate.toJSDate() || null,
          tradeside: leg.tradeSide || null,
          size: leg.size || null,
          price: leg.price || null,
          settle: leg.settle || null,
        });
        inserted++;
      }
    }

    return { inserted, deleted: parseInt(deleted) };
  }

  private ParseNumber(text: string): number | undefined {
    let num: number | undefined = Number(
      text.replace(/[,]/g, '').replace(/[AB]/g, ''),
    );

    if (!isNumber(num) || num === 0) num = undefined;

    return num;
  }

  private getContract(monthYear: string): string {
    const contracts = [
      { month: 'JAN', code: 'F' },
      { month: 'FEB', code: 'G' },
      { month: 'MAR', code: 'H' },
      { month: 'APR', code: 'J' },
      { month: 'MAY', code: 'K' },
      { month: 'JUN', code: 'M' },
      { month: 'JLY', code: 'N' },
      { month: 'JUL', code: 'N' },
      { month: 'AUG', code: 'Q' },
      { month: 'SEP', code: 'U' },
      { month: 'OCT', code: 'V' },
      { month: 'NOV', code: 'X' },
      { month: 'DEC', code: 'Z' },
    ];

    const aMonthYear = monthYear.split(' ');
    if (aMonthYear.length > 1) {
      const [month, year] = aMonthYear;
      const contract = contracts.find(c => c.month === month);

      if (contract && (year.trim().length === 2 || year.trim().length === 4)) {
        if (year.trim().length === 4)
          return contract.code.concat(year.substr(2));
        return contract.code.concat(year);
      }
    }
    return 'UNKNOWN';
  }

  public async getAllCMEAssets(): Promise<IAsset[]> {
    const aAssets: IAsset[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const url = `https://www.cmegroup.com/services/product-slate?sortAsc=false&pageNumber=${page}&cleared=Futures&pageSize=${
        process.env.CME_REQUEST_PAGESIZE || '5000'
      }`;
      const res = await this.retry({ action: 'SUMMARY', url });
      res.products.forEach((product: any) => {
        aAssets.push({
          globexcode: product.globex,
          caption: product.name,
          productId: product.id,
          summaryFutures: false,
          summaryOptions: false,
          chartLoadFutures: false,
        });
      });

      totalPages = res.props.pageTotal;
      page++;

      if (page <= totalPages)
        await this.sleep(Number(process.env.CME_QUERY_INTERVAL || '0'));
    }

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

  public static async getCMEAssets(): Promise<any[]> {
    const assets: any[] = await loadJSONConfigFile(
      'cme_assets_load_config.json',
    );

    if (!assets || assets.length === 0)
      throw new Error(
        'Empty CME Assets Config File: config/cme_assets_load_config.json',
      );

    return assets;
  }
}

export default SummaryCME;
export { IAsset, TReportType, TOptionType, TTradeSide };
