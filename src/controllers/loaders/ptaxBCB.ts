/* eslint-disable no-nested-ternary */
/* eslint-disable camelcase */
import { DateTime } from 'luxon';
import axios from 'axios';
import { parse as parseHTML } from 'node-html-parser';
import qs from 'qs';
import { ILoadResult } from '../reportLoader';
import { TCurrencyCode } from '../tcountry';
import ReportLoaderCalendar from '../reportLoaderCalendar';

// schedule: */30 0-10,30-40 10-13,14-15 * * MON-FRI
/* 
  schedule instructions:
  business days: 10:00-10:10, 11:00-11:10, 12:00-12:10, 13:00-13:10
  holidays: 14:30-14:40, 15:30-15:40 
*/

enum TPTAXType {
  INTERMEDIATES = 3,
  FINAL = 1,
}

interface IAsset {
  BCBid: number;
  currencyCode: TCurrencyCode;
  name: string;
  type: TPTAXType;
}

interface IPTAX {
  date: DateTime;
  currencyCode: TCurrencyCode;
  p1_datetime: DateTime | null;
  pbrl_p1_buy: number | null;
  pbrl_p1_sell: number | null;
  pusd_p1_buy: number | null;
  pusd_p1_sell: number | null;
  p2_datetime: DateTime | null;
  pbrl_p2_buy: number | null;
  pbrl_p2_sell: number | null;
  pusd_p2_buy: number | null;
  pusd_p2_sell: number | null;
  p3_datetime: DateTime | null;
  pbrl_p3_buy: number | null;
  pbrl_p3_sell: number | null;
  pusd_p3_buy: number | null;
  pusd_p3_sell: number | null;
  p4_datetime: DateTime | null;
  pbrl_p4_buy: number | null;
  pbrl_p4_sell: number | null;
  pusd_p4_buy: number | null;
  pusd_p4_sell: number | null;
  ptax_datetime: DateTime | null;
  pbrl_ptax_buy: number | null;
  pbrl_ptax_sell: number | null;
  pusd_ptax_buy: number | null;
  pusd_ptax_sell: number | null;
}

