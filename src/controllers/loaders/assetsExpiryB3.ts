/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable prefer-destructuring */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-continue */
/* eslint-disable no-empty */
/* eslint-disable no-restricted-syntax */
import { Browser, CDPSession, Page, ElementHandle } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Pool } from 'pg';
import { to as pgCopyTo } from 'pg-copy-streams';
import csv from 'csv-parser';
import path from 'path';
import fs from 'fs';
import { DateTime } from 'luxon';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { ILoadResult } from '../reportLoader';
import { TCurrencyCode } from '../tcountry';
import ZipFileManager from '../zipFileManager';
import CloudFileManager from '../cloudFileManager';

enum TAssetType {
  FUTURES = 'FUTURES',
  OPTIONS = 'OPTIONS',
  INTEREST_RATE = 'INTEREST_RATE',
  SPOT = 'SPOT',
}

enum TAssetGroup {
  BDR = 'BDR',
  COMMODITY = 'COMMODITY',
  ETF = 'ETF',
  FIXED_INCOME = 'FIXED_INCOME',
  FOREX = 'FOREX',
  FORWARD_POINTS_USD = 'FORWARD_POINTS_USD',
  FORWARD_RATE_USD = 'FORWARD_RATE_USD',
  FUNDS = 'FUNDS',
  INDEX = 'INDEX',
  INTEREST_RATE = 'INTEREST_RATE',
  OPTIONS_FUTURES = 'OPTIONS_FUTURES',
  OPTIONS_SPOT = 'OPTIONS_SPOT',
  OPTIONS_STOCKS = 'OPTIONS_STOCKS',
  ROLLOVER = 'ROLLOVER',
  STOCKS = 'STOCKS',
  STOCKS_UNIT = 'STOCKS_UNIT',
  TERM = 'TERM',
}

enum TRolloverBasePrice {
  LASTPRICE = 'LASTPRICE',
  SETTLEPRICE = 'SETTLEPRICE',
}

enum TOptionStyle {
  AMERICAN = 'AME',
  EUROPEAN = 'EUR',
}

enum TOptionType {
  CALL = 'CALL',
  PUT = 'PUT',
}

interface IAssetExpiry {
  asset: string;
  type: TAssetType;
  contract: string | undefined;
  underlyingAsset: string | undefined;
  productName: string;
  productGroup: TAssetGroup;
  dateTradingStart: DateTime | undefined;
  dateTradingEnd: DateTime | undefined;
  dateExpiry: DateTime | undefined;
  currency: TCurrencyCode | undefined;
  quoteQuantity: number | undefined;
  quoteMultiplier: number | undefined;
  optionType: TOptionType | undefined;
  optionStyle: TOptionStyle | undefined;
  optionExercisePrice: number | undefined;
  rolloverBasePrice: TRolloverBasePrice | undefined;
}

