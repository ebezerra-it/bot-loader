/* eslint-disable no-continue */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-empty */
/* eslint-disable prefer-destructuring */
/* eslint-disable no-restricted-syntax */
import { Browser, CDPSession, Page, Frame } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import csv from 'csv-parser';
import path from 'path';
import fs from 'fs';
import { DateTime } from 'luxon';
import axios from 'axios';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { ILoadResult } from '../reportLoader';
import { loadJSONFile } from '../utils';

enum TAssetType {
  FUTURES = 'FUTURES',
  OPTIONS = 'OPTIONS',
}

interface IAssetLoadConfig {
  globexcode: string;
  summaryFutures: boolean;
  summaryOptions: boolean;
  chartLoadFutures: boolean;
  active: boolean;
  optionsGlobex: string[];
}

interface IAsset {
  productId: number;
  type: TAssetType;
  globexcode: string;
  contract: string;
  productName: string;
  productGroup: string;
  productSubGroup: string;
  exchange: string;
  dateAvail: DateTime;
  dateExpiration: DateTime;
  dateSettle: DateTime;
  underlyingGlobexcode: string | undefined;
  underlyingContract: string | undefined;
  optTypeCode: string | undefined;
  optTypeDaily: boolean | undefined;
  optTypeWeekly: boolean | undefined;
  optTypeSTO: boolean | undefined;
}

interface IAssetProduct {
  productId: number;
  type: TAssetType;
  globexcode: string;
  productName: string;
  productGroup: string;
  productSubGroup: string;
}

interface IAssetExpiry {
  label: string;
  exchange: string;
  type: TAssetType;
  globexcode: string;
  contract: string;
  dateAvail: DateTime;
  dateExpiration: DateTime;
  dateSettle: DateTime;
  underlyingGlobexcode: string | undefined;
  underlyingContract: string | undefined;
}

interface IAssetOptionType {
  productId: number;
  optTypeCode: string;
  optTypeDaily: boolean;
  optTypeWeekly: boolean;
  optTypeSTO: boolean;
}

interface ITab {
  name: string;
  selector: string;
}

export default class AssetsExpiryCME extends ReportLoaderCalendar {
  private aAssetsLoadConfig: IAssetLoadConfig[];

  async process(params: {
    dateRef: DateTime;
    dateMatch: DateTime;
  }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );

    this.aAssetsLoadConfig = await this.loadAssetsLoadConfig();
    const aAssetsExpiry: IAssetExpiry[] = await this.loadAssetsExpiryCME(
      params.dateRef,
    );

    const aAssetsProduct: IAssetProduct[] = await this.getCMEAssetsProducts();

    const aOptionTypes: IAssetOptionType[] = [];

    let inserted = 0;
    for await (const asset of aAssetsProduct.filter(
      a => a.type === TAssetType.FUTURES,
    )) {
      const resOptionType: IAssetOptionType[] = await this.retry({
        action: 'GET_ASSET_OPTIONTYPE',
        underlyingProductId: asset.productId,
      });
      aOptionTypes.push(...resOptionType);
    }

