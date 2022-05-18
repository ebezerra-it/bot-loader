/* eslint-disable no-restricted-syntax */
/* import axios from 'axios';
import https from 'https';
import qs from 'qs';
import { format, parse } from 'date-fns';
import { parse as parseHTML } from 'node-html-parser';
import { ILoadResult } from '../reportLoader';
import ReportLoaderCalendar from '../reportLoaderCalendar';

class LiveLoadB3 extends ReportLoaderCalendar {
  private assetsAuthSeriesCodes: { asset: string; authSeriesCode: number }[];

  async process(params: { dateRef: Date }): Promise<ILoadResult> {
    this.logger.info(
      `[${this.processName}] - Process started - DateRef: ${format(
        params.dateRef,
        'dd/MM/yyyy HH:mm:ss',
      )}`,
    );

    const loadResults: ILoadResult[] = [];

    loadResults.push(await this.readLiveTS('FRP0'));

    this.readAssetsAuthSeriesCodes();

    for await (const assets of (
      process.env.B3_TIMESNSALES_ROLL_ASSET_LIST || ''
    ).split(';')) {
      const aAssets = assets.split(',');
      const asset = aAssets[0];
      const roll = aAssets[1];

      const rollSeries = await this.readAuthSeries(
        roll,
        this.getAssetAuthSeriesCode(roll),
      );

      if (rollSeries && rollSeries.length > 0) {
        const assetContract = rollSeries[0].match(
          /([F,G,H,J,K,M,N,Q,U,V,X,Z]\d\d)/,
        );

        await this.readLiveTS(asset.concat(assetContract![0]));

        for await (const rollSerie of rollSeries) {
          const contracts = rollSerie.match(/([F,G,H,J,K,M,N,Q,U,V,X,Z]\d\d)/g);
          loadResults.push(await this.readLiveTS(asset.concat(contracts![0])));
        }
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

  async readLiveTS(asset: string): Promise<ILoadResult> {
    const dateRef: Date = new Date();
    const url = `https://arquivos.b3.com.br/apinegocios/ticker/${asset}/${format(
      dateRef,
      'yyyy-MM-dd',
    )}`;
    const res = await this.retry({ url });

    if (!res || res.name !== asset || !res.values || res.values.length < 1) {
      this.logger.warn(
        `[${this.processName}] - Asset: ${asset} - No data to read`,
      );
      return { inserted: -1, deleted: 0 };
    }

    const qLastTrade = await this.queryFactory.runQuery(
      `SELECT asset, "trade-id" as tradeid, quantity, price, "ts-trade" as tstrade 
      FROM "intraday-trades" WHERE asset=$1 AND "calendar-date"=$2 
      ORDER BY "trade-id" DESC LIMIT 1`,
      {
        asset,
        calendarDate: dateRef,
      },
    );

    if (
      qLastTrade &&
      qLastTrade.length > 0 &&
      Number(res.values[0][3]) <= Number(qLastTrade[0].tradeid)
    ) {
      this.logger.warn(
        `[${this.processName}] - Asset: ${asset} - No updated data to read`,
      );
      return { inserted: -1, deleted: 0 };
    }

    let inserted = 0;
    for await (const trade of res.values) {
      if (
        qLastTrade &&
        qLastTrade.length > 0 &&
        Number(trade[3]) === Number(qLastTrade[0].tradeid)
      )
        break;

      await this.queryFactory.runQuery(
        `INSERT INTO "intraday-trades" 
        ("calendar-date", asset, "trade-id", "ts-trade", quantity, price) 
        VALUES ($1, $2, $3, $4, $5, $6)`,
        {
          calendarDate: dateRef,
          asset,
          tradeId: Number(trade[3]),
          tsTrade: parse(
            `${trade[4]} ${trade[5]}`,
            'yyyy-MM-dd HH:mm:ss',
            new Date(),
          ),
          quantity: Number(trade[1]),
          price: Number(trade[2]),
        },
      );
      inserted++;
    }
    return { inserted, deleted: 0 };
  }

  async performQuery(params: { url: string; postData: any }): Promise<any> {
    return (
      await axios({
        method: 'post',
        url: params.url,
        data: qs.stringify(params.postData),
        responseType: 'arraybuffer',
        headers: {
          'Accept-Encoding': 'gzip, deflate, br',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
          'Cache-Control': 'max-age=0',
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      })
    ).data;
  }

  async readAuthSeries(asset: string, assetCode: number): Promise<string[]> {
    const authSeries: string[] = [];
    const url = `https://www2.bmf.com.br/pages/portal/bmfbovespa/lumis/lum-vencimentos-autorizados-ptBR.asp`;
    const postData = {
      cboMercado: 2,
      cboMercadoria: `${assetCode}-${asset}`, // 32-DOL
    };

    const sHTML = String(await this.retry({ url, postData })).replace(
      // eslint-disable-next-line no-useless-escape
      /(<td>.*)[^<\/td>]\n/gi,
      '$1</td>\n',
    );

    const root = parseHTML(sHTML);
    if (!root) {
      this.logger.error(
        `[${this.processName}] - Can't read AuthSeries element HTML for asset: ${assetCode}-${asset}`,
      );
      return authSeries;
    }

    const table = root.querySelector('#table_1');
    if (!table) {
      this.logger.error(
        `[${this.processName}] - Can't read AuthSeries element TABLE for asset: ${assetCode}-${asset}`,
      );
      return authSeries;
    }

    const tbody = table.querySelector('tbody');
    if (!tbody) {
      this.logger.error(
        `[${this.processName}] - Can't read AuthSeries element TBODY for asset: ${assetCode}-${asset}`,
      );
      return authSeries;
    }

    const tds = tbody.querySelectorAll('td');
    if (!tds || tds.length === 0) {
      this.logger.error(
        `[${this.processName}] - Can't read AuthSeries element TDS for asset: ${assetCode}-${asset}`,
      );
      return authSeries;
    }

    tds.forEach(td => {
      authSeries.push(td.rawText.trim().toLocaleUpperCase());
    });

    return authSeries;
  }

  private readAssetsAuthSeriesCodes() {
    // read from array for better performance
    const sAssetAuthCodes: string[] = [
      '0-AFS',
      '1-ARB',
      '2-ARS',
      '3-AUD',
      '4-AUS',
      '5-B3SAO',
      '6-B3SAR',
      '7-BGI',
      '8-BR1',
      '9-BRI',
      '10-CAD',
      '11-CAN',
      '12-CCM',
      '13-CCROO',
      '14-CCROR',
      '15-CHF',
      '16-CHL',
      '17-CIELO',
      '18-CIELR',
      '19-CLP',
      '20-CMIGP',
      '21-CMIGS',
      '22-CNH',
      '23-CNY',
      '24-COGNO',
      '25-COGNR',
      '26-CR1',
      '27-DAP',
      '28-DAX',
      '29-DCO',
      '30-DDI',
      '31-DI1',
      '32-DOL',
      '33-DR1',
      '34-DX1',
      '35-ES1',
      '36-ESX',
      '37-ET1',
      '38-ETH',
      '39-EUP',
      '40-EUR',
      '41-FRC',
      '42-FRO',
      '43-FRP',
      '44-GBP',
      '45-GBR',
      '46-HSI',
      '47-HYPEO',
      '48-HYPER',
      '49-ICF',
      '50-IMV',
      '51-IND',
      '52-INK',
      '53-IR1',
      '54-ISP',
      '55-JAP',
      '56-JPY',
      '57-JSE',
      '58-MEX',
      '59-MIX',
      '60-MR1',
      '61-MV1',
      '62-MXN',
      '63-NK1',
      '64-NOK',
      '65-NZD',
      '66-NZL',
      '67-OC1',
      '68-OZ1',
      '69-PCARO',
      '70-PCARR',
      '71-PETRP',
      '72-PETRS',
      '73-PSSAO',
      '74-PSSAR',
      '75-RSP',
      '76-RUB',
      '77-SC1',
      '78-SEK',
      '79-SJC',
      '80-SOY',
      '81-SWI',
      '82-T10',
      '83-TRY',
      '84-TUQ',
      '85-USIMA',
      '86-USIML',
      '87-VALEO',
      '88-VALER',
      '89-VIIAO',
      '90-VIIAR',
      '91-WD1',
      '92-WDO',
      '93-WEU',
      '94-WI1',
      '95-WIN',
      '96-WS1',
      '97-WSP',
      '98-ZAR',
    ];

    this.assetsAuthSeriesCodes = sAssetAuthCodes.map(sAssetCodes => {
      const aAssetCode = sAssetCodes.split('-');
      return {
        asset: aAssetCode[1],
        authSeriesCode: Number(aAssetCode[0]),
      };
    });
  }

  private getAssetAuthSeriesCode(asset: string): number {
    const assetCode = this.assetsAuthSeriesCodes.find(assetsCodes => {
      return assetsCodes.asset === asset;
    });

    return assetCode!.authSeriesCode;
  }
}

export default LiveLoadB3;
 */
