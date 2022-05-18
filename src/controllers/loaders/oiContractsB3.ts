/* eslint-disable camelcase */
import axios from 'axios';
import https from 'https';
import { parse as parseHTML } from 'node-html-parser';
import { DateTime } from 'luxon';
import qs from 'qs';
import { ILoadResult } from '../reportLoader';
import ReportLoaderCalendar from '../reportLoaderCalendar';

interface IOIContractsB3 {
  date: DateTime;
  assetCode: string;
  contract: string;
  oiVolume: number;
  priorDayDiff: number;
}

class OIContractsB3 extends ReportLoaderCalendar {
  async process(params: { dateRef: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );

    const res = await this.getB3Report(params.dateRef);
    // Checks if report data is right on the source
    const qHasData = await this.queryFactory.runQuery(
      `SELECT SUM("prior-day-diff") as diff FROM "b3-oi-contracts" WHERE date=$1`,
      { date: params.dateRef.toJSDate() },
    );
    if (qHasData) {
      if (parseInt(qHasData[0].diff) !== 0) {
        return res;
      }
      return { inserted: 0, deleted: res.deleted };
    }
    return { inserted: 0, deleted: 0 };
  }

  async performQuery(params: { url: string; postData: any }): Promise<any> {
    return axios({
      method: 'post',
      url: params.url,
      data: qs.stringify(params.postData),
      responseType: 'arraybuffer',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  }

  public async getB3Report(dt: DateTime): Promise<ILoadResult> {
    const results: IOIContractsB3[] = [];

    const postData = {
      dData1: dt.toFormat('dd/MM/yyyy'),
    };
    const url =
      'https://www2.bmf.com.br/pages/portal/bmfbovespa/lumis/lum-posicoes-em-aberto-futuro-ptBR.asp';
    const html = await this.retry({ url, postData });

    const fixedHtml: string = html.data.toString('latin1');
    const root = parseHTML(fixedHtml);
    const tds = root.querySelectorAll('td');
    let assetCode = '';
    let contract;
    let oiVolume;
    let priorDayDiff;
    for (let i = 0; i < tds.length; i++) {
      if (tds[i].getAttribute('colspan') === '4')
        assetCode = tds[i].rawText.trim().toUpperCase();
      else if (
        tds[i].rawText
          .trim()
          .toUpperCase()
          .match(/[FGHJKMNQUVXZ]\d\d/)
      ) {
        contract = tds[i].rawText.trim().toUpperCase();
        oiVolume = parseFloat(tds[i + 1].rawText.trim().replace(/\./g, ''));
        priorDayDiff = parseFloat(tds[i + 2].rawText.trim().replace(/\./g, ''));

        results.push({
          date: dt,
          assetCode,
          contract,
          oiVolume,
          priorDayDiff,
        });
      }
    }

    return this.toDatabase(results);
  }

  private async toDatabase(results: IOIContractsB3[]): Promise<ILoadResult> {
    const sql = `INSERT INTO "b3-oi-contracts" 
    (date, "asset-code", contract, "oi-volume", "prior-day-diff") 
      VALUES ($1, $2, $3, $4, $5)`;

    let loadCount = 0;
    let deleted = '';
    if (results.length > 0) {
      const sqlDel = `DELETE FROM "b3-oi-contracts" WHERE date=$1`;
      [, deleted] = await this.queryFactory.runQuery(sqlDel, {
        date: results[0].date.startOf('day').toJSDate(),
      });
    }

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      await this.queryFactory.runQuery(sql, {
        date: res.date.startOf('day').toJSDate(),
        assetCode: res.assetCode,
        contract: res.contract,
        oiVolume: res.oiVolume,
        priorDayDiff: res.priorDayDiff,
      });
      loadCount++;
    }
    return { inserted: loadCount, deleted: parseInt(deleted) || 0 };
  }
}

export default OIContractsB3;