export default class AssetsExpiryB3 extends ReportLoaderCalendar {
  async process(
    params: {
      dateMatch: DateTime;
      dateRef: DateTime;
    },
    downloadOnly = false,
  ): Promise<any> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );

    let foundInCloud = true;
    let csvPathFileName = await this.getAssetsExpiryFileCloud(params.dateRef);
    if (!csvPathFileName) {
      foundInCloud = false;
      csvPathFileName = await this.getAssetsExpiryFileB3(params.dateRef);
    } else if (downloadOnly) return { inserted: -1, deleted: 0 };

    if (!csvPathFileName) {
      this.logger.warn(
        `[${
          this.processName
        }] Assets expiry file unavailable for date: ${params.dateRef.toFormat(
          'dd/MM/yyyy',
        )} `,
      );
      return { inserted: 0, deleted: 0 };
    }

    // Certify b3-assets-expiry table is empty
    await this.queryFactory.runQuery(`TRUNCATE TABLE "b3-assets-expiry"`, {});
    await this.queryFactory.runQuery(`VACUUM(FULL) "b3-assets-expiry"`, {});

    await this.loadB3AssetsExpiryFile(
      params.dateRef,
      foundInCloud,
      csvPathFileName,
    );

    let res: ILoadResult;

    if (!foundInCloud) {
      const exportPathFileName = path.join(
        __dirname,
        '../../../',
        process.env.TEMP_DATA_FILES_DIR || 'data',
        `${
          path.parse(
            (
              process.env.B3_ASSETS_EXPIRY_ZIPFILENAME ||
              'B3_ASSETS_EXPIRY_$DATE.zip'
            ).replace('$DATE', params.dateRef.toFormat('yyyyMMdd')),
          ).name
        }.csv`,
      );

      res = await this.exportAssetsExpiryB3File(exportPathFileName);

      if (res.inserted > 0) {
        // add to zip
        const pathZipFileName = await ZipFileManager.compactSingleFile(
          exportPathFileName,
        );
        // upload to cloud drive
        await CloudFileManager.uploadFileCloudPool(
          pathZipFileName,
          process.env.B3_ASSETS_EXPIRY_CLOUD_FOLDER || '',
          false,
          true,
        );

        if (fs.existsSync(pathZipFileName)) fs.unlinkSync(pathZipFileName);

        this.logger.silly(
          `[${
            this.processName
          }] ZIP File exported to the cloud successfully: ${path.basename(
            pathZipFileName,
          )}`,
        );
      }

      if (fs.existsSync(exportPathFileName)) fs.unlinkSync(exportPathFileName);
    }

    if (fs.existsSync(csvPathFileName)) fs.unlinkSync(csvPathFileName);

    if (downloadOnly && !foundInCloud) return res!;

    const qLoadControl = await this.queryFactory.runQuery(
      `SELECT DISTINCT process FROM "loadcontrol"
    WHERE "date-ref"=$1 AND UPPER(process)=ANY($2) AND status='DONE'`,
      {
        dtRef: params.dateRef.toJSDate(),
        process: ['TimesNSalesB3', 'SummaryB3', 'ContractsB3'].map(p =>
          p.toUpperCase(),
        ),
      },
    );

    if (!qLoadControl || qLoadControl.length !== 3) {
      this.logger.warn(
        `[${this.processName}] Task finished empty to wait for pending processes to finish.`,
      );
      return { inserted: 0, deleted: 0 };
    }

    res = await this.updateAssetsExpiryTables(params.dateRef);

    await this.queryFactory.runQuery(`TRUNCATE TABLE "b3-assets-expiry"`, {});
    await this.queryFactory.runQuery(`VACUUM(FULL) "b3-assets-expiry"`, {});

    return res;
  }

  async performQuery(params: {
    dateRef: DateTime;
    action: string;
    browser?: Browser;
    pathFileName?: string;
  }): Promise<string | boolean | undefined> {
    if (params.action === 'GET_FILE_ASSETS_EXPIRY_CLOUD') {
      if (!params.pathFileName)
        throw new Error(
          `[${this.processName}] PerformQuery() - Action: GET_FILE_ASSETS_EXPIRY - Missing parameters`,
        );
      return CloudFileManager.downloadFileCloudPool(
        params.pathFileName,
        process.env.B3_ASSETS_EXPIRY_CLOUD_FOLDER || '',
      );
    }
    if (params.action === 'GET_FILE_ASSETS_EXPIRY_B3') {
      if (!params.browser) {
        throw new Error(
          `[${this.processName}] PerformQuery() - Action: GET_FILE_ASSETS_EXPIRY - Missing parameters`,
        );
      }

      // close all pages before start
      for await (const pg of await params.browser!.pages()) {
        await pg.close();
      }
      const url = `https://arquivos.b3.com.br/Web/Consolidated?lang=pt`;
      const csvFilePath = path.join(
        __dirname,
        '../../../',
        process.env.TEMP_DATA_FILES_DIR || 'data',
      );

      let page: Page | undefined;
      let cdp: CDPSession | undefined;
      let csvPathFileName: string;

      try {
        page = await params.browser!.newPage();
        await page.waitForTimeout(3000);

        // Clear all cookies to avoid server track
        try {
          cdp = await page.target().createCDPSession();
          await cdp.send('Network.clearBrowserCookies');
          await cdp.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: csvFilePath,
          });
        } catch (e) {}

        await page.goto(url, { waitUntil: 'networkidle2' });
        await page.waitForSelector('div.accordion');

        // Expand all cards
        // document.querySelectorAll('a.card-header').forEach(el => {if (el.classList.contains('active')) el.click()})
        await page.evaluate(() => {
          document.querySelectorAll('a.card-header').forEach(el => {
            // @ts-ignore
            if (!el.classList.contains('active')) el.click();
          });
        });

        const divCards = await page.$$('div.card');
        for await (const divCard of divCards) {
          const divDate = await divCard.$$('div.card-link');
          if (!divDate || divDate.length === 0 || divDate.length > 1) continue;

          const dtCard = DateTime.fromFormat(
            (
              await divDate[0].evaluate(div => div.textContent!.trim())
            ).toString(),
            'dd/MM/yyyy',
          );

          if (
            !dtCard ||
            !dtCard.isValid ||
            dtCard.toMillis() !== params.dateRef.toMillis()
          )
            continue;

          const divContents = await divCard.$$('div.content');
          if (!divContents || divContents.length === 0) continue;

          let pElement: ElementHandle | undefined;
          for (const divContent of divContents) {
            const pElements = await divContent.$$('p');
            if (!pElements || pElements.length !== 2) continue;
            const cardAction = (
              await pElements[0].evaluate(p =>
                p.textContent!.trim().toUpperCase(),
              )
            ).toString();
            if (cardAction === 'CADASTRO DE INSTRUMENTOS (LISTADO)') {
              pElement = pElements[1];
              break;
            }
          }
          if (!pElement)
            throw new Error(
              `[${this.processName}] Page layout error - unable to find <p> element`,
            );

          const aElements = await pElement.$$('a');
          if (aElements.length < 2)
            throw new Error(
              `[${this.processName}] Page layout error - few <a> elements`,
            );

          const aElement =
            (await aElements[0].evaluate(a =>
              a.textContent!.trim().toUpperCase().replace(/\s\s/, ' '),
            )) === 'BAIXAR ARQUIVO'
              ? aElements[0]
              : (await aElements[1].evaluate(a =>
                  a.textContent!.trim().toUpperCase().replace(/\s\s/, ' '),
                )) === 'BAIXAR ARQUIVO'
              ? aElements[1]
              : undefined;

          if (!aElement)
            throw new Error(`[${this.processName}] Unable to find <a> element`);

          csvPathFileName = await new Promise((resolve, reject) => {
            let bytes = 0;
            page!.on('response', response => {
              const downloadTimeout = setInterval(() => {
                page!.removeAllListeners('response');
                reject(
                  new Error(
                    `File download timed out - Bytes downloaded: ${bytes}`,
                  ),
                );
              }, 15000 + Number(process.env.B3_ASSETS_EXPIRY_FILE_DOWNLOAD_TIMEOUT || '20') * 1000);

              const header = response.headers()['content-disposition'];
              if (header && header.includes('filename=')) {
                const regExHeader = response
                  .headers()
                  ['content-disposition'].match(
                    // /^\s*(attachment|inline)\s*;\s*filename\s*=\s*"?([^;]*)"?\s*(;\s*size=(\d+))?$/,
                    /^\s*(attachment|inline)\s*(;\s*size=(\d+))?;\s*filename\s*=\s*"?([^;]*)"?\s*(;\s*size=(\d+))?$/,
                  );
                if (!regExHeader) {
                  clearTimeout(downloadTimeout);
                  page!.removeAllListeners('response');
                  reject(
                    new Error(
                      `Unknown header format: CONTENT-DISPOSITION="${
                        response.headers()['content-disposition']
                      }" - CONTENT-LENGTH="${
                        response.headers()['content-length']
                      }"`,
                    ),
                  );
                }

                const filename = regExHeader![4] || undefined;
                const filesize = Number(
                  regExHeader![3] ||
                    regExHeader![6] ||
                    (response.headers()['content-length'] === null
                      ? undefined
                      : response.headers()['content-length']),
                );
                if (!filename || Number.isNaN(filesize) || filesize === 0) {
                  clearTimeout(downloadTimeout);
                  page!.removeAllListeners('response');
                  reject(
                    new Error(
                      `Invalid header data: CONTENT-DISPOSITION="${
                        response.headers()['content-disposition']
                      }" - CONTENT-LENGTH="${
                        response.headers()['content-length']
                      }" - REGEXHEADER=${JSON.stringify(regExHeader)}`,
                    ),
                  );
                }

                fs.watchFile(
                  path.join(csvFilePath, filename!),
                  (curr, _prev) => {
                    bytes = curr.size;
                    if (curr.size === filesize) {
                      clearTimeout(downloadTimeout);
                      page!.removeAllListeners('response');
                      resolve(path.join(csvFilePath, filename!));
                    }
                  },
                );
              }
            });
            aElement.click();
          });

          return csvPathFileName;
        }
        return undefined;
      } finally {
        try {
          if (cdp) await cdp.detach();
        } catch (e) {}
        try {
          if (page) await page.close();
        } catch (e) {}
      }
    }

    throw new Error(
      `[${this.processName}] PerformQuery() - Unknown action parameter`,
    );
  }

  private async loadB3AssetsExpiryFile(
    dateRef: DateTime,
    fromCloud: boolean,
    csvPathFileName: string,
  ): Promise<ILoadResult> {
    const readCount = 0;

    const sql = `INSERT INTO "b3-assets-expiry" 
    (asset, type, contract, "underlying-asset", "product-name", "product-group", 
    "date-trading-start", "date-trading-end", "date-expiry", "currency-code", 
    "quote-quantity", "quote-multiplier", "option-type", "option-style", 
    "option-exercise-price", "rollover-base-price", "loaded-at") 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) 
    ON CONFLICT (asset, type, COALESCE(contract, '')) DO UPDATE SET 
    "underlying-asset"=$4, "product-name"=$5, "product-group"=$6, 
    "date-trading-start"=$7, "date-trading-end"=$8, "date-expiry"=$9, 
    "currency-code"=$10, "quote-quantity"=$11, "quote-multiplier"=$12, 
    "option-type"=$13, "option-style"=$14, "option-exercise-price"=$15, 
    "rollover-base-price"=$16, "loaded-at"=$17`;

    const aIgnoredAssets: string[] = [];

    const qAssets = await this.queryFactory.runQuery(
      `SELECT asset, type FROM "b3-assets-expiry" ORDER BY asset ASC`,
      {},
    );
    const aExistingAssets: { asset: string; type: TAssetType }[] = qAssets.map(
      (q: any) => {
        return {
          asset: q.asset,
          type: q.type,
        };
      },
    );
    const aNewAssets: { asset: string; type: TAssetType }[] = [];

    let newAssets = 0;
    let assetsRead = 0;

    const result: ILoadResult = await new Promise((resolve, reject) => {
      let inserted = 0;

      fs.createReadStream(csvPathFileName, { encoding: 'latin1' })
        .pipe(
          csv({
            separator: process.env.B3_ASSETS_EXPIRY_FILE_SEPARATOR || ';',
            mapHeaders: ({ header }) =>
              header.toLowerCase().replace(/[-\s]/g, ''),
            mapValues: ({ value }) =>
              String(value)
                .trim()
                .toUpperCase()
                .normalize('NFD')
                .replace(/\p{Diacritic}/gu, '')
                .replace(/\s\s/gu, ' '),
          }),
        )
        .on('data', async (row: any) => {
          if (assetsRead++ === 0) {
          }

          let assetExpiry: IAssetExpiry | undefined;

          if (fromCloud) {
            if (row.asset === '' || row.type === '') assetExpiry = undefined;
            else {
              assetExpiry = {
                asset: row.asset,
                type: row.type,
                contract: row.contract !== '' ? row.contract : undefined,
                underlyingAsset:
                  row.underlyingasset !== '' ? row.underlyingasset : undefined,
                productName: row.productname,
                productGroup: row.productgroup,
                dateTradingStart:
                  row.datetradingstart !== ''
                    ? DateTime.fromSQL(row.datetradingstart)
                    : undefined,
                dateTradingEnd:
                  row.datetradingend !== ''
                    ? DateTime.fromSQL(row.datetradingend)
                    : undefined,
                dateExpiry:
                  row.dateexpiry !== ''
                    ? DateTime.fromSQL(row.dateexpiry)
                    : undefined,
                currency: row.currency !== '' ? row.currency : undefined,
                quoteQuantity:
                  row.quotequantity !== ''
                    ? Number(row.quotequantity)
                    : undefined,
                quoteMultiplier:
                  row.quotemultiplier !== ''
                    ? Number(row.quotemultiplier)
                    : undefined,
                optionType: row.optiontype !== '' ? row.optiontype : undefined,
                optionStyle:
                  row.optionstyle !== '' ? row.optionstyle : undefined,
                optionExercisePrice:
                  row.optionexerciseprice !== ''
                    ? Number(row.optionexerciseprice)
                    : undefined,
                rolloverBasePrice:
                  row.rolloverbaseprice !== ''
                    ? row.rolloverbaseprice
                    : undefined,
              };
            }
          } else {
            const dateTradingStart = DateTime.fromFormat(
              row.tradgstartdt,
              'yyyy-MM-dd',
              { zone: this.exchange.timezone },
            );
            const dateTradingEnd = DateTime.fromFormat(
              row.tradgenddt,
              'yyyy-MM-dd',
              { zone: this.exchange.timezone },
            );
            const dateExpiry = DateTime.fromFormat(row.xprtndt, 'yyyy-MM-dd', {
              zone: this.exchange.timezone,
            });
            // ================================> TYPE FUTURES
            if (
              row.mktnm === 'FUTURE' &&
              ['', 'STOCK FUTURE', 'FORW/FUT GOLD'].find(
                c => c === row.sctyctgynm,
              ) === row.sctyctgynm &&
              row.optnstyle === ''
            ) {
              const symbol = row.tckrsymb.match(
                /^((.*)((F|G|H|J|K|M|N|Q|U|V|X|Z)\d\d))$/,
              );

              const currency = row.tradgccy as TCurrencyCode;

              let productGroup: TAssetGroup | undefined;
              if (row.mktnm === 'STOCK FUTURE')
                productGroup = TAssetGroup.STOCKS;
              else if (row.sgmtnm === 'AGRIBUSINESS' || row.sgmtnm === 'METAL')
                productGroup = TAssetGroup.COMMODITY;
              else if (
                ['INDICE', 'BVMF', 'IBOVESPA', 'DAX', 'EURO STOXX'].some(str =>
                  row.asstdesc.includes(str),
                )
              )
                productGroup = TAssetGroup.INDEX;
              else if (
                ['CUPOM', 'TAXA', 'US TREASURY'].some(str =>
                  row.asstdesc.includes(str),
                )
              )
                productGroup = TAssetGroup.INTEREST_RATE;
              else if (row.sgmtnm === 'FINANCIAL')
                productGroup = TAssetGroup.FOREX;
              else productGroup = undefined;

              if (!symbol || !productGroup) {
                if (!aIgnoredAssets.find(a => a === row.asst))
                  this.logger.warn(
                    `[${
                      this.processName
                    }] Unknown FUTURE data: ${JSON.stringify(row)}`,
                  );
              } else {
                assetExpiry = {
                  asset: row.tckrsymb,
                  type: TAssetType.FUTURES,
                  contract: row.xprtncd,
                  underlyingAsset: row.asst,
                  productName: row.asstdesc,
                  productGroup,
                  dateTradingStart: dateTradingStart.isValid
                    ? dateTradingStart
                    : undefined,
                  dateTradingEnd: dateTradingEnd.isValid
                    ? dateTradingEnd
                    : undefined,
                  dateExpiry: dateExpiry.isValid ? dateExpiry : undefined,
                  currency,
                  quoteQuantity:
                    row.asstqtnqty !== '' ? Number(row.asstqtnqty) : undefined,
                  quoteMultiplier:
                    row.ctrctmltplr !== ''
                      ? Number(row.ctrctmltplr)
                      : undefined,
                  optionType: undefined,
                  optionStyle: undefined,
                  optionExercisePrice: undefined,
                  rolloverBasePrice: undefined,
                };
              }
            } // =========================> TYPE ROLLOVER
            else if (row.sctyctgynm === 'ROLLOVER' && row.optnstyle === '') {
              const symbolAsset = row.tckrsymb.match(
                /^((.*)(((F|G|H|J|K|M|N|Q|U|V|X|Z)\d\d){2}))$/,
              );
              const symbolUnderlyingAsset = row.undrlygtckrsymb1.match(
                /^(.*)((F|G|H|J|K|M|N|Q|U|V|X|Z)\d\d)$/,
              );

              const underlyingAsset = symbolUnderlyingAsset
                ? symbolUnderlyingAsset[1]
                : undefined;

              const currency = row.tradgccy as TCurrencyCode;

              const rolloverBasePrice =
                row.rlvrbasepricnm === 'LAST PRICE'
                  ? TRolloverBasePrice.LASTPRICE
                  : row.rlvrbasepricnm === 'SETTLEMENT PRICE'
                  ? TRolloverBasePrice.SETTLEPRICE
                  : undefined;

              if (!rolloverBasePrice || !symbolAsset) {
                if (!aIgnoredAssets.find(a => a === row.asst))
                  this.logger.warn(
                    `[${
                      this.processName
                    }] Unknown ROLLOVER data: ${JSON.stringify(row)}`,
                  );
              } else {
                assetExpiry = {
                  asset: row.tckrsymb,
                  type: TAssetType.FUTURES,
                  contract: symbolAsset[3],
                  underlyingAsset,
                  productName: row.asstdesc,
                  productGroup: TAssetGroup.ROLLOVER,
                  dateTradingStart: dateTradingStart.isValid
                    ? dateTradingStart
                    : undefined,
                  dateTradingEnd: dateTradingEnd.isValid
                    ? dateTradingEnd
                    : undefined,
                  dateExpiry: dateExpiry.isValid ? dateExpiry : undefined,
                  currency,
                  quoteQuantity:
                    row.asstqtnqty !== '' ? Number(row.asstqtnqty) : undefined,
                  quoteMultiplier:
                    row.ctrctmltplr !== ''
                      ? Number(row.ctrctmltplr)
                      : undefined,
                  optionType: undefined,
                  optionStyle: undefined,
                  optionExercisePrice: undefined,
                  rolloverBasePrice,
                };
              }
            } // ============================> TYPE OPTIONS
            else if (row.optnstyle !== '') {
              const symbol = row.tckrsymb.match(
                /^(.*)((F|G|H|J|K|M|N|Q|U|V|X|Z)\d\d)((C|P)(\d\d\d\d\d\d))$/,
              );

              let contract: string | undefined;
              if (symbol) contract = symbol[2];

              const optionStyle =
                row.optnstyle === 'AMER'
                  ? TOptionStyle.AMERICAN
                  : row.optnstyle === 'EURO'
                  ? TOptionStyle.EUROPEAN
                  : undefined;

              const productGroup: TAssetGroup | undefined =
                row.mktnm === 'OPTIONS ON SPOT'
                  ? TAssetGroup.OPTIONS_SPOT
                  : row.mktnm === 'OPTIONS ON FUTURE'
                  ? TAssetGroup.OPTIONS_FUTURES
                  : row.mktnm === 'EQUITY-DERIVATE'
                  ? TAssetGroup.OPTIONS_STOCKS
                  : undefined;

              const optionType =
                row.optntp === 'CALL'
                  ? TOptionType.CALL
                  : row.optntp === 'PUT'
                  ? TOptionType.PUT
                  : undefined;

              const optionExercisePrice = Number(
                row.exrcpric.replace(/\./g, '').replace(/,/g, '.'),
              );

              const currency = row.tradgccy as TCurrencyCode;

              if (
                !optionStyle ||
                !productGroup ||
                !optionType ||
                Number.isNaN(optionExercisePrice)
              ) {
                if (!aIgnoredAssets.find(a => a === row.asst))
                  this.logger.warn(
                    `[${
                      this.processName
                    }] Unknown OPTION DATA: ${JSON.stringify(row)}`,
                  );
              } else {
                let productName: string;
                if (productGroup === TAssetGroup.OPTIONS_STOCKS) {
                  productName = `${row.optntp} OPTIONS ON STOCKS: ${row.asst}`;
                } else {
                  productName = `${row.optntp} OPTIONS ON ASSET: ${row.asst} - CONTRACT: ${contract}`;
                }

                assetExpiry = {
                  asset: row.tckrsymb,
                  type: TAssetType.OPTIONS,
                  contract,
                  underlyingAsset: row.asst,
                  productName,
                  productGroup,
                  dateTradingStart: dateTradingStart.isValid
                    ? dateTradingStart
                    : undefined,
                  dateTradingEnd: dateTradingEnd.isValid
                    ? dateTradingEnd
                    : undefined,
                  dateExpiry: dateExpiry.isValid ? dateExpiry : undefined,
                  currency,
                  quoteQuantity:
                    row.asstqtnqty !== '' ? Number(row.asstqtnqty) : undefined,
                  quoteMultiplier:
                    row.ctrctmltplr !== ''
                      ? Number(row.ctrctmltplr)
                      : undefined,
                  optionType,
                  optionStyle,
                  optionExercisePrice,
                  rolloverBasePrice: undefined,
                };
              }
            } // ===============================> TYPE INTEREST_RATE
            else if (
              ['FORWARD POINTS', 'FORWARD RATE AGREEMENT', 'FX SWAP'].find(
                c => c === row.sctyctgynm,
              ) &&
              row.optnstyle === ''
            ) {
              let contract: string | undefined;
              let productGroup: TAssetGroup | undefined;
              let underlyingAsset: string | undefined;

              if (row.sctyctgynm === 'FX SWAP') {
                const symbol = row.tckrsymb.match(
                  /^(.*)(F|G|H|J|K|M|N|Q|U|V|X|Z)(\d)(\d\d)$/,
                );

                if (symbol)
                  contract = `${symbol[2]}${String(dateRef.year).substr(2, 1)}${
                    symbol[3]
                  }`;
                productGroup = TAssetGroup.FORWARD_RATE_USD;
                underlyingAsset = row.asst;
              } else {
                const symbol = row.tckrsymb.match(
                  /^(.*)((F|G|H|J|K|M|N|Q|U|V|X|Z)\d\d)$/,
                );

                if (symbol) contract = symbol[2];

                productGroup =
                  row.sctyctgynm === 'FORWARD RATE AGREEMENT' ||
                  row.sctyctgynm === 'FX SWAP'
                    ? TAssetGroup.FORWARD_RATE_USD
                    : row.sctyctgynm === 'FORWARD POINTS'
                    ? TAssetGroup.FORWARD_POINTS_USD
                    : undefined;

                underlyingAsset = symbol ? row.asst : row.tckrsymb;
              }

              const currency = row.tradgccy as TCurrencyCode;

              if (!productGroup) {
                if (!aIgnoredAssets.find(a => a === row.asst))
                  this.logger.warn(
                    `[${
                      this.processName
                    }] Unknown INTEREST_RATE data: ${JSON.stringify(row)}`,
                  );
              } else {
                assetExpiry = {
                  asset: row.tckrsymb,
                  type: TAssetType.INTEREST_RATE,
                  contract,
                  underlyingAsset,
                  productName: row.asstdesc,
                  productGroup,
                  dateTradingStart:
                    dateTradingStart.isValid && contract
                      ? dateTradingStart
                      : undefined,
                  dateTradingEnd:
                    dateTradingEnd.isValid && contract
                      ? dateTradingEnd
                      : undefined,
                  dateExpiry:
                    dateExpiry.isValid && contract ? dateExpiry : undefined,
                  currency,
                  quoteQuantity:
                    row.asstqtnqty !== '' ? Number(row.asstqtnqty) : undefined,
                  quoteMultiplier:
                    row.ctrctmltplr !== ''
                      ? Number(row.ctrctmltplr)
                      : undefined,
                  optionType: undefined,
                  optionStyle: undefined,
                  optionExercisePrice: undefined,
                  rolloverBasePrice: undefined,
                };
              }
            } // =============================> TYPE SPOT
            else if (
              row.optnstyle === '' &&
              [
                'CASH',
                'ODD LOT',
                'ETF PRIMARY MARKET',
                'METAL',
                'EQUITY FORWARD',
                'FORWARD',
              ].find(c => c === row.sgmtnm) &&
              row.mktnm !== 'FUTURE'
            ) {
              const currency = row.tradgccy as TCurrencyCode;
              let productGroup: TAssetGroup | undefined;

              if (row.sctyctgynm.includes('BDR'))
                productGroup = TAssetGroup.BDR;
              else if (row.mktnm === 'FIXED INCOME')
                productGroup = TAssetGroup.FIXED_INCOME;
              else if (row.sctyctgynm.includes('ETF'))
                productGroup = TAssetGroup.ETF;
              else if (row.sctyctgynm.includes('COMMON EQUITIES FORWARD'))
                productGroup = TAssetGroup.TERM;
              else if (
                row.sctyctgynm === 'FORW/FUT GOLD' ||
                row.asstdesc.includes('OURO')
              )
                productGroup = TAssetGroup.COMMODITY;
              else if (row.sctyctgynm === 'FUNDS')
                productGroup = TAssetGroup.FUNDS;
              else if (row.sctyctgynm === 'INDEX')
                productGroup = TAssetGroup.INDEX;
              else if (row.sctyctgynm === 'RECEIPTS') {
                return;
                productGroup = undefined; // DO NOT IMPORT
              } else if (row.sctyctgynm === 'RIGHTS') {
                return;
                productGroup = undefined; // DO NOT IMPORT
              } else if (
                row.sctyctgynm === 'SHARES' ||
                row.sctyctgynm === 'UNIT' ||
                row.sctyctgynm === 'WARRANT'
              ) {
                if (row.sgmtnm === 'CASH') productGroup = TAssetGroup.STOCKS;
                else if (row.sgmtnm === 'ODD LOT')
                  productGroup = TAssetGroup.STOCKS_UNIT;
                else productGroup = undefined;
              } else productGroup = undefined;

              let productName: string;
              if (row.crpnnm !== '')
                productName = `${row.spcfctncd} - ${row.crpnnm}`;
              else productName = `${row.asstdesc} - ${row.sctyctgynm}`;

              if (!productGroup) {
                if (!aIgnoredAssets.find(a => a === row.asst))
                  this.logger.warn(
                    `[${this.processName}] Unknown SPOT data: ${JSON.stringify(
                      row,
                    )}`,
                  );
              } else {
                assetExpiry = {
                  asset: row.tckrsymb,
                  type: TAssetType.SPOT,
                  contract: undefined,
                  underlyingAsset: row.asst,
                  productName,
                  productGroup,
                  dateTradingStart: undefined,
                  dateTradingEnd: undefined,
                  dateExpiry: undefined,
                  currency,
                  quoteQuantity: undefined,
                  quoteMultiplier: undefined,
                  optionType: undefined,
                  optionStyle: undefined,
                  optionExercisePrice: undefined,
                  rolloverBasePrice: undefined,
                };
              }
            }
          }
          if (!assetExpiry) {
            if (!aIgnoredAssets.find(a => a === row.asst)) {
              aIgnoredAssets.push(row.asst);
            }
            return;
          }

          this.queryFactory.runQuery(sql, {
            asset: assetExpiry.asset,
            type: assetExpiry.type,
            contract: assetExpiry.contract,
            underlyingAsset: assetExpiry.underlyingAsset,
            productName: assetExpiry.productName,
            productGroup: assetExpiry.productGroup,
            dateTradingStart: assetExpiry.dateTradingStart,
            dateTradingEnd: assetExpiry.dateTradingEnd,
            dateExpiry: assetExpiry.dateExpiry,
            currency: assetExpiry.currency,
            quoteQuantity: assetExpiry.quoteQuantity,
            quoteMultiplier: assetExpiry.quoteMultiplier,
            optionType: assetExpiry.optionType,
            optionStyle: assetExpiry.optionStyle,
            optionExercisePrice: assetExpiry.optionExercisePrice,
            rolloverBasePrice: assetExpiry.rolloverBasePrice,
            loadedAt: DateTime.now().toJSDate(),
          });
          inserted++;
          if (
            !aExistingAssets.find(
              a =>
                a.asset === assetExpiry!.asset && a.type === assetExpiry!.type,
            )
          ) {
            if (aExistingAssets.length > 0)
              aNewAssets.push({
                asset: assetExpiry.asset,
                type: assetExpiry.type,
              });
            newAssets++;
          }
        })
        .on('end', async () => {
          resolve({ inserted, deleted: 0 });
        })
        .on('error', error => {
          this.logger.error(
            `[${this.processName}] Records read: ${readCount} - Error: ${error.message}`,
          );

          reject(error);
        });
    });

    this.logger.silly(
      `[${this.processName}] Records read/loaded: ${assetsRead}/${
        result.inserted
      } - Ignored assets (${aIgnoredAssets.length}): ${JSON.stringify(
        aIgnoredAssets,
      )}`,
    );

    if (aNewAssets.length > 0)
      this.logger.warn(
        `[${
          this.processName
        }] New assets loaded (${newAssets}): ${JSON.stringify(aNewAssets)}`,
      );

    return result;
  }

  private async exportAssetsExpiryB3File(
    exportPathFileName: string,
  ): Promise<ILoadResult> {
    let sql = `SELECT * FROM "b3-assets-expiry"`;
    const qIns = await this.queryFactory.runQuery(
      `SELECT COUNT(*) AS inserted FROM (${sql}) q`,
      {},
    );

    const inserted = qIns && qIns.length > 0 ? Number(qIns[0].inserted) : 0;

    await new Promise<void>((resolve, reject) => {
      const pool = new Pool({
        connectionString: `postgresql://${process.env.DB_USER || 'dbuser'}:${
          process.env.DB_PASS || 'dbpass'
        }@${process.env.DB_HOST || 'dbhost'}:${process.env.DB_PORT || '3211'}/${
          process.env.DB_NAME || 'dbname'
        }`,
      });

      pool.connect((pgErr, client, done) => {
        if (pgErr) {
          reject(
            new Error(
              `[${this.processName}] exportAssetsExpiryFile() - Database connection error: ${pgErr.message}`,
            ),
          );
        }

        const wsAssetsExpiry = fs.createWriteStream(exportPathFileName);

        sql = `COPY (${sql}) TO STDOUT With CSV DELIMITER '${
          process.env.BACKUP_DELIMITER || ','
        }' HEADER`;

        wsAssetsExpiry.on('ready', () => {
          const stream = client.query(pgCopyTo(sql));
          stream.pipe(wsAssetsExpiry);

          stream.on('end', async () => {
            wsAssetsExpiry.close();
            done();
            resolve();
          });

          stream.on('error', error => {
            wsAssetsExpiry.close();
            done();
            reject(
              new Error(
                `[${this.processName}] exportAssetsExpiryFile() - Exception thrown: ${error}`,
              ),
            );
          });
        });
      });
    });

    return { inserted, deleted: 0 };
  }

  private async getAssetsExpiryFileB3(
    dateRef: DateTime,
  ): Promise<string | undefined> {
    puppeteer.use(StealthPlugin());

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--single-process', '--no-zygote', '--no-sandbox'],
    });

    let csvPathFileName: string | undefined;
    try {
      csvPathFileName = await this.retry({
        dateRef,
        action: 'GET_FILE_ASSETS_EXPIRY_B3',
        browser,
      });
    } finally {
      await browser.close();
    }
    return csvPathFileName;
  }

  private async getAssetsExpiryFileCloud(
    dateRef: DateTime,
  ): Promise<string | undefined> {
    const pathAssetsExpiryZipFileName = path.join(
      __dirname,
      '../../../',
      process.env.TEMP_DATA_FILES_DIR || 'data',
      (
        process.env.B3_ASSETS_EXPIRY_ZIPFILENAME || 'B3_ASSETS_EXPIRY_$DATE.zip'
      ).replace('$DATE', dateRef.toFormat('yyyyMMdd')),
    );

    if (
      await this.retry({
        dateRef,
        action: 'GET_FILE_ASSETS_EXPIRY_CLOUD',
        pathFileName: pathAssetsExpiryZipFileName,
      })
    ) {
      if (!fs.existsSync(pathAssetsExpiryZipFileName)) return undefined;

      const pathAssetsExpiryFileName = await ZipFileManager.unzipFirstFileNamed(
        pathAssetsExpiryZipFileName,
        path.basename(
          pathAssetsExpiryZipFileName,
          path.extname(pathAssetsExpiryZipFileName),
        ),
      );

      if (fs.existsSync(pathAssetsExpiryFileName))
        return pathAssetsExpiryFileName;
    }
    return undefined;
  }

  private async updateAssetsExpiryTables(
    dateRef: DateTime,
  ): Promise<ILoadResult> {
    // TABLE "b3-summary"
    let qAssetsExpiry = await this.queryFactory.runQuery(
      `SELECT ae.asset, ae.type assettype, ae."option-type" optiontype, 
      ae."option-style" as optionstyle, 
      ae."option-exercise-price" optionexerciseprice, 
      ae."date-trading-start" datetradingstart, 
      ae."date-trading-end" datetradingend, 
      ae."date-expiry" dateexpiry 
      FROM "b3-assets-expiry" ae INNER JOIN "b3-summary" su 
      ON (ae.asset=su.asset) WHERE su.date::DATE=$1`, // AND ae.type = ANY ($2)`,
      {
        dateRef: dateRef.startOf('day').toJSDate(),
        // types: [TAssetType.FUTURES, TAssetType.OPTIONS],
      },
    );

    let totalUpdated = 0;
    let updated = 0;
    for await (const assetExpiry of qAssetsExpiry) {
      const [, count] = await this.queryFactory.runQuery(
        `UPDATE "b3-summary" SET 
        "asset-type"=$3,
        "option-type"=$4, 
        "option-style"=$5, 
        "option-exercise-price"=$6, 
        "date-trading-start"=$7, 
        "date-trading-end"=$8, 
        "date-expiry"=$9 
        WHERE date::DATE=$1 AND asset=$2`,
        {
          date: dateRef.startOf('day').toJSDate(),
          asset: assetExpiry.asset,
          assetType: assetExpiry.assettype,
          optionType: assetExpiry.optiontype || null,
          optionStyle: assetExpiry.optionstyle || null,
          optionExercisePrice: assetExpiry.optionexerciseprice || null,
          dateTradingStart: assetExpiry.datetradingstart || null,
          dateTradingEnd: assetExpiry.datetradingend || null,
          dateExpiry: assetExpiry.dateexpiry || null,
        },
      );
      updated += count;
    }
    totalUpdated += updated;

    this.logger.silly(
      `[${this.processName}] SUMMARY records updated: ${updated}`,
    );

    // TABLE "b3-ts-summary"
    qAssetsExpiry = await this.queryFactory.runQuery(
      `SELECT DISTINCT ae.asset, ae.type assettype, 
      ae."option-type" optiontype, 
      ae."option-style" optionstyle, 
      ae."option-exercise-price" optionexerciseprice, 
      ae."date-trading-start" datetradingstart, 
      ae."date-trading-end" datetradingend, 
      ae."date-expiry" dateexpiry 
      FROM "b3-assets-expiry" ae INNER JOIN "b3-ts-summary" ts 
      ON (ae.asset=ts.asset) WHERE ts."timestamp-open"::DATE=$1`, // AND ae.type = ANY ($2)`,
      {
        dateRef: dateRef.startOf('day').toJSDate(),
        // types: [TAssetType.FUTURES, TAssetType.OPTIONS],
      },
    );

    updated = 0;
    for await (const assetExpiry of qAssetsExpiry) {
      const [, count] = await this.queryFactory.runQuery(
        `UPDATE "b3-ts-summary" SET 
        "asset-type"=$3,
        "option-type"=$4, 
        "option-style"=$5, 
        "option-exercise-price"=$6, 
        "date-trading-start"=$7, 
        "date-trading-end"=$8, 
        "date-expiry"=$9 
        WHERE "timestamp-open"::DATE=$1::DATE AND asset=$2`,
        {
          date: dateRef.startOf('day').toJSDate(),
          asset: assetExpiry.asset,
          assetType: assetExpiry.assettype,
          optionType: assetExpiry.optiontype || null,
          optionStyle: assetExpiry.optionstyle || null,
          optionExercisePrice: assetExpiry.optionexerciseprice || null,
          dateTradingStart: assetExpiry.datetradingstart || null,
          dateTradingEnd: assetExpiry.datetradingend || null,
          dateExpiry: assetExpiry.dateexpiry || null,
        },
      );
      updated += count;
    }
    totalUpdated += updated;

    this.logger.silly(
      `[${this.processName}] TS-SUMMARY records updated: ${updated}`,
    );

    // TABLE "b3-oi-contracts"
    qAssetsExpiry = await this.queryFactory.runQuery(
      `SELECT DISTINCT 
      oi."asset-code" assetcode,
      oi.contract contract,
      ae."date-trading-start" datetradingstart, 
      ae."date-trading-end" datetradingend, 
      ae."date-expiry" dateexpiry
      FROM "b3-assets-expiry" ae 
      INNER JOIN "b3-oi-contracts" oi 
      ON (ae.asset=(oi."asset-code" || oi.contract)) 
      WHERE oi.date::DATE=$1`, // AND ae.type = ANY ($2)`,
      {
        dateRef: dateRef.startOf('day').toJSDate(),
        // types: [TAssetType.FUTURES],
      },
    );

    updated = 0;
    for await (const assetExpiry of qAssetsExpiry) {
      const [, count] = await this.queryFactory.runQuery(
        `UPDATE "b3-oi-contracts" SET 
        "date-trading-start"=$4, 
        "date-trading-end"=$5, 
        "date-expiry"=$6 
        WHERE date::DATE=$1 AND "asset-code"=$2 AND contract=$3`,
        {
          date: dateRef.startOf('day').toJSDate(),
          assetCode: assetExpiry.assetcode,
          contract: assetExpiry.contract,
          dateTradingStart: assetExpiry.datetradingstart || null,
          dateTradingEnd: assetExpiry.datetradingend || null,
          dateExpiry: assetExpiry.dateexpiry || null,
        },
      );
      updated += count;
    }
    totalUpdated += updated;

    this.logger.silly(
      `[${this.processName}] OI-CONTRACTS records updated: ${updated}`,
    );

    return { inserted: totalUpdated, deleted: 0 };
  }
}
export {
  TAssetType,
  TAssetGroup,
  TRolloverBasePrice,
  TOptionType,
  TOptionStyle,
};