class PtaxBCB extends ReportLoaderCalendar {
  async process(params: {
    dateRef: DateTime;
    dateMatch: DateTime;
    lastTaskOfDay: boolean | undefined;
  }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )} - DateMatch: ${params.dateMatch.toFormat('dd/MM/yyyy HH:mm:ssZ')}`,
    );

    return this.getBCBReportAssets(params.dateRef, params.lastTaskOfDay);
  }

  async performQuery(params: { url: string; postData: any }): Promise<any> {
    return axios({
      method: 'post',
      url: params.url,
      data: qs.stringify(params.postData),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  public async getBCBReportAssets(
    dateRef: DateTime,
    lastTaskOfDay: boolean | undefined,
  ): Promise<ILoadResult> {
    const assets = this.getAllAssets();
    const loadResults: ILoadResult[] = [];

    // eslint-disable-next-line no-restricted-syntax
    for await (const asset of assets) {
      if (
        (process.env.BCB_PTAX_CURRENCIES || '')
          .split(',')
          .find(
            currencyCode =>
              asset.currencyCode === currencyCode.trim().toUpperCase(),
          ) ||
        String(process.env.BCB_PTAX_CURRENCIES).trim().toUpperCase() === 'ALL'
      ) {
        await this.sleep(parseInt(process.env.QUERY_INTERVAL || '2'));

        const loadResult: ILoadResult = await this.getBCBReport(
          dateRef,
          asset.currencyCode,
          lastTaskOfDay,
        );
        loadResults.push(loadResult);
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

  public async getBCBReport(
    dateRef: DateTime,
    currencyCode: TCurrencyCode,
    lastTaskOfDay: boolean | undefined,
  ): Promise<ILoadResult> {
    const asset = this.getAsset(currencyCode);

    if (!asset) {
      throw new Error(`CurrencyCode: [${currencyCode}] - Unknown asset`);
    }

    const pbrl_ptax_previews: {
      dateTime: DateTime;
      buy: number | null;
      sell: number | null;
    }[] = [];
    const pusd_ptax_previews: {
      dateTime: DateTime;
      buy: number | null;
      sell: number | null;
    }[] = [];
    let pbrl_ptax_final:
      | {
          dateTime: DateTime;
          buy: number | null;
          sell: number | null;
        }
      | undefined;
    let pusd_ptax_final:
      | {
          dateTime: DateTime;
          buy: number | null;
          sell: number | null;
        }
      | undefined;

    const url =
      'https://ptax.bcb.gov.br/ptax_internet/consultaBoletim.do?method=consultarBoletim';

    if (asset.type === TPTAXType.INTERMEDIATES) {
      const data = {
        RadOpcao: asset.type,
        ChkMoeda: asset.BCBid,
        DATAINI: dateRef.toFormat('dd/MM/yyyy'),
        DATAFIM: '',
      };

      const htmlPTAX = await this.retry({
        url,
        postData: data,
      });

      const root = parseHTML(htmlPTAX.data);
      const divMsgError = root.querySelector('.msgErro');
      if (divMsgError) {
        return { inserted: -1, deleted: 0 };
      }
      const tbody = root.querySelector('tbody');
      let now: DateTime;
      let dateTime: DateTime;
      if (tbody) {
        const rows = tbody.querySelectorAll('tr');
        now = DateTime.now().setZone(this.exchange.timezone);

        for (let i = 0; i < rows.length; i++) {
          const tds = rows[i].querySelectorAll('td');
          if (tds.length < 6) {
            throw new Error(
              `CurrencyCode: [${asset.currencyCode}] - Unknown report layout 1 (td)`,
            );
          }

          dateTime = DateTime.fromFormat(
            `${dateRef.toFormat('dd/MM/yyyy')} ${tds[0].rawText.trim()}`,
            'dd/MM/yyyy HH:mm',
            { zone: this.exchange.timezone },
          );

          if (
            dateTime.startOf('day').toMillis() ===
            now.startOf('day').toMillis() /* &&
            now.hour === dateTime.hour &&
            Math.abs(now.minute - dateTime.minute) < 3 */
          ) {
            dateTime = now;
          } else {
            // Sets partial minute to 10 instead of 0 (BCB site)
            dateTime = dateTime.set({ minute: 10, second: 0, millisecond: 0 });
          }

          if (tds[1].rawText.trim().toUpperCase().includes('FECH. PTAX')) {
            pbrl_ptax_final = {
              dateTime,
              buy: parseFloat(tds[2].rawText.replace(',', '.')),
              sell: parseFloat(tds[3].rawText.replace(',', '.')),
            };

            pusd_ptax_final = {
              dateTime,
              buy: parseFloat(tds[4].rawText.replace(',', '.')),
              sell: parseFloat(tds[5].rawText.replace(',', '.')),
            };
          } else {
            pbrl_ptax_previews.push({
              dateTime,
              buy: parseFloat(tds[2].rawText.replace(',', '.')),
              sell: parseFloat(tds[3].rawText.replace(',', '.')),
            });
            pusd_ptax_previews.push({
              dateTime,
              buy: parseFloat(tds[4].rawText.replace(',', '.')),
              sell: parseFloat(tds[5].rawText.replace(',', '.')),
            });
          }
        }
      }
    } else {
      const data = {
        RadOpcao: asset.type,
        ChkMoeda: asset.BCBid,
        DATAINI: dateRef.minus({ days: 1 }).toFormat('dd/MM/yyyy'),
        DATAFIM: dateRef.toFormat('dd/MM/yyyy'),
      };

      const htmlPTAX = await this.retry({
        url,
        postData: data,
      });

      const root = parseHTML(htmlPTAX.data);
      const divMsgError = root.querySelector('.msgErro');

      if (divMsgError) {
        return { inserted: -1, deleted: 0 };
      }

      const rows = root.querySelectorAll('tr');
      if (rows && rows.length > 2) {
        let foundDate = false;
        for (let i = 2; i < rows.length; i++) {
          const tds = rows[i].querySelectorAll('td');
          if (
            tds &&
            tds.length >= 6 &&
            tds[0].rawText.trim() === dateRef.toFormat('dd/MM/yyyy')
          ) {
            pbrl_ptax_final = {
              dateTime: dateRef,
              buy: parseFloat(tds[2].rawText.replace(',', '.')),
              sell: parseFloat(tds[3].rawText.replace(',', '.')),
            };
            pusd_ptax_final = {
              dateTime: dateRef,
              buy: parseFloat(tds[4].rawText.replace(',', '.')),
              sell: parseFloat(tds[5].rawText.replace(',', '.')),
            };

            foundDate = true;
            break;
          }
        }
        if (!foundDate) {
          this.logger.silly(
            `[${this.processName}] - DateRef: ${dateRef.toFormat(
              'dd/MM/yyyy',
            )} - Assett: ${asset.name} - No data to read`,
          );
          return { inserted: 0, deleted: 0 }; // Allow to check for holidays and to reprocess
        }
      } else {
        throw new Error(
          `CurrencyCode: [${asset.currencyCode}] - Unknown report layout 2 (tr)`,
        );
      }
    }

    let inserted = 0;

    const res: IPTAX = {
      date: dateRef,
      currencyCode,
      p1_datetime: pbrl_ptax_previews[0]
        ? pbrl_ptax_previews[0].dateTime
        : null,
      pbrl_p1_buy: pbrl_ptax_previews[0] ? pbrl_ptax_previews[0].buy : null,
      pbrl_p1_sell: pbrl_ptax_previews[0] ? pbrl_ptax_previews[0].sell : null,
      pusd_p1_buy: pusd_ptax_previews[0] ? pusd_ptax_previews[0].buy : null,
      pusd_p1_sell: pusd_ptax_previews[0] ? pusd_ptax_previews[0].sell : null,

      p2_datetime: pbrl_ptax_previews[1]
        ? pbrl_ptax_previews[1].dateTime
        : null,
      pbrl_p2_buy: pbrl_ptax_previews[1] ? pbrl_ptax_previews[1].buy : null,
      pbrl_p2_sell: pbrl_ptax_previews[1] ? pbrl_ptax_previews[1].sell : null,
      pusd_p2_buy: pusd_ptax_previews[1] ? pusd_ptax_previews[1].buy : null,
      pusd_p2_sell: pusd_ptax_previews[1] ? pusd_ptax_previews[1].sell : null,

      p3_datetime: pbrl_ptax_previews[2]
        ? pbrl_ptax_previews[2].dateTime
        : null,
      pbrl_p3_buy: pbrl_ptax_previews[2] ? pbrl_ptax_previews[2].buy : null,
      pbrl_p3_sell: pbrl_ptax_previews[2] ? pbrl_ptax_previews[2].sell : null,
      pusd_p3_buy: pusd_ptax_previews[2] ? pusd_ptax_previews[2].buy : null,
      pusd_p3_sell: pusd_ptax_previews[2] ? pusd_ptax_previews[2].sell : null,

      p4_datetime: pbrl_ptax_previews[3]
        ? pbrl_ptax_previews[3].dateTime
        : null,
      pbrl_p4_buy: pbrl_ptax_previews[3] ? pbrl_ptax_previews[3].buy : null,
      pbrl_p4_sell: pbrl_ptax_previews[3] ? pbrl_ptax_previews[3].sell : null,
      pusd_p4_buy: pusd_ptax_previews[3] ? pusd_ptax_previews[3].buy : null,
      pusd_p4_sell: pusd_ptax_previews[3] ? pusd_ptax_previews[3].sell : null,

      ptax_datetime: pbrl_ptax_final ? pbrl_ptax_final.dateTime || null : null,
      pbrl_ptax_buy: pbrl_ptax_final ? pbrl_ptax_final.buy || null : null,
      pbrl_ptax_sell: pbrl_ptax_final ? pbrl_ptax_final.sell || null : null,
      pusd_ptax_buy: pusd_ptax_final ? pusd_ptax_final.buy || null : null,
      pusd_ptax_sell: pusd_ptax_final ? pusd_ptax_final.sell || null : null,
    };

    let sql = `SELECT 
    p1_datetime, pbrl_p1_buy, pbrl_p1_sell, pusd_p1_buy, pusd_p1_sell, 
    p2_datetime, pbrl_p2_buy, pbrl_p2_sell, pusd_p2_buy, pusd_p2_sell, 
    p3_datetime, pbrl_p3_buy, pbrl_p3_sell, pusd_p3_buy, pusd_p3_sell, 
    p4_datetime, pbrl_p4_buy, pbrl_p4_sell, pusd_p4_buy, pusd_p4_sell, 
    ptax_datetime, pbrl_ptax_buy, pbrl_ptax_sell, pusd_ptax_buy, pusd_ptax_sell 
    FROM "bcb-ptax" WHERE date=$1 AND "currency-code"=$2`;

    const qSel = await this.queryFactory.runQuery(sql, {
      date: res.date.toJSDate(),
      currencyCode: res.currencyCode,
    });

    if (
      qSel &&
      qSel.length > 0 &&
      Number(qSel[0].pbrl_p1_buy) === Number(res.pbrl_p1_buy) &&
      Number(qSel[0].pbrl_p1_sell) === Number(res.pbrl_p1_sell) &&
      Number(qSel[0].pusd_p1_buy) === Number(res.pusd_p1_buy) &&
      Number(qSel[0].pusd_p1_sell) === Number(res.pusd_p1_sell) &&
      Number(qSel[0].pbrl_p2_buy) === Number(res.pbrl_p2_buy) &&
      Number(qSel[0].pbrl_p2_sell) === Number(res.pbrl_p2_sell) &&
      Number(qSel[0].pusd_p2_buy) === Number(res.pusd_p2_buy) &&
      Number(qSel[0].pusd_p2_sell) === Number(res.pusd_p2_sell) &&
      Number(qSel[0].pbrl_p3_buy) === Number(res.pbrl_p3_buy) &&
      Number(qSel[0].pbrl_p3_sell) === Number(res.pbrl_p3_sell) &&
      Number(qSel[0].pusd_p3_buy) === Number(res.pusd_p3_buy) &&
      Number(qSel[0].pusd_p3_sell) === Number(res.pusd_p3_sell) &&
      Number(qSel[0].pbrl_p4_buy) === Number(res.pbrl_p4_buy) &&
      Number(qSel[0].pbrl_p4_sell) === Number(res.pbrl_p4_sell) &&
      Number(qSel[0].pusd_p4_buy) === Number(res.pusd_p4_buy) &&
      Number(qSel[0].pusd_p4_sell) === Number(res.pusd_p4_sell) &&
      Number(qSel[0].pbrl_ptax_buy) === Number(res.pbrl_ptax_buy) &&
      Number(qSel[0].pbrl_ptax_sell) === Number(res.pbrl_ptax_sell) &&
      Number(qSel[0].pusd_ptax_buy) === Number(res.pusd_ptax_buy) &&
      Number(qSel[0].pusd_ptax_sell) === Number(res.pusd_ptax_sell)
    ) {
      this.logger.silly(
        `[${this.processName}] - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Asset: ${asset.name} - No updated data to read`,
      );
      if (
        lastTaskOfDay &&
        (!res.pbrl_ptax_buy ||
          res.pbrl_ptax_buy <= 0 ||
          !res.pbrl_ptax_sell ||
          res.pbrl_ptax_sell <= 0)
      )
        return { inserted: 0, deleted: 0 }; // allow reprocess even outside schedule time frame

      return { inserted: -1, deleted: 0 };
    }

    sql = `INSERT INTO "bcb-ptax" (date, "currency-code", 
      p1_datetime,
      pbrl_p1_buy, pbrl_p1_sell, 
      pusd_p1_buy, pusd_p1_sell, 
      p2_datetime,
      pbrl_p2_buy, pbrl_p2_sell, 
      pusd_p2_buy, pusd_p2_sell, 
      p3_datetime,
      pbrl_p3_buy, pbrl_p3_sell, 
      pusd_p3_buy, pusd_p3_sell, 
      p4_datetime,
      pbrl_p4_buy, pbrl_p4_sell, 
      pusd_p4_buy, pusd_p4_sell, 
      ptax_datetime,
      pbrl_ptax_buy, pbrl_ptax_sell,
      pusd_ptax_buy, pusd_ptax_sell,
      last_update) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28) 
      ON CONFLICT (date, "currency-code") DO UPDATE SET 
      p1_datetime=$3, 
      pbrl_p1_buy=$4, pbrl_p1_sell=$5, 
      pusd_p1_buy=$6, pusd_p1_sell=$7, 
      p2_datetime=$8,
      pbrl_p2_buy=$9, pbrl_p2_sell=$10, 
      pusd_p2_buy=$11, pusd_p2_sell=$12, 
      p3_datetime=$13,
      pbrl_p3_buy=$14, pbrl_p3_sell=$15, 
      pusd_p3_buy=$16, pusd_p3_sell=$17, 
      p4_datetime=$18,
      pbrl_p4_buy=$19, pbrl_p4_sell=$20, 
      pusd_p4_buy=$21, pusd_p4_sell=$22, 
      ptax_datetime=$23,
      pbrl_ptax_buy=$24, pbrl_ptax_sell=$25,
      pusd_ptax_buy=$26, pusd_ptax_sell=$27,
      last_update=$28`;

    await this.queryFactory.runQuery(sql, {
      date: res.date.toJSDate(),
      currencyCode: res.currencyCode,
      p1_datetime:
        qSel.length > 0 && qSel[0].p1_datetime
          ? qSel[0].p1_datetime
          : res.p1_datetime && res.p1_datetime.isValid
          ? res.p1_datetime.toJSDate()
          : null,
      pbrl_p1_buy: res.pbrl_p1_buy,
      pbrl_p1_sell: res.pbrl_p1_sell,
      pusd_p1_buy: res.pusd_p1_buy,
      pusd_p1_sell: res.pusd_p1_sell,

      p2_datetime:
        qSel.length > 0 && qSel[0].p2_datetime
          ? qSel[0].p2_datetime
          : res.p2_datetime && res.p2_datetime.isValid
          ? res.p2_datetime.toJSDate()
          : null,
      pbrl_p2_buy: res.pbrl_p2_buy,
      pbrl_p2_sell: res.pbrl_p2_sell,
      pusd_p2_buy: res.pusd_p2_buy,
      pusd_p2_sell: res.pusd_p2_sell,

      p3_datetime:
        qSel.length > 0 && qSel[0].p3_datetime
          ? qSel[0].p3_datetime
          : res.p3_datetime && res.p3_datetime.isValid
          ? res.p3_datetime.toJSDate()
          : null,
      pbrl_p3_buy: res.pbrl_p3_buy,
      pbrl_p3_sell: res.pbrl_p3_sell,
      pusd_p3_buy: res.pusd_p3_buy,
      pusd_p3_sell: res.pusd_p3_sell,

      p4_datetime:
        qSel.length > 0 && qSel[0].p4_datetime
          ? qSel[0].p4_datetime
          : res.p4_datetime && res.p4_datetime.isValid
          ? res.p4_datetime.toJSDate()
          : null,
      pbrl_p4_buy: res.pbrl_p4_buy,
      pbrl_p4_sell: res.pbrl_p4_sell,
      pusd_p4_buy: res.pusd_p4_buy,
      pusd_p4_sell: res.pusd_p4_sell,

      ptax_datetime:
        qSel.length > 0 && qSel[0].ptax_datetime
          ? qSel[0].ptax_datetime
          : res.ptax_datetime && res.ptax_datetime.isValid
          ? res.ptax_datetime.toJSDate()
          : null,
      pbrl_ptax_buy: res.pbrl_ptax_buy,
      pbrl_ptax_sell: res.pbrl_ptax_sell,
      pusd_ptax_buy: res.pusd_ptax_buy,
      pusd_ptax_sell: res.pusd_ptax_sell,
      last_update: new Date(),
    });
    inserted++;

    /* if (
      asset.currencyCode === TCurrencyCode.USD &&
      res.date.startOf('day').toMillis() ===
        DateTime.now().startOf('day').toMillis()
    ) {
      this.throwBotEvent('PTAX-USD', { d: dateRef.toJSDate(), q: 2 });
      this.throwBotEvent('PTAX-USD-D0', {
        d: dateRef.toJSDate(),
        pq: 5,
        pm: 1.0,
      });
    } */

    if (
      lastTaskOfDay &&
      (!res.pbrl_ptax_buy ||
        res.pbrl_ptax_buy <= 0 ||
        !res.pbrl_ptax_sell ||
        res.pbrl_ptax_sell <= 0)
    )
      return { inserted: 0, deleted: 0 }; // allow reprocess even outside schedule time frame

    return { inserted, deleted: 0 };
  }

  private getAsset(currencyCode: string): IAsset | undefined {
    const assets = this.getAllAssets();
    const asset = assets.find(a => a.currencyCode === currencyCode);

    return asset || undefined;
  }

  private getAllAssets(): IAsset[] {
    const assets: IAsset[] = [
      {
        BCBid: 61,
        currencyCode: TCurrencyCode.USD,
        name: 'DOLAR DOS EUA',
        type: TPTAXType.INTERMEDIATES,
      },
      {
        BCBid: 222,
        currencyCode: TCurrencyCode.EUR,
        name: 'EURO',
        type: TPTAXType.INTERMEDIATES,
      },
      {
        BCBid: 115,
        currencyCode: TCurrencyCode.GBP,
        name: 'LIBRA ESTERLINA',
        type: TPTAXType.INTERMEDIATES,
      },
      {
        BCBid: 101,
        currencyCode: TCurrencyCode.JPY,
        name: 'IENE',
        type: TPTAXType.INTERMEDIATES,
      },
      {
        BCBid: 48,
        currencyCode: TCurrencyCode.CAD,
        name: 'DOLAR CANADENSE',
        type: TPTAXType.INTERMEDIATES,
      },
      {
        BCBid: 45,
        currencyCode: TCurrencyCode.AUD,
        name: 'DOLAR AUSTRALIANO',
        type: TPTAXType.INTERMEDIATES,
      },
      {
        BCBid: 97,
        currencyCode: TCurrencyCode.CHF,
        name: 'FRANCO SUÍÇO',
        type: TPTAXType.INTERMEDIATES,
      },
      {
        BCBid: 165,
        currencyCode: TCurrencyCode.MXN,
        name: 'PESO MEXICANO',
        type: TPTAXType.FINAL,
      },
      {
        BCBid: 187,
        currencyCode: TCurrencyCode.RUB,
        name: 'RUBLO RUSSO',
        type: TPTAXType.FINAL,
      },
      {
        BCBid: 66,
        currencyCode: TCurrencyCode.NZD,
        name: 'DOLAR NEOZELANDÊS',
        type: TPTAXType.FINAL,
      },
      {
        BCBid: 178,
        currencyCode: TCurrencyCode.CNY,
        name: 'RENMINBI CHINÊS',
        type: TPTAXType.FINAL,
      },
      {
        BCBid: 236,
        currencyCode: TCurrencyCode.XAU,
        name: 'OURO',
        type: TPTAXType.FINAL,
      },
    ];
    /*
    DOL,EUR,GBP,JPY,CAD,AUD,MXN,RUB,NZD,XAU
    1 - Cotação em REAL: preço por grama
    2 - pusd_ptax_buy (Ouro Spot) = US$ por onça. Valores até 26/03/2010 referem-se a PM Fixing.
    3 - pusd_ptax_sell (Paridade) = Grama por US$
    */

    return assets;
  }
}

export default PtaxBCB;
