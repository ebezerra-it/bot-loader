import axios from 'axios';
import https from 'https';
import { parse as parseHTML } from 'node-html-parser';
import { DateTime } from 'luxon';
import qs from 'qs';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { ILoadResult } from '../reportLoader';
import { TCurrencyCode } from '../tcountry';

interface SpotIntradayTime {
  time: DateTime;
  low: number;
  high: number;
  finVol: number;
  qtyTrades: number;
}

class spotExchangeIntradayB3 extends ReportLoaderCalendar {
  async process(params: { dateRef: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat(
        'dd/MM/yyyy HH:mm:ssZ',
      )}`,
    );

    if (params.dateRef.hasSame(DateTime.now(), 'day')) {
      // eslint-disable-next-line no-useless-catch
      try {
        return this.getSpotIntradayReport();
      } catch (err) {
        throw err;
      }
    }

    this.logger.error(
      `${
        this.processName
      } - Divergent ref. date processing request: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )}.`,
    );
    return { inserted: -1, deleted: 0 };
  }

  async performQuery(params: { url: string; postData?: any }): Promise<any> {
    return (
      await axios({
        method: 'get',
        url: params.url,
        data: qs.stringify(params.postData),
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      })
    ).data;
  }

  private async getSpotIntradayReport(): Promise<ILoadResult> {
    // TO DO: Analisar relevância de Tx de câmbio referencial D1 e D2
    // https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/consultas/clearing-de-cambio/indicadores/taxas-de-cambio-referencial/

    const url = `https://www2.bmf.com.br/pages/portal/bmfbovespa/lumis/lum-resumos-ptBR-novo.asp`;
    const html = await this.retry({ url });

    const dateRef = DateTime.now();

    const root = parseHTML(html);
    const tables = root.querySelectorAll('table');

    if (!tables || tables.length !== 2) {
      throw new Error(`Unknown layout - table`);
    }

    let trs = tables[0].querySelectorAll('tr');
    if (!trs || trs.length !== 14) {
      throw new Error(`Unknown layout - tr`);
    }

    let lastTime = 0;

    let tds = trs[1].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 08:00`);
    }
    const time0800: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time0800.high && time0800.low && time0800.finVol && time0800.qtyTrades)
      lastTime = 8;

    tds = trs[2].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 09:00`);
    }
    const time0900: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time0900.high && time0900.low && time0900.finVol && time0900.qtyTrades)
      lastTime = 9;

    tds = trs[3].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 10:00`);
    }
    const time1000: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time1000.high && time1000.low && time1000.finVol && time1000.qtyTrades)
      lastTime = 10;

    tds = trs[4].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 11:00`);
    }
    const time1100: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time1100.high && time1100.low && time1100.finVol && time1100.qtyTrades)
      lastTime = 11;

    tds = trs[5].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 12:00`);
    }
    const time1200: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time1200.high && time1200.low && time1200.finVol && time1200.qtyTrades)
      lastTime = 12;

    tds = trs[6].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 13:00`);
    }
    const time1300: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time1300.high && time1300.low && time1300.finVol && time1300.qtyTrades)
      lastTime = 13;

    tds = trs[7].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 14:00`);
    }
    const time1400: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time1400.high && time1400.low && time1400.finVol && time1400.qtyTrades)
      lastTime = 14;

    tds = trs[8].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 15:00`);
    }
    const time1500: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time1500.high && time1500.low && time1500.finVol && time1500.qtyTrades)
      lastTime = 15;

    tds = trs[9].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 16:00`);
    }
    const time1600: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time1600.high && time1600.low && time1600.finVol && time1600.qtyTrades)
      lastTime = 16;

    tds = trs[10].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 17:00`);
    }
    const time1700: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time1700.high && time1700.low && time1700.finVol && time1700.qtyTrades)
      lastTime = 17;

    tds = trs[11].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 18:00`);
    }
    const time1800: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time1800.high && time1800.low && time1800.finVol && time1800.qtyTrades)
      lastTime = 18;

    tds = trs[12].querySelectorAll('td');
    if (!tds || tds.length !== 5) {
      throw new Error(`Unknown layout - 19:00`);
    }
    const time1900: SpotIntradayTime = {
      time: DateTime.fromFormat(
        `${DateTime.now().toFormat('dd/MM/yyyy')} ${tds[0].rawText}`,
        'dd/MM/yyyy HH:mm',
      ),
      low: parseFloat(tds[1].rawText.replace(/\./g, '').replace(/,/g, '.')),
      high: parseFloat(tds[2].rawText.replace(/\./g, '').replace(/,/g, '.')),
      finVol: parseFloat(tds[3].rawText.replace(/\./g, '').replace(/,/g, '.')),
      qtyTrades: Number(tds[4].rawText.replace(/\./g, '').replace(/,/g, '.')),
    };
    if (time1900.high && time1900.low && time1900.finVol && time1900.qtyTrades)
      lastTime = 19;

    tds = trs[13].querySelectorAll('td');
    if (!tds || tds.length !== 3) {
      throw new Error(`Unknown layout - total`);
    }
    const totalFinVol = Number(
      tds[1].rawText.replace(/\./g, '').replace(/,/g, '.'),
    );
    const totalQtyTrades = Number(
      tds[2].rawText.replace(/\./g, '').replace(/,/g, '.'),
    );

    trs = tables[1].querySelectorAll('tr');
    if (!trs || trs.length !== 2) {
      throw new Error(`Unknown layout - TCAM[tr]`);
    }
    tds = trs[1].querySelectorAll('td');
    if (!tds || tds.length !== 1) {
      throw new Error(`Unknown layout - TCAM[td]`);
    }
    const tcam = Number(tds[0].rawText.replace(/\./g, '').replace(/,/g, '.'));

    if (
      DateTime.now().hour < lastTime || // Previous day report not cleaned yet
      (!time0800.high &&
        !time0800.low &&
        !time0800.finVol &&
        !time0800.qtyTrades &&
        !time0900.high &&
        !time0900.low &&
        !time0900.finVol &&
        !time0900.qtyTrades &&
        !time1000.high &&
        !time1000.low &&
        !time1000.finVol &&
        !time1000.qtyTrades &&
        !time1100.high &&
        !time1100.low &&
        !time1100.finVol &&
        !time1100.qtyTrades &&
        !time1200.high &&
        !time1200.low &&
        !time1200.finVol &&
        !time1200.qtyTrades &&
        !time1300.high &&
        !time1300.low &&
        !time1300.finVol &&
        !time1300.qtyTrades &&
        !time1400.high &&
        !time1400.low &&
        !time1400.finVol &&
        !time1400.qtyTrades &&
        !time1500.high &&
        !time1500.low &&
        !time1500.finVol &&
        !time1500.qtyTrades &&
        !time1600.high &&
        !time1600.low &&
        !time1600.finVol &&
        !time1600.qtyTrades &&
        !time1700.high &&
        !time1700.low &&
        !time1700.finVol &&
        !time1700.qtyTrades &&
        !time1800.high &&
        !time1800.low &&
        !time1800.finVol &&
        !time1800.qtyTrades &&
        !time1900.high &&
        !time1900.low &&
        !time1900.finVol &&
        !time1900.qtyTrades &&
        !totalFinVol &&
        !totalQtyTrades &&
        !tcam)
    ) {
      this.logger.silly(
        `${this.processName} - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Empty report`,
      );
      return { inserted: -1, deleted: 0 };
    }

    const sqlDup = `SELECT * FROM "b3-spotexchange-intraday" WHERE 
    coalesce("time08-high", 0)=$1 AND coalesce("time08-low", 0)=$2 AND coalesce("time08-finVol", 0)=$3 AND coalesce("time08-qtyTrades", 0)=$4 AND  
    coalesce("time09-high", 0)=$5 AND coalesce("time09-low", 0)=$6 AND coalesce("time09-finVol", 0)=$7 AND coalesce("time09-qtyTrades", 0)=$8 AND 
    coalesce("time10-high", 0)=$9 AND coalesce("time10-low", 0)=$10 AND coalesce("time10-finVol", 0)=$11 AND coalesce("time10-qtyTrades", 0)=$12 AND 
    coalesce("time11-high", 0)=$13 AND coalesce("time11-low", 0)=$14 AND coalesce("time11-finVol", 0)=$15 AND coalesce("time11-qtyTrades", 0)=$16 AND 
    coalesce("time12-high", 0)=$17 AND coalesce("time12-low", 0)=$18 AND coalesce("time12-finVol", 0)=$19 AND coalesce("time12-qtyTrades", 0)=$20 AND 
    coalesce("time13-high", 0)=$21 AND coalesce("time13-low", 0)=$22 AND coalesce("time13-finVol", 0)=$23 AND coalesce("time13-qtyTrades", 0)=$24 AND 
    coalesce("time14-high", 0)=$25 AND coalesce("time14-low", 0)=$26 AND coalesce("time14-finVol", 0)=$27 AND coalesce("time14-qtyTrades", 0)=$28 AND 
    coalesce("time15-high", 0)=$29 AND coalesce("time15-low", 0)=$30 AND coalesce("time15-finVol", 0)=$31 AND coalesce("time15-qtyTrades", 0)=$32 AND 
    coalesce("time16-high", 0)=$33 AND coalesce("time16-low", 0)=$34 AND coalesce("time16-finVol", 0)=$35 AND coalesce("time16-qtyTrades", 0)=$36 AND 
    coalesce("time17-high", 0)=$37 AND coalesce("time17-low", 0)=$38 AND coalesce("time17-finVol", 0)=$39 AND coalesce("time17-qtyTrades", 0)=$40 AND 
    coalesce("time18-high", 0)=$41 AND coalesce("time18-low", 0)=$42 AND coalesce("time18-finVol", 0)=$43 AND coalesce("time18-qtyTrades", 0)=$44 AND 
    coalesce("time19-high", 0)=$45 AND coalesce("time19-low", 0)=$46 AND coalesce("time19-finVol", 0)=$47 AND coalesce("time19-qtyTrades", 0)=$48 AND 
    coalesce("total-finVol", 0)=$49 AND coalesce("total-qtyTrades", 0)=$50 AND coalesce(tcam, 0)=$51 AND "currency-code"=$52 AND 
     "date"::DATE<=$53::DATE ORDER BY "timestamp-load" DESC LIMIT 1`;

    const qNewDay = await this.queryFactory.runQuery(sqlDup, {
      time08High: time0800.high || 0,
      time08Low: time0800.low || 0,
      time08FinVol: time0800.finVol || 0,
      time08Qty: time0800.qtyTrades || 0,
      time09High: time0900.high || 0,
      time09Low: time0900.low || 0,
      time09FinVol: time0900.finVol || 0,
      time09Qty: time0900.qtyTrades || 0,
      time10High: time1000.high || 0,
      time10Low: time1000.low || 0,
      time10FinVol: time1000.finVol || 0,
      time10Qty: time1000.qtyTrades || 0,
      time11High: time1100.high || 0,
      time11Low: time1100.low || 0,
      time11FinVol: time1100.finVol || 0,
      time11Qty: time1100.qtyTrades || 0,
      time12High: time1200.high || 0,
      time12Low: time1200.low || 0,
      time12FinVol: time1200.finVol || 0,
      time12Qty: time1200.qtyTrades || 0,
      time13High: time1300.high || 0,
      time13Low: time1300.low || 0,
      time13FinVol: time1300.finVol || 0,
      time13Qty: time1300.qtyTrades || 0,
      time14High: time1400.high || 0,
      time14Low: time1400.low || 0,
      time14FinVol: time1400.finVol || 0,
      time14Qty: time1400.qtyTrades || 0,
      time15High: time1500.high || 0,
      time15Low: time1500.low || 0,
      time15FinVol: time1500.finVol || 0,
      time15Qty: time1500.qtyTrades || 0,
      time16High: time1600.high || 0,
      time16Low: time1600.low || 0,
      time16FinVol: time1600.finVol || 0,
      time16Qty: time1600.qtyTrades || 0,
      time17High: time1700.high || 0,
      time17Low: time1700.low || 0,
      time17FinVol: time1700.finVol || 0,
      time17Qty: time1700.qtyTrades || 0,
      time18High: time1800.high || 0,
      time18Low: time1800.low || 0,
      time18FinVol: time1800.finVol || 0,
      time18Qty: time1800.qtyTrades || 0,
      time19High: time1900.high || 0,
      time19Low: time1900.low || 0,
      time19FinVol: time1900.finVol || 0,
      time19Qty: time1900.qtyTrades || 0,
      totalFinVol: totalFinVol || 0,
      totalQtyTrades: totalQtyTrades || 0,
      tcam: tcam || 0,
      currencyCode: TCurrencyCode.USD,
      date: dateRef.toJSDate(),
    });

    if (qNewDay && qNewDay.length > 0) {
      this.logger.silly(
        `${this.processName} - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - No updated data to read.`,
      );
      return { inserted: -1, deleted: 0 };
    }

    const sql = `INSERT INTO "b3-spotexchange-intraday" ("date", "timestamp-load",
        "time08-high", "time08-low", "time08-finVol", "time08-qtyTrades", 
        "time09-high", "time09-low", "time09-finVol", "time09-qtyTrades", 
        "time10-high", "time10-low", "time10-finVol", "time10-qtyTrades", 
        "time11-high", "time11-low", "time11-finVol", "time11-qtyTrades", 
        "time12-high", "time12-low", "time12-finVol", "time12-qtyTrades", 
        "time13-high", "time13-low", "time13-finVol", "time13-qtyTrades", 
        "time14-high", "time14-low", "time14-finVol", "time14-qtyTrades", 
        "time15-high", "time15-low", "time15-finVol", "time15-qtyTrades", 
        "time16-high", "time16-low", "time16-finVol", "time16-qtyTrades", 
        "time17-high", "time17-low", "time17-finVol", "time17-qtyTrades", 
        "time18-high", "time18-low", "time18-finVol", "time18-qtyTrades", 
        "time19-high", "time19-low", "time19-finVol", "time19-qtyTrades", 
        "total-finVol","total-qtyTrades", tcam, "currency-code") VALUES (
          $1,$2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
          $30, $31, $32, $33, $34, $35, $36, $37, $38, $39,
          $40, $41, $42, $43, $44, $45, $46, $47, $48, $49,
          $50, $51, $52, $53, $54)`;

    await this.queryFactory.runQuery(sql, {
      date: dateRef.toJSDate(),
      timestampLoad: dateRef.toJSDate(),
      time08High: time0800.high || null,
      time08Low: time0800.low || null,
      time08FinVol: time0800.finVol || null,
      time08Qty: time0800.qtyTrades || null,
      time09High: time0900.high || null,
      time09Low: time0900.low || null,
      time09FinVol: time0900.finVol || null,
      time09Qty: time0900.qtyTrades || null,
      time10High: time1000.high || null,
      time10Low: time1000.low || null,
      time10FinVol: time1000.finVol || null,
      time10Qty: time1000.qtyTrades || null,
      time11High: time1100.high || null,
      time11Low: time1100.low || null,
      time11FinVol: time1100.finVol || null,
      time11Qty: time1100.qtyTrades || null,
      time12High: time1200.high || null,
      time12Low: time1200.low || null,
      time12FinVol: time1200.finVol || null,
      time12Qty: time1200.qtyTrades || null,
      time13High: time1300.high || null,
      time13Low: time1300.low || null,
      time13FinVol: time1300.finVol || null,
      time13Qty: time1300.qtyTrades || null,
      time14High: time1400.high || null,
      time14Low: time1400.low || null,
      time14FinVol: time1400.finVol || null,
      time14Qty: time1400.qtyTrades || null,
      time15High: time1500.high || null,
      time15Low: time1500.low || null,
      time15FinVol: time1500.finVol || null,
      time15Qty: time1500.qtyTrades || null,
      time16High: time1600.high || null,
      time16Low: time1600.low || null,
      time16FinVol: time1600.finVol || null,
      time16Qty: time1600.qtyTrades || null,
      time17High: time1700.high || null,
      time17Low: time1700.low || null,
      time17FinVol: time1700.finVol || null,
      time17Qty: time1700.qtyTrades || null,
      time18High: time1800.high || null,
      time18Low: time1800.low || null,
      time18FinVol: time1800.finVol || null,
      time18Qty: time1800.qtyTrades || null,
      time19High: time1900.high || null,
      time19Low: time1900.low || null,
      time19FinVol: time1900.finVol || null,
      time19Qty: time1900.qtyTrades || null,
      totalFinVol: totalFinVol || null,
      totalQtyTrades: totalQtyTrades || null,
      tcam: tcam || null,
      currencyCode: TCurrencyCode.USD,
    });

    /* if (dateRef.hasSame(DateTime.now(), 'day')) {
      this.throwBotEvent('SPOT-USD', {
        d: dateRef.toJSDate(),
      });
    } */

    return { inserted: 1, deleted: 0 };
  }
}

export default spotExchangeIntradayB3;