    for await (const assetExpiry of aAssetsExpiry) {
      const product = aAssetsProduct.find(
        p =>
          p.globexcode === assetExpiry.globexcode &&
          p.type === assetExpiry.type,
      );
      if (!product) {
        this.logger.silly(
          `[${this.processName}] Product not found: ${JSON.stringify(
            assetExpiry,
          )}`,
        );
        continue;
      }

      let optionType: IAssetOptionType | undefined;
      if (assetExpiry.type === TAssetType.OPTIONS) {
        optionType = aOptionTypes.find(o => o.productId === product.productId);
        if (!optionType) {
          this.logger.silly(
            `[${this.processName}] OptType not found: ${JSON.stringify(
              assetExpiry,
            )}`,
          );
          continue;
        }
      }

      const aAsset: IAsset = {
        globexcode: assetExpiry.globexcode,
        type: assetExpiry.type,
        contract: assetExpiry.contract,
        productId: product.productId,
        productName: product.productName,
        productGroup: product.productGroup,
        productSubGroup: product.productSubGroup,
        exchange: assetExpiry.exchange,
        dateAvail: assetExpiry.dateAvail,
        dateExpiration: assetExpiry.dateExpiration,
        dateSettle: assetExpiry.dateSettle,
        underlyingGlobexcode: assetExpiry.underlyingGlobexcode,
        underlyingContract: assetExpiry.underlyingContract,
        optTypeCode: optionType ? optionType.optTypeCode : undefined,
        optTypeDaily: optionType ? optionType.optTypeDaily : undefined,
        optTypeWeekly: optionType ? optionType.optTypeWeekly : undefined,
        optTypeSTO: optionType ? optionType.optTypeSTO : undefined,
      };

      const sql = `INSERT INTO "cme-assets-expiry" 
      (globexcode, type, contract, "product-id", "product-name", "product-group", 
      "product-subgroup", exchange, "date-avail", "date-expiry", 
      "date-settle", "underlying-globexcode", "underlying-contract", 
      "opt-type-code", "opt-type-daily", "opt-type-weekly", "opt-type-sto") 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) 
      ON CONFLICT (globexcode, type, contract) 
      DO UPDATE SET "product-id"=$4, "product-name"=$5, "product-group"=$6, 
      "product-subgroup"=$7, exchange=$8, "date-avail"=$9, "date-expiry"=$10, 
      "date-settle"=$11, "underlying-globexcode"=$12, "underlying-contract"=$13, 
      "opt-type-code"=$14, "opt-type-daily"=$15, "opt-type-weekly"=$16, 
      "opt-type-sto"=$17`;

      await this.queryFactory.runQuery(sql, {
        globexcode: aAsset.globexcode,
        type: aAsset.type,
        contract: aAsset.contract,
        productId: aAsset.productId,
        productName: aAsset.productName,
        productGroup: aAsset.productGroup,
        productSubGroup: aAsset.productSubGroup,
        exchange: aAsset.exchange,
        dateAvail: aAsset.dateAvail,
        dateExpiration: aAsset.dateExpiration,
        dateSettle: aAsset.dateSettle,
        underlyingGlobexcode: aAsset.underlyingGlobexcode || null,
        underlyingContract: aAsset.underlyingContract || null,
        optTypeCode: aAsset.optTypeCode || null,
        optTypeDaily: aAsset.optTypeDaily || null,
        optTypeWeekly: aAsset.optTypeWeekly || null,
        optTypeSTO: aAsset.optTypeSTO || null,
      });
      inserted++;
    }

