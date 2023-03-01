/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable no-restricted-syntax */
/* eslint-disable default-case */
/*
import { Page, Frame } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

interface IBlockTrade {
  timestampTrade: Date;
  globexCode: string;
  contract: string;
  level: number;
  size: number;
}

export default class BlockTrades {
  async performQuery(params: {
    type?: string;
    urlSettle: string;
    urlVolume: string;
    urlTimeSlots: string;
    urlTimesNSales: string;
    urlBlockTrades: string;
    urlOptions: string;
    urlTSOption: string;
    page: Page;
  }): Promise<any> {
    switch (params.type) {
      case 'BLOCKTRADES': {
        await params.page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
        );
        // pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7
        await params.page.setExtraHTTPHeaders({
          'Accept-Language': 'pt-BR',
        });
        await params.page.goto(
          `https://www.cmegroup.com/tools-information/quikstrike/block-trade-browser.html`,
          { waitUntil: 'domcontentloaded' },
        );

        return true;
      }
    }
    return true;
  }

  private async getContractsTimeSlots(
    asset: IAsset,
  ): Promise<IContract[] | undefined> {
    await this.sleep(this.config.process_query_interval);

    const contracts: IContract[] = [];
    const urlTimeSlots = `https://www.cmegroup.com/CmeWS/mvc/TimeandSales/Future/ExpirationsAndSlots/${asset.CMEId}/G`;
    const resTimeSlots = await this.retry({ type: 'TIMESLOTS', urlTimeSlots });

    if (!resTimeSlots) return undefined;
    resTimeSlots.forEach((contract: any) => {
      contracts.push({
        code: contract.expiration.twoDigitsCode,
        code1Digit: contract.expiration.code,
        timeSlots: contract.timeSlots.map((ts: any) => {
          return {
            entryDate: parse(ts.entryDate, 'yyyyMMdd', new Date()),
            hour: ts.hour,
          };
        }),
      });
    });

    return contracts;
  }

  private async getBlockTrades(
    _dateRef: Date,
  ): Promise<{ count: number; volume: number }> {
    const tradeCount = 0;
    const totalVolume = 0;
    const tabs: string[] = [
      'ctl00_cphMain_lvTabs_ctrl0_lbTab',
      'ctl00_cphMain_lvTabs_ctrl1_lbTab',
      'ctl00_cphMain_lvTabs_ctrl2_lbTab',
      'ctl00_cphMain_lvTabs_ctrl3_lbTab',
      'ctl00_cphMain_lvTabs_ctrl4_lbTab',
      'ctl00_cphMain_lvTabs_ctrl5_lbTab',
      'ctl00_cphMain_lvTabs_ctrl6_lbTab',
      'ctl00_cphMain_lvTabs_ctrl7_lbTab',
    ];

    puppeteer.use(StealthPlugin());

    const blockTrades: IBlockTrade[] = [];

    const browser = await puppeteer.launch({
      // @ts-ignore
      headless: true,
      args: ['--single-process', '--no-zygote', '--no-sandbox'],
    });

    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(0);

      // await this.retry({ type: 'BLOCKTRADES', page });

      // --------------> Check if it exists
      // Hide "Accept Coookies" panel
      try {
        await page.waitForSelector('#cmePermissionQuestion');
        await page.$eval('#cmePermissionQuestion', div =>
          div.setAttribute('style', 'display:none'),
        );
        // eslint-disable-next-line no-empty
      } catch (e) {}

      const iframe = page
        .frames()
        .find((frame: Frame) => frame.url().includes('CMEView.aspx'));

      if (!iframe) throw new Error('Could not read block trades.');

      // Filter
      await iframe.waitForSelector(
        '#cphMain_ucBlockTradesBrowser_ucBlockTradesFilter_ucTrigger_lnkTrigger',
      );
      await iframe.click(
        '#cphMain_ucBlockTradesBrowser_ucBlockTradesFilter_ucTrigger_lnkTrigger',
      ); // PANEL FILTER

      await iframe.waitForSelector(
        '#cphMain_ucBlockTradesBrowser_ucBlockTradesFilter_ucContractTypeList_rblContractType_2',
        { visible: true },
      );

      await iframe.click(
        '#cphMain_ucBlockTradesBrowser_ucBlockTradesFilter_ucContractTypeList_rblContractType_2',
      ); // Contract Type - Futures Only

      await iframe.click(
        '#cphMain_ucBlockTradesBrowser_ucBlockTradesFilter_ucTradeTypeList_chkOptions',
      ); // Block Type - uncheck Options

      await iframe.click(
        '#cphMain_ucBlockTradesBrowser_ucBlockTradesFilter_ucTradeTypeList_chkStrips',
      ); // Block Type - uncheck Strips

      await iframe.click(
        '#cphMain_ucBlockTradesBrowser_ucBlockTradesFilter_ucTradeTypeList_chkSpreads',
      ); // Block Type - uncheck Spreads

      await iframe.click(
        '#cphMain_ucBlockTradesBrowser_ucBlockTradesFilter_btnApply',
      );

      await iframe.waitForTimeout(1000);
      // DIV loading image: cphMain_ucBlockTradesBrowser_upThrobber
      await iframe.waitForSelector('#cphMain_ucBlockTradesBrowser_upThrobber', {
        hidden: true,
      });

      for await (const [idx, tab] of tabs.entries()) {
        // Click tab
        await iframe.waitForSelector(`#${tab}`);
        await iframe.click(`#${tab}`);
        await iframe.waitForTimeout(1000);
        // DIV loading image: cphMain_ucBlockTradesBrowser_upThrobber
        await iframe.waitForSelector(
          '#cphMain_ucBlockTradesBrowser_upThrobber',
          { hidden: true },
        );

        if (idx === 0) {
          // Last day calendar
          await iframe.waitForSelector(
            '#ctl00_cphMain_ucBlockTradesBrowser_ucTradeDatePicker_ucTrigger_lnkTrigger',
            { visible: true },
          );
          await iframe.click(
            '#ctl00_cphMain_ucBlockTradesBrowser_ucTradeDatePicker_ucTrigger_lnkTrigger',
          )!; // PANEL DATES
          await iframe.waitForSelector(
            '#ctl00_cphMain_ucBlockTradesBrowser_ucTradeDatePicker_lvGroups_ctrl0_lbTradeDate',
            { visible: true },
          );
          await iframe.click(
            '#ctl00_cphMain_ucBlockTradesBrowser_ucTradeDatePicker_lvGroups_ctrl0_lbTradeDate',
          );
        }

        await iframe.waitForSelector('div.browse-content');
        const divContent = await iframe?.$('div.browse-content');
        const trs = await divContent?.$$('tr');

        for await (const tr of trs!) {
          const tds = await tr.$$('td');
          if (tds.length === 14) {
            const tsTrade = await tds[0].evaluate(el =>
              el.getAttribute('title'),
            );

            const timestampTrade = parse(
              tsTrade!.concat(this.utcOffset),
              'dd/MM/yyyy HH:mm:ssX',
              new Date(),
            );

            const symbol = await tds[7].evaluate(el => el.textContent!.trim());
            const size = await tds[9].evaluate(el => parseInt(el.textContent!));
            const level = await tds[12].evaluate(el =>
              parseFloat(el.textContent!.replace(',', '.')),
            );
            const globexCode = symbol.substr(0, symbol.length - 2);
            const contract = `${symbol.substr(
              symbol.length - 2,
              1,
            )}2${symbol.substr(symbol.length - 1, 1)}`;

            blockTrades.push({
              timestampTrade,
              contract,
              globexCode,
              size,
              level,
            });
          }
        }
      }

      // comment
      await iframe?.waitForSelector(
        '#cphMain_ucBlockTradesBrowser_ucBlockTradesFilter_ucTrigger_lnkTrigger',
      );
      await iframe?.click(
        '#cphMain_ucBlockTradesBrowser_ucBlockTradesFilter_ucTrigger_lnkTrigger',
      ); // PANEL FILTER
      await iframe?.waitForTimeout(2000);
      await page.screenshot({ path: 'blocktrade_filter.png', fullPage: true });
    } catch (e) {
      this.logger.error(
        `BLOCK TRADE ERROR: ${JSON.stringify(e)}`,
      );
    } finally {
      await browser.close();
    }

    const sql = `INSERT INTO "cme-timesnsales" (globexcode, contract, "calendar-date", "trade-timestamp", level, "size", "indicator") 
    VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    for (let i = 0; i < blockTrades.length; i++) {
      await this.queryFactory.runQuery(sql, {
        globexCode: blockTrades[i].globexCode,
        contract: blockTrades[i].contract,
        calendarDate: blockTrades[i].timestampTrade,
        tradeTimestamp: blockTrades[i].timestampTrade,
        level: blockTrades[i].level,
        size: blockTrades[i].size,
        indicator: 'BLOCK TRADE',
      });
    }

    return { count: tradeCount, volume: totalVolume };
  }
}
 */