    return { inserted, deleted: 0 };
  }

  async performQuery(params: {
    action: string;
    csvFilePath: string;
    browser?: Browser;
    pgProducts?: Page;
    tab?: ITab;
    pageNumber?: number;
    underlyingProductId?: string;
    tries: number;
  }): Promise<
    | Page
    | string
    | { assets: IAssetProduct[]; totalPages: number }
    | IAssetOptionType[]
  > {
    if (params.action === 'GET_ASSET_OPTIONTYPE') {
      if (!params.underlyingProductId)
        throw new Error(
          `[${this.processName}] PerformQuery() - Action: GET_ASSET_OPTIONTYPE - Missing parameters`,
        );
      const url = `https://www.cmegroup.com/CmeWS/mvc/Settlements/Options/TradeDateAndExpirations/${params.underlyingProductId}`;

      const headers = {
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=0',
      };
      const api = axios.create();
      const aAssets: IAssetOptionType[] = [];
      const res = (await api.get(url, { headers })).data;

      if (!Array.isArray(res))
        throw new Error(
          `[${
            this.processName
          }] PerformQuery() - Action: GET_ASSET_OPTIONTYPE - Unexpected response: ${JSON.stringify(
            res,
          )}`,
        );

      res.forEach((asset: any) => {
        if (!Array.isArray(asset.productIds)) return;

        asset.productIds.forEach((pid: any) => {
          aAssets.push({
            productId: Number(pid),
            optTypeCode: asset.optionType,
            optTypeDaily: asset.daily,
            optTypeWeekly: asset.weekly,
            optTypeSTO: asset.sto,
          });
        });
      });

      return aAssets;
    }

    if (params.action === 'GET_PRODUCTS_LIST') {
      if (!params.pageNumber)
        throw new Error(
          `[${this.processName}] PerformQuery() - Action: GET_PRODUCTS_LIST - Missing parameters`,
        );

      const url = `https://www.cmegroup.com/services/product-slate?sortAsc=false&pageNumber=${
        params.pageNumber
      }&pageSize=${process.env.CME_REQUEST_PAGESIZE || '5000'}`;

      const headers = {
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=0',
      };
      const api = axios.create();
      const aAssets: IAssetProduct[] = [];
      const res = (await api.get(url, { headers })).data;
      if (res && res.products && res.products.length > 0) {
        res.products.forEach((p: any) => {
          if (
            (String(p.cleared).toUpperCase() !== 'FUTURES' &&
              String(p.cleared).toUpperCase() !== 'OPTIONS') ||
            !this.aAssetsLoadConfig.find(
              a =>
                a.globexcode === p.globex ||
                a.optionsGlobex.find(aa => aa === p.globex),
            )
          )
            return;
          aAssets.push({
            globexcode: p.globex,
            productId: p.id,
            productName: p.name,
            productGroup: p.group,
            productSubGroup: p.subGroup,
            type:
              String(p.cleared).toUpperCase() === 'FUTURES'
                ? TAssetType.FUTURES
                : TAssetType.OPTIONS,
          });
        });
      }
      return { assets: aAssets, totalPages: res.props.pageTotal };
    }

    if (params.action === 'GET_PRODUCTS_PAGE') {
      // close all pages before start
      for await (const pg of await params.browser!.pages()) {
        await pg.close();
      }
      const url = `https://www.cmegroup.com/tools-information/quikstrike/options-calendar.html`;
      let page: Page | undefined;
      let pgProducts: Page | undefined;
      let cdp: CDPSession | undefined;
      try {
        page = await params.browser!.newPage();
        await page.waitForTimeout(3000);

        // Clear all cookies to avoid server track
        try {
          cdp = await page.target().createCDPSession();
          await cdp.send('Network.clearBrowserCookies');
        } catch (e) {}

        await page.goto(url, { waitUntil: 'networkidle2' });
        await page.waitForSelector('iframe.cmeIframe');

        const iframe = page
          .frames()
          .find(
            (frame: Frame) =>
              frame
                .url()
                .includes('viewitemid=IntegratedCMEOptionExpirationCalendar') ||
              frame.name().match(/^cmeIframe-(.*)$/),
          );

        if (!iframe)
          throw new Error('Unable to find Assets Expiry Calendar Frame');

        await iframe.waitForSelector(
          '#MainContent_ucViewControl_IntegratedCMEOptionExpirationCalendar_ucViewControl_hlCMEProducts',
          { visible: true },
        );

        await iframe.click(
          '#MainContent_ucViewControl_IntegratedCMEOptionExpirationCalendar_ucViewControl_hlCMEProducts',
        );
        await iframe.waitForTimeout(2000);

        const pages = await params.browser!.pages();
        pgProducts = pages[pages.length - 1];

        return pgProducts;
      } finally {
        try {
          if (cdp) await cdp.detach();
        } catch (e) {}
        try {
          if (page) await page.close();
        } catch (e) {}
      }
    }

    if (params.action === 'GET_DATA_FOR_TAB') {
      let cdp: CDPSession | undefined;
      let pgProducts: Page = params.pgProducts!;
      let csvFilename: string;

      if (params.tries > 0 || !params.pgProducts) {
        pgProducts = await this.retry({
          action: 'GET_PRODUCTS_PAGE',
          browser: params.browser,
          csvFilePath: params.csvFilePath,
        });
      }
      try {
        cdp = await pgProducts.target().createCDPSession();
        await cdp.send('Page.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: params.csvFilePath,
        });

        await pgProducts.waitForSelector(params.tab!.selector);
        await pgProducts.click(params.tab!.selector);
        await pgProducts.waitForTimeout(2000);

        await pgProducts.waitForSelector(
          '#cphMain_ucProductBrowser_ucProductActions_ucTrigger_lnkTrigger',
          { visible: true },
        );
        await pgProducts.click(
          '#cphMain_ucProductBrowser_ucProductActions_ucTrigger_lnkTrigger',
        );
        await pgProducts.waitForSelector(
          '#cphMain_ucProductBrowser_ucProductActions_lnkExport',
          { visible: true },
        );

        csvFilename = await new Promise((resolve, reject) => {
          let bytes = 0;
          pgProducts.on('response', response => {
            const downloadTimeout = setInterval(() => {
              pgProducts.removeAllListeners('response');
              reject(
                new Error(
                  `File download timed out for tab ${
                    params.tab!.name
                  } - Bytes downloaded: ${bytes}`,
                ),
              );
            }, 15000 + Number(process.env.CME_ASSETS_EXPIRY_FILE_DOWNLOAD_TIMEOUT || '20') * 1000);

            const header = response.headers()['content-disposition'];
            if (header && header.includes('filename=')) {
              const filename = response
                .headers()
                ['content-disposition'].match(
                  /^\s*(attachment|inline)\s*;\s*filename\s*=\s*"?(.*)"?$/,
                )![2];
              if (!filename) {
                clearTimeout(downloadTimeout);
                pgProducts.removeAllListeners('response');
                reject(
                  new Error(
                    `Can't read filename from header: ${
                      response.headers()['content-disposition']
                    }`,
                  ),
                );
              }

              fs.watchFile(
                path.join(params.csvFilePath, filename),
                (curr, _prev) => {
                  bytes = curr.size;
                  if (
                    curr.size === Number(response.headers()['content-length'])
                  ) {
                    clearTimeout(downloadTimeout);
                    pgProducts.removeAllListeners('response');
                    resolve(filename);
                  }
                },
              );
            }
          });
          pgProducts.click(
            '#cphMain_ucProductBrowser_ucProductActions_lnkExport',
          );
        });
      } finally {
        if (cdp)
          try {
            await cdp.detach();
          } catch (e) {}
      }
      return csvFilename;
    }

    throw new Error(
      `[${this.processName}] PerformQuery() - Unknown action parameter`,
    );
  }

  private async loadAssetsExpiryCME(
    dateRef: DateTime,
  ): Promise<IAssetExpiry[]> {
    puppeteer.use(StealthPlugin());

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--single-process', '--no-zygote', '--no-sandbox'],
    });

    const csvFilePath = path.join(
      __dirname,
      '../../../',
      process.env.TEMP_DATA_FILES_DIR || 'data',
    );

    const aAssetsExpiry: IAssetExpiry[] = [];

    try {
      const pgProducts: Page = await this.retry({
        action: 'GET_PRODUCTS_PAGE',
        browser,
        csvFilePath,
      });

      const tabs: ITab[] = [
        { name: 'agriculture', selector: '#ctl00_cphMain_lvTabs_ctrl0_lbTab' },
        {
          name: 'cryptocurrencies',
          selector: '#ctl00_cphMain_lvTabs_ctrl1_lbTab',
        },
        { name: 'energy', selector: '#ctl00_cphMain_lvTabs_ctrl2_lbTab' },
        { name: 'equities', selector: '#ctl00_cphMain_lvTabs_ctrl3_lbTab' },
        { name: 'forex', selector: '#ctl00_cphMain_lvTabs_ctrl4_lbTab' },
        {
          name: 'interest rates',
          selector: '#ctl00_cphMain_lvTabs_ctrl5_lbTab',
        },
        { name: 'metals', selector: '#ctl00_cphMain_lvTabs_ctrl6_lbTab' },
        { name: 'real estate', selector: '#ctl00_cphMain_lvTabs_ctrl7_lbTab' },
        { name: 'weather', selector: '#ctl00_cphMain_lvTabs_ctrl8_lbTab' },
      ];

      for await (const tab of tabs) {
        this.logger.silly(
          `[${this.processName}] Loading data for Tab ${tab.name}`,
        );
        const csvFilename = await this.retry({
          action: 'GET_DATA_FOR_TAB',
          pgProducts,
          tab,
          csvFilePath,
          browser,
        });

        const resAssetsExpiry: IAssetExpiry[] =
          await this.loadAssetsExpiryCMETab(
            dateRef,
            tab,
            path.join(csvFilePath, csvFilename),
          );
        aAssetsExpiry.push(...resAssetsExpiry);

        this.logger.silly(
          `[${this.processName}] Tab ${
            tab.name
          } - Loading results: ${JSON.stringify(resAssetsExpiry.length)}`,
        );

        fs.unlinkSync(path.join(csvFilePath, csvFilename));
      }
    } finally {
      await browser.close();
    }
    return aAssetsExpiry;
  }

  private async loadAssetsExpiryCMETab(
    dateRef: DateTime,
    tab: ITab,
    csvPathFileName: string,
  ): Promise<IAssetExpiry[]> {
    // 0-Product Group, 1-Product, 2-Symbol, 3-Underlying, 4-First Avail, 5-Expiration, 6-Settle, 7-Clearing, 8-Globex, 9-Prs, 10-Floor, 11-Group, 12-Itc, 13-Exchange, 14-Contract Type
    // Emerging Market,Brazilian Real Futures,6LJ2,,03/31/2017,03/31/2022 09:15,04/01/2022,BR,6L,BR,BR,6L,BR,CME,Future
    // Emerging Market,BRL/USD Monthly Options,BRJ2,6LJ2,09/11/2020,03/31/2022 09:15,04/01/2022,BR,BR,OR,BR,OR,BR,CME,Option
    /* 
    SPREAD SYMBOLS LAYOUTS: (not implemented)
    Emerging Market,Brazilian Real Futures,6LM2-6LJ2,,01/31/2022,03/31/2022 09:15,03/31/2022,BR,6L,BR,BR,6L,BR,CME,Future Spread
    Stirs,Eurodollar Futures,GE:FB 06Y M3,,03/15/2019,06/19/2023 05:00,06/19/2023,ED,GE,ED,ED,GE,ED,CME,Future Spread
    Stirs,Eurodollar Futures,GE:CF M3U3Z3H4,,03/15/2019,06/19/2023 05:00,06/19/2023,ED,GE,ED,ED,GE,ED,CME,Future Spread
    Stirs,Eurodollar Futures,GE:MP U3 1YZ3,,12/12/2014,09/18/2023 05:00,09/18/2023,ED,GE,ED,ED,GE,ED,CME,Future Spread
    Stirs,Eurodollar Futures,GE:BF U3-M4-H5,,03/13/2015,09/18/2023 05:00,09/18/2023,ED,GE,ED,ED,GE,ED,CME,Future Spread
    Stirs,Three-Month SOFR Futures,SR3:SB 1Y H6-H7,,04/23/2021,06/16/2026 16:00,06/16/2026,SR3,SR3,SR3,,SR3,,CME,Future Spread
    Stirs,30 Day Federal Funds Futures,ZQ:FS 03M H3,,09/30/2021,03/31/2023 16:00,03/31/2023,41,ZQ,FF,FF,ZQ,FF,CBT,Future Spread
    */
    const assetsExpiry: IAssetExpiry[] = await new Promise<IAssetExpiry[]>(
      (resolve, reject) => {
        const assetsExp: IAssetExpiry[] = [];
        let readCount = 0;

        // TO DO: capture raw data row to erase ',' in product field before pipe to csv
        fs.createReadStream(csvPathFileName)
          .pipe(
            csv({
              separator: process.env.CME_ASSETS_EXPIRY_FILE_SEPARATOR || ',',
              mapHeaders: ({ header }) =>
                header.toLowerCase().replace(/\s/g, ''),
              mapValues: ({ value }) => value.trim(),
            }),
          )
          .on('data', async (row: any) => {
            let symbol: RegExpMatchArray | null;
            let globexcode: string;
            let contract: string;
            let underlyingGlobexcode: string | undefined;
            let underlyingContract: string | undefined;

            readCount++;

            if (Object.keys(row).length !== 15) return;

            const type =
              row.contracttype.toUpperCase() === 'FUTURE'
                ? TAssetType.FUTURES
                : row.contracttype.toUpperCase() === 'OPTION'
                ? TAssetType.OPTIONS
                : undefined;
            switch (type) {
              case TAssetType.FUTURES:
                symbol = row.symbol
                  .toUpperCase()
                  .match(/^(.*)((F|G|H|J|K|M|N|Q|U|V|X|Z)(\d{1,2})(\d{2})?)$/);
                if (!symbol) {
                  this.logger.silly(
                    `[${this.processName}] loadAssetsExpiryCMEFile() - Tab: ${
                      tab.name
                    } - Unknown FUT symbol: ${JSON.stringify(row)}`,
                  );
                  return;
                }
                if (symbol[5]) return; // IGNORE DAILY CONTRACT FUTURES

                globexcode = symbol![1];
                contract = `${symbol![3].toUpperCase()}${
                  symbol![4].length === 1
                    ? symbol![4] === '0' &&
                      Number(String(dateRef.year).substr(2, 1)) !== 0
                      ? Number(String(dateRef.year).substr(2, 1)) + 1
                      : String(dateRef.year).substr(2, 1)
                    : ''
                }${symbol![4]}`;
                break;

              case TAssetType.OPTIONS:
                symbol = row.symbol
                  .toUpperCase()
                  .match(/^(.*)((F|G|H|J|K|M|N|Q|U|V|X|Z)(\d{1,2}))$/);
                if (!symbol) {
                  this.logger.silly(
                    `[${this.processName}] loadAssetsExpiryCMEFile() - Tab: ${
                      tab.name
                    } - Unknown OPT symbol: ${JSON.stringify(row)}`,
                  );
                  return;
                }
                if (symbol[5]) return; // IGNORE DAILY CONTRACT FUTURES

                globexcode = symbol![1];
                contract = `${symbol![3].toUpperCase()}${
                  symbol![4].length === 1
                    ? symbol![4] === '0' &&
                      Number(String(dateRef.year).substr(2, 1)) !== 0
                      ? Number(String(dateRef.year).substr(2, 1)) + 1
                      : String(dateRef.year).substr(2, 1)
                    : ''
                }${symbol![4]}`;

                symbol = row.underlying
                  .toUpperCase()
                  .match(/^(.*)((F|G|H|J|K|M|N|Q|U|V|X|Z)(\d{1,2}))$/);
                if (!symbol) {
                  this.logger.silly(
                    `[${this.processName}] loadAssetsExpiryCMEFile() - Tab: ${
                      tab.name
                    } - Unknown OPT underlying: ${JSON.stringify(row)}`,
                  );
                  return;
                }
                underlyingGlobexcode = symbol![1];
                underlyingContract = `${symbol![3].toUpperCase()}${
                  symbol![4].length === 1
                    ? symbol![4] === '0' &&
                      Number(String(dateRef.year).substr(2, 1)) !== 0
                      ? Number(String(dateRef.year).substr(2, 1)) + 1
                      : String(dateRef.year).substr(2, 1)
                    : ''
                }${symbol![4]}`;

                break;

              default:
                return;
            }

            const dateAvail = DateTime.fromFormat(
              row.firstavail,
              'MM/dd/yyyy',
              {
                zone: this.exchange.timezone,
              },
            );
            const dateExpiration = DateTime.fromFormat(
              `${row.expiration}`,
              'MM/dd/yyyy HH:mm',
              { zone: this.exchange.timezone },
            );
            const dateSettle = DateTime.fromFormat(row.settle, 'MM/dd/yyyy', {
              zone: this.exchange.timezone,
            });

            if (
              !dateAvail.isValid ||
              !dateExpiration.isValid ||
              !dateSettle.isValid
            ) {
              this.logger.warn(
                `[${this.processName}] loadAssetsExpiryCMEFile() - Tab: ${
                  tab.name
                } - Invalid date: ${JSON.stringify(row)}`,
              );
              return;
            }

            const ae: IAssetExpiry = {
              globexcode,
              contract,
              type,
              exchange: row.exchange.toUpperCase(),
              label: row.product,
              dateAvail,
              dateExpiration,
              dateSettle,
              underlyingGlobexcode,
              underlyingContract,
            };

            if (ae.dateSettle.toMillis() >= dateRef.startOf('day').toMillis()) {
              const assetConfig = this.aAssetsLoadConfig.find(
                a =>
                  a.globexcode === ae.globexcode ||
                  (ae.underlyingGlobexcode &&
                    a.globexcode === ae.underlyingGlobexcode),
              );
              if (assetConfig) {
                assetsExp.push(ae);
                if (
                  ae.underlyingGlobexcode &&
                  assetConfig.globexcode === ae.underlyingGlobexcode &&
                  !assetConfig.optionsGlobex.find(a => a === ae.globexcode)
                ) {
                  assetConfig.optionsGlobex.push(ae.globexcode);
                }
              }
            }
          })
          .on('end', async () => {
            resolve(assetsExp);
          })
          .on('error', error => {
            this.logger.error(
              `[${this.processName}] - Records read: ${readCount} - Error: ${error.message}`,
            );

            reject(error);
          });
      },
    );

    return assetsExpiry;
  }

  public async getCMEAssetsProducts(): Promise<IAssetProduct[]> {
    let page = 1;
    let totalPages = 1;

    const aAssetsProducts: IAssetProduct[] = [];
    while (page <= totalPages) {
      const res: { assets: IAssetProduct[]; totalPages: number } =
        await this.retry({
          action: 'GET_PRODUCTS_LIST',
          pageNumber: page,
        });

      const assets = res.assets.filter(a =>
        this.aAssetsLoadConfig.find(
          ac =>
            ac.globexcode === a.globexcode ||
            ac.optionsGlobex.find(aopt => aopt === a.globexcode),
        ),
      );
      if (assets) aAssetsProducts.push(...res.assets);

      totalPages = res.totalPages;
      page++;

      if (page <= totalPages)
        await this.sleep(Number(process.env.CME_QUERY_INTERVAL || '0'));
    }
    return aAssetsProducts;
  }

  private async loadAssetsLoadConfig(): Promise<IAssetLoadConfig[]> {
    try {
      const assets: any[] = await loadJSONFile(
        path.join(
          __dirname,
          '../../../',
          'config/',
          'CME_assets_load_config.json',
        ),
      );

      const filteredAssets: IAssetLoadConfig[] = assets
        .filter(
          a =>
            a.active &&
            a.globexcode.trim() !== '' &&
            (a.summaryFutures || a.summaryOptions || a.chartLoadFutures),
        )
        .map((a: any): IAssetLoadConfig => {
          return {
            globexcode: String(a.globexcode).toUpperCase(),
            summaryFutures: a.summaryFutures,
            summaryOptions: a.summaryOptions,
            chartLoadFutures: a.chartLoadFutures,
            active: a.active,
            optionsGlobex: [],
          };
        });

      if (!filteredAssets || filteredAssets.length === 0)
        throw new Error(
          `[${this.processName}] loadAssetsLoadConfig() - Identified error in file '/config/CME_assets_load_config.json': No asset was selected`,
        );

      return filteredAssets;
    } catch (e) {
      throw new Error(
        `[${this.processName}] loadAssetsLoadConfig() - Identified error when parsing file '/config/CME_assets_load_config.json': ${e.message}`,
      );
    }
  }
}
