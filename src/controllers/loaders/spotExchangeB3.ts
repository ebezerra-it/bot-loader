/* eslint-disable camelcase */
import axios from 'axios';
import https from 'https';
import qs from 'qs';
import { parse as parseHTML } from 'node-html-parser';
import { DateTime } from 'luxon';
import { parseExpression } from 'cron-parser';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { ILoadResult } from '../reportLoader';
import { TCurrencyCode } from '../tcountry';

interface IAverageRate {
  currencyCode: TCurrencyCode;
  hiringDate: DateTime | undefined;
  d0_settleDate: DateTime | undefined;
  d0_tcam: number | undefined;
  d1_settleDate: DateTime | undefined;
  d1_tcam: number | undefined;
  d2_settleDate: DateTime | undefined;
  d2_tcam: number | undefined;
}

interface IEfectiveHiringRate {
  currencyCode: TCurrencyCode;
  hiringDate: DateTime | undefined;
  d0_settleDate: DateTime | undefined;
  d0_low: number | undefined;
  d0_high: number | undefined;
  d0_close: number | undefined;
  d1_settleDate: DateTime | undefined;
  d1_low: number | undefined;
  d1_high: number | undefined;
  d1_close: number | undefined;
  d2_settleDate: DateTime | undefined;
  d2_low: number | undefined;
  d2_high: number | undefined;
  d2_close: number | undefined;
}

interface IHiringVolume {
  currencyCode: TCurrencyCode;
  hiringDate: DateTime | undefined;
  d0_settleDate: DateTime | undefined;
  d0_foreignFinVol: number | undefined;
  d0_brlFinVol: number | undefined;
  d0_qtyTrades: number | undefined;
  d1_settleDate: DateTime | undefined;
  d1_foreignFinVol: number | undefined;
  d1_brlFinVol: number | undefined;
  d1_qtyTrades: number | undefined;
  d2_settleDate: DateTime | undefined;
  d2_foreignFinVol: number | undefined;
  d2_brlFinVol: number | undefined;
  d2_qtyTrades: number | undefined;
  total_foreignFinVol: number | undefined;
  total_brlFinVol: number | undefined;
  total_qtyTrades: number | undefined;
}

interface ISettlementsFinTransactions {
  currencyCode: TCurrencyCode;
  d0_settleDate: DateTime | undefined;
  d0_foreignFinVol: number | undefined;
  d0_brlFinVol: number | undefined;
  d1_settleDate: DateTime | undefined;
  d1_foreignFinVol: number | undefined;
  d1_brlFinVol: number | undefined;
  d2_settleDate: DateTime | undefined;
  d2_foreignFinVol: number | undefined;
  d2_brlFinVol: number | undefined;
}

interface IOpeningParameters {
  currencyCode: TCurrencyCode;
  hiringDate: DateTime | undefined;
  d0_settleDate: DateTime | undefined;
  d0_stressRisk: number | undefined;
  d0_openingRate: number | undefined;
  d1_settleDate: DateTime | undefined;
  d1_stressRisk: number | undefined;
  d1_openingRate: number | undefined;
  d2_settleDate: DateTime | undefined;
  d2_stressRisk: number | undefined;
  d2_openingRate: number | undefined;
}

class spotExchangeB3 extends ReportLoaderCalendar {
  async process(params: { dateRef: DateTime }): Promise<ILoadResult> {
    const results: ILoadResult[] = [];
    const today = DateTime.now();

    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat(
        'dd/MM/yyyy HH:mm:ssZ',
      )}`,
    );

    results.push(await this.getSpotExchangeReport(params.dateRef));

    if (
      !(await this.isHoliday(params.dateRef)) &&
      params.dateRef.hasSame(today, 'day')
    ) {
      const { d1, d2 } = await this.getD1D2Schedule(params.dateRef);
      results.push(await this.getSpotExchangeReport(d1));
      results.push(await this.getSpotExchangeReport(d2));
    }

    const res =
      results.length > 0
        ? results.reduce((total, result) => {
            return {
              inserted: total.inserted + result.inserted,
              deleted: total.deleted + result.deleted,
            };
          })
        : { inserted: 0, deleted: 0 };
    if (res.inserted === 0) return { inserted: -5, deleted: 0 };
    return res;
  }

  async performQuery(params: { dateRef: DateTime }): Promise<any> {
    // Interessante:
    // https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/consultas/clearing-de-cambio/indicadores/taxas-de-cambio-praticadas/
    return (
      await axios({
        method: 'post',
        url: 'https://www2.bmf.com.br/pages/portal/bmfbovespa/lumis/lum-retroativo-por-dia-ptBR.asp',
        data: qs.stringify({ dData1: params.dateRef.toFormat('dd/MM/yyyy') }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      })
    ).data;
  }

  private async getSpotExchangeReport(dateRef: DateTime): Promise<ILoadResult> {
    const html = await this.retry({ dateRef });
    const timestampLoad = DateTime.now();

    const regexHtml = html.match(/<table>.*<\/table>/is);

    if (!regexHtml || regexHtml.length === 0) {
      throw new Error(`Unknown layout - RegEx`);
    }
    const fixedHtml = regexHtml[0].replace(/<\/?tbody>/gim, '');

    const root = parseHTML(fixedHtml);

    const tables = root.querySelectorAll('table');

    if (!tables || tables.length !== 5) {
      throw new Error(`Unknown layout - ROOT[tables]`);
    }

    let tds_d0;
    let tds_d1;
    let tds_d2;
    let tds_total;
    let empty = false;

    let trs = tables[0].querySelectorAll('tr');
    if (!trs || trs.length < 2 || trs.length > 4) {
      throw new Error(`Unknown layout - Taxa Média[tr]`);
    }

    let avgRate: IAverageRate | undefined;
    if (trs.length > 1) {
      tds_d0 = trs[1].querySelectorAll('td');
      if (!tds_d0 || tds_d0.length !== 4) {
        if (tds_d0.length === 1) empty = true;
        else throw new Error(`Unknown layout - Taxa Média[td_d0]`);
      }

      if (trs.length > 2) {
        tds_d1 = trs[2].querySelectorAll('td');
        if (!tds_d1 || tds_d1.length !== 4) {
          throw new Error(`Unknown layout - Taxa Média[td_d1]`);
        }
      }

      if (trs.length > 3) {
        tds_d2 = trs[3].querySelectorAll('td');
        if (!tds_d2 || tds_d2.length !== 4) {
          throw new Error(`Unknown layout - Taxa Média[td_d2]`);
        }
      }

      if (!empty) {
        avgRate = {
          currencyCode: TCurrencyCode.USD,
          hiringDate: DateTime.fromFormat(tds_d0[1].rawText, 'dd/MM/yyyy'),
          d0_settleDate: DateTime.fromFormat(tds_d0[2].rawText, 'dd/MM/yyyy'),
          d0_tcam: parseFloat(
            tds_d0[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
          ),
          d1_settleDate: tds_d1
            ? DateTime.fromFormat(tds_d1[2].rawText, 'dd/MM/yyyy')
            : undefined,
          d1_tcam: tds_d1
            ? parseFloat(
                tds_d1[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d2_settleDate: tds_d2
            ? DateTime.fromFormat(tds_d2[2].rawText, 'dd/MM/yyyy')
            : undefined,
          d2_tcam: tds_d2
            ? parseFloat(
                tds_d2[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
        };
      }
    }

    trs = tables[1].querySelectorAll('tr');
    if (!trs || trs.length < 2 || trs.length > 4) {
      throw new Error(`Unknown layout - Effective Hiring Rate[tr]`);
    }
    let hiringRate: IEfectiveHiringRate | undefined;

    if (trs.length > 1) {
      empty = false;
      tds_d0 = undefined;
      tds_d1 = undefined;
      tds_d2 = undefined;
      tds_total = undefined;

      tds_d0 = trs[1].querySelectorAll('td');
      if (!tds_d0 || tds_d0.length !== 6) {
        if (tds_d0.length === 1) empty = true;
        else throw new Error(`Unknown layout - Effective Hiring Rate[td_d0]`);
      }

      if (trs.length > 2) {
        tds_d1 = trs[2].querySelectorAll('td');
        if (!tds_d1 || tds_d1.length !== 6) {
          throw new Error(`Unknown layout - Effective Hiring Rate[td_d0]`);
        }
      }

      if (trs.length > 3) {
        tds_d2 = trs[3].querySelectorAll('td');
        if (!tds_d2 || tds_d2.length !== 6) {
          throw new Error(`Unknown layout - Effective Hiring Rate[td_d0]`);
        }
      }

      if (!empty) {
        hiringRate = {
          currencyCode: TCurrencyCode.USD,
          hiringDate: DateTime.fromFormat(tds_d0[1].rawText, 'dd/MM/yyyy'),
          d0_settleDate: DateTime.fromFormat(tds_d0[2].rawText, 'dd/MM/yyyy'),
          d0_low: parseFloat(
            tds_d0[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
          ),
          d0_high: parseFloat(
            tds_d0[4].rawText.replace(/\./g, '').replace(/,/g, '.'),
          ),
          d0_close: parseFloat(
            tds_d0[5].rawText.replace(/\./g, '').replace(/,/g, '.'),
          ),
          d1_settleDate: tds_d1
            ? DateTime.fromFormat(tds_d1[2].rawText, 'dd/MM/yyyy')
            : undefined,
          d1_low: tds_d1
            ? parseFloat(
                tds_d1[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d1_high: tds_d1
            ? parseFloat(
                tds_d1[4].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d1_close: tds_d1
            ? parseFloat(
                tds_d1[5].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d2_settleDate: tds_d2
            ? DateTime.fromFormat(tds_d2[2].rawText, 'dd/MM/yyyy')
            : undefined,
          d2_low: tds_d2
            ? parseFloat(
                tds_d2[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d2_high: tds_d2
            ? parseFloat(
                tds_d2[4].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d2_close: tds_d2
            ? parseFloat(
                tds_d2[5].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
        };
      }
    }

    trs = tables[2].querySelectorAll('tr');
    if (!trs || trs.length < 2 || trs.length > 5) {
      throw new Error(`Unknown layout - Hiring Volume[tr]`);
    }

    let hiringVolume: IHiringVolume | undefined;

    if (trs.length > 1) {
      if (trs.length > 2) {
        empty = false;
        tds_d0 = undefined;
        tds_d1 = undefined;
        tds_d2 = undefined;
        tds_total = undefined;
        tds_d0 = trs[1].querySelectorAll('td');
        if (!tds_d0 || tds_d0.length !== 6) {
          if (tds_d0.length === 1) empty = true;
          else throw new Error(`Unknown layout - Hiring Volume[td_d0]`);
        }

        if (trs.length === 3) {
          tds_total = trs[2].querySelectorAll('td');
          if (!tds_total || tds_total.length !== 4) {
            throw new Error(`Unknown layout - Hiring Volume[td_total]`);
          }
        }
      }

      if (trs.length > 3) {
        tds_d1 = trs[2].querySelectorAll('td');
        if (!tds_d1 || tds_d1.length !== 6) {
          throw new Error(`Unknown layout - Hiring Volume[td_d1]`);
        }

        if (trs.length === 4) {
          tds_total = trs[3].querySelectorAll('td');
          if (!tds_total || tds_total.length !== 4) {
            throw new Error(`Unknown layout - Hiring Volume[td_total]`);
          }
        }
      }

      if (trs.length > 4) {
        tds_d2 = trs[3].querySelectorAll('td');
        if (!tds_d2 || tds_d2.length !== 6) {
          throw new Error(`Unknown layout - Hiring Volume[td_d2]`);
        }

        if (trs.length === 5) {
          tds_total = trs[4].querySelectorAll('td');
          if (!tds_total || tds_total.length !== 4) {
            throw new Error(`Unknown layout - Hiring Volume[td_total]`);
          }
        }
      }

      if (!empty) {
        hiringVolume = {
          currencyCode: TCurrencyCode.USD,
          hiringDate: tds_d0
            ? DateTime.fromFormat(tds_d0[1].rawText, 'dd/MM/yyyy')
            : undefined,
          d0_settleDate: tds_d0
            ? DateTime.fromFormat(tds_d0[2].rawText, 'dd/MM/yyyy')
            : undefined,
          d0_foreignFinVol: tds_d0
            ? parseFloat(
                tds_d0[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d0_brlFinVol: tds_d0
            ? parseFloat(
                tds_d0[4].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d0_qtyTrades: tds_d0
            ? parseInt(tds_d0[5].rawText.replace(/\./g, '').replace(/,/g, '.'))
            : undefined,
          d1_settleDate: tds_d1
            ? DateTime.fromFormat(tds_d1[2].rawText, 'dd/MM/yyyy')
            : undefined,
          d1_foreignFinVol: tds_d1
            ? parseFloat(
                tds_d1[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d1_brlFinVol: tds_d1
            ? parseFloat(
                tds_d1[4].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d1_qtyTrades: tds_d1
            ? parseInt(tds_d1[5].rawText.replace(/\./g, '').replace(/,/g, '.'))
            : undefined,
          d2_settleDate: tds_d2
            ? DateTime.fromFormat(tds_d2[2].rawText, 'dd/MM/yyyy')
            : undefined,
          d2_foreignFinVol: tds_d2
            ? parseFloat(
                tds_d2[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d2_brlFinVol: tds_d2
            ? parseFloat(
                tds_d2[4].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d2_qtyTrades: tds_d2
            ? parseInt(tds_d2[5].rawText.replace(/\./g, '').replace(/,/g, '.'))
            : undefined,
          total_foreignFinVol: tds_total
            ? parseFloat(
                tds_total[1].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          total_brlFinVol: tds_total
            ? parseFloat(
                tds_total[2].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          total_qtyTrades: tds_total
            ? parseInt(
                tds_total[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
        };
      }
    }

    trs = tables[3].querySelectorAll('tr');
    if (!trs || trs.length < 2 || trs.length > 4) {
      throw new Error(`Unknown layout - SettleFinTransactions[tr]`);
    }

    let settleTrans: ISettlementsFinTransactions | undefined;

    if (trs.length > 1) {
      empty = false;
      tds_d0 = undefined;
      tds_d1 = undefined;
      tds_d2 = undefined;
      tds_total = undefined;
      tds_d0 = trs[1].querySelectorAll('td');
      if (!tds_d0 || tds_d0.length !== 4) {
        if (tds_d0.length === 1) empty = true;
        else throw new Error(`Unknown layout - SettleFinTransactions[td_d0]`);
      }
      if (trs.length > 2) {
        tds_d1 = trs[2].querySelectorAll('td');
        if (!tds_d1 || tds_d1.length !== 4) {
          throw new Error(`Unknown layout - SettleFinTransactions[td_d1]`);
        }
      }
      if (trs.length > 3) {
        tds_d2 = trs[3].querySelectorAll('td');
        if (!tds_d2 || tds_d2.length !== 4) {
          throw new Error(`Unknown layout - SettleFinTransactions[td_d2]`);
        }
      }

      if (!empty) {
        settleTrans = {
          currencyCode: TCurrencyCode.USD,
          d0_settleDate: tds_d0
            ? DateTime.fromFormat(tds_d0[1].rawText, 'dd/MM/yyyy')
            : undefined,
          d0_foreignFinVol: tds_d0
            ? Number(tds_d0[2].rawText.replace(/\./g, '').replace(/,/g, '.'))
            : undefined,
          d0_brlFinVol: tds_d0
            ? Number(tds_d0[3].rawText.replace(/\./g, '').replace(/,/g, '.'))
            : undefined,
          d1_settleDate: tds_d1
            ? DateTime.fromFormat(tds_d1[1].rawText, 'dd/MM/yyyy')
            : undefined,
          d1_foreignFinVol: tds_d1
            ? Number(tds_d1[2].rawText.replace(/\./g, '').replace(/,/g, '.'))
            : undefined,
          d1_brlFinVol: tds_d1
            ? Number(tds_d1[3].rawText.replace(/\./g, '').replace(/,/g, '.'))
            : undefined,
          d2_settleDate: tds_d2
            ? DateTime.fromFormat(tds_d2[1].rawText, 'dd/MM/yyyy')
            : undefined,
          d2_foreignFinVol: tds_d2
            ? Number(tds_d2[2].rawText.replace(/\./g, '').replace(/,/g, '.'))
            : undefined,
          d2_brlFinVol: tds_d2
            ? Number(tds_d2[3].rawText.replace(/\./g, '').replace(/,/g, '.'))
            : undefined,
        };
      }
    }

    // Tratar tabela parcialmente preenchida
    trs = tables[4].querySelectorAll('tr');
    if (!trs || trs.length < 2 || trs.length > 4) {
      throw new Error(`Unknown layout - OpenParams[tr]`);
    }
    let openParams: IOpeningParameters | undefined;

    if (trs.length > 1) {
      empty = false;
      tds_d0 = undefined;
      tds_d1 = undefined;
      tds_d2 = undefined;
      tds_total = undefined;
      tds_d0 = trs[1].querySelectorAll('td');
      if (!tds_d0 || tds_d0.length !== 4) {
        if (tds_d0.length === 1) empty = true;
        else throw new Error(`Unknown layout - OpenParams[td_d0]`);
      }

      if (trs.length > 2) {
        tds_d1 = trs[2].querySelectorAll('td');
        if (!tds_d0 || tds_d0.length !== 4) {
          throw new Error(`Unknown layout - OpenParams[td_d1]`);
        }
      }

      if (trs.length > 3) {
        tds_d2 = trs[3].querySelectorAll('td');
        if (!tds_d0 || tds_d0.length !== 4) {
          throw new Error(`Unknown layout - OpenParams[td_d2]`);
        }
      }

      if (!empty) {
        openParams = {
          currencyCode: TCurrencyCode.USD,
          hiringDate: tds_d0
            ? DateTime.fromFormat(tds_d0[0].rawText, 'dd/MM/yyyy')
            : undefined,
          d0_settleDate: tds_d0
            ? DateTime.fromFormat(tds_d0[1].rawText, 'dd/MM/yyyy')
            : undefined,
          d0_stressRisk: tds_d0
            ? parseFloat(
                tds_d0[2].rawText
                  .replace(/\./g, '')
                  .replace(/,/g, '.')
                  .replace(/%/g, ''),
              )
            : undefined,
          d0_openingRate: tds_d0
            ? parseFloat(
                tds_d0[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d1_settleDate: tds_d1
            ? DateTime.fromFormat(tds_d1[1].rawText, 'dd/MM/yyyy')
            : undefined,
          d1_stressRisk: tds_d1
            ? parseFloat(
                tds_d1[2].rawText
                  .replace(/\./g, '')
                  .replace(/,/g, '.')
                  .replace(/%/g, ''),
              )
            : undefined,
          d1_openingRate: tds_d1
            ? parseFloat(
                tds_d1[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
          d2_settleDate: tds_d2
            ? DateTime.fromFormat(tds_d2[1].rawText, 'dd/MM/yyyy')
            : undefined,
          d2_stressRisk: tds_d2
            ? parseFloat(
                tds_d2[2].rawText
                  .replace(/\./g, '')
                  .replace(/,/g, '.')
                  .replace(/%/g, ''),
              )
            : undefined,
          d2_openingRate: tds_d2
            ? parseFloat(
                tds_d2[3].rawText.replace(/\./g, '').replace(/,/g, '.'),
              )
            : undefined,
        };
      }
    }

    if (
      !avgRate &&
      !hiringRate &&
      !hiringVolume &&
      !settleTrans &&
      !openParams
    ) {
      this.logger.silly(
        `[${this.processName}] - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Empty report`,
      );
      return { inserted: -1, deleted: 0 };
    }

    const sqlDup = `SELECT * FROM "b3-spotexchange" WHERE "currency-code"=$1 AND 
    coalesce("avgrate-hiringdate", '1900-01-01')=$2::date AND 
    coalesce("avgrate-d0-settledate", '1900-01-01')=$3::date AND coalesce("avgrate-d0-tcam", 0)=$4 AND 
    coalesce("avgrate-d1-settledate", '1900-01-01')=$5::date AND coalesce("avgrate-d1-tcam", 0)=$6 AND 
    coalesce("avgrate-d2-settledate", '1900-01-01')=$7::date AND coalesce("avgrate-d2-tcam", 0)=$8 AND 
    coalesce("hiringrate-hiringdate", '1900-01-01')=$9::date AND 
    coalesce("hiringrate-d0-settledate", '1900-01-01')=$10::date AND coalesce("hiringrate-d0-low", 0)=$11 AND coalesce("hiringrate-d0-high", 0)=$12 AND coalesce("hiringrate-d0-close", 0)=$13 AND 
    coalesce("hiringrate-d1-settledate", '1900-01-01')=$14::date AND coalesce("hiringrate-d1-low", 0)=$15 AND coalesce("hiringrate-d1-high", 0)=$16 AND coalesce("hiringrate-d1-close", 0)=$17 AND 
    coalesce("hiringrate-d2-settledate", '1900-01-01')=$18::date AND coalesce("hiringrate-d2-low", 0)=$19 AND coalesce("hiringrate-d2-high", 0)=$20 AND coalesce("hiringrate-d2-close", 0)=$21 AND 
    coalesce("hiringvol-hiringdate", '1900-01-01')=$22::date AND 
    coalesce("hiringvol-d0-settledate", '1900-01-01')=$23::date AND coalesce("hiringvol-d0-foreignFinVol", 0)=$24 AND coalesce("hiringvol-d0-brlFinVol", 0)=$25 AND coalesce("hiringvol-d0-qtyTrades", 0)=$26 AND 
    coalesce("hiringvol-d1-settledate", '1900-01-01')=$27::date AND coalesce("hiringvol-d1-foreignFinVol", 0)=$28 AND coalesce("hiringvol-d1-brlFinVol", 0)=$29 AND coalesce("hiringvol-d1-qtyTrades", 0)=$30 AND 
    coalesce("hiringvol-d2-settledate", '1900-01-01')=$31::date AND coalesce("hiringvol-d2-foreignFinVol", 0)=$32 AND coalesce("hiringvol-d2-brlFinVol", 0)=$33 AND coalesce("hiringvol-d2-qtyTrades", 0)=$34 AND 
    coalesce("hiringvol-total-foreignFinVol", 0)=$35 AND coalesce("hiringvol-total-brlFinVol", 0)=$36 AND coalesce("hiringvol-total-qtyTrades", 0)=$37 AND 
    coalesce("settletrans-d0-settledate", '1900-01-01')=$38::date AND coalesce("settletrans-d0-foreignFinVol", 0)=$39 AND coalesce("settletrans-d0-brlFinVol", 0)=$40 AND
    coalesce("settletrans-d1-settledate", '1900-01-01')=$41::date AND coalesce("settletrans-d1-foreignFinVol", 0)=$42 AND coalesce("settletrans-d1-brlFinVol", 0)=$43 AND
    coalesce("settletrans-d2-settledate", '1900-01-01')=$44::date AND coalesce("settletrans-d2-foreignFinVol", 0)=$45 AND coalesce("settletrans-d2-brlFinVol", 0)=$46 AND
    coalesce("openparams-hiringdate", '1900-01-01')=$47::date AND 
    coalesce("openparams-d0-settledate", '1900-01-01')=$48::date AND coalesce("openparams-d0-stressrisk", 0)=$49 AND coalesce("openparams-d0-openrate", 0)=$50 AND 
    coalesce("openparams-d1-settledate", '1900-01-01')=$51::date AND coalesce("openparams-d1-stressrisk", 0)=$52 AND coalesce("openparams-d1-openrate", 0)=$53 AND 
    coalesce("openparams-d2-settledate", '1900-01-01')=$54::date AND coalesce("openparams-d2-stressrisk", 0)=$55 AND coalesce("openparams-d2-openrate", 0)=$56 AND 
    date::DATE<=$57::DATE ORDER BY date DESC, "timestamp-load" DESC LIMIT 1`;

    const qNewDay = await this.queryFactory.runQuery(sqlDup, {
      currencyCode: TCurrencyCode.USD,
      avgrateHiringDate:
        avgRate && avgRate.hiringDate?.toJSDate()
          ? avgRate.hiringDate?.toJSDate()
          : '1900-01-01',
      avgrateD0SettleDate:
        avgRate && avgRate.d0_settleDate?.toJSDate()
          ? avgRate.d0_settleDate?.toJSDate()
          : '1900-01-01',
      avgrateD0Tcam: avgRate && avgRate.d0_tcam ? avgRate.d0_tcam : 0,
      avgrateD1SettleDate:
        avgRate && avgRate.d1_settleDate?.toJSDate()
          ? avgRate.d1_settleDate?.toJSDate()
          : '1900-01-01',
      avgrateD1Tcam: avgRate && avgRate.d1_tcam ? avgRate.d1_tcam : 0,
      avgrateD2SettleDate:
        avgRate && avgRate.d2_settleDate?.toJSDate()
          ? avgRate.d2_settleDate?.toJSDate()
          : '1900-01-01',
      avgrateD2Tcam: avgRate && avgRate.d2_tcam ? avgRate.d2_tcam : 0,

      hiringRateHiringDate:
        hiringRate && hiringRate.hiringDate?.toJSDate()
          ? hiringRate.hiringDate?.toJSDate()
          : '1900-01-01',
      hiringRateD0SettleDate:
        hiringRate && hiringRate.d0_settleDate?.toJSDate()
          ? hiringRate.d0_settleDate?.toJSDate()
          : '1900-01-01',
      hiringRateD0Low: hiringRate && hiringRate.d0_low ? hiringRate.d0_low : 0,
      hiringRateD0High:
        hiringRate && hiringRate.d0_high ? hiringRate.d0_high : 0,
      hiringRateD0Close:
        hiringRate && hiringRate.d0_close ? hiringRate.d0_close : 0,
      hiringRateD1SettleDate:
        hiringRate && hiringRate.d1_settleDate?.toJSDate()
          ? hiringRate.d1_settleDate?.toJSDate()
          : '1900-01-01',
      hiringRateD1Low: hiringRate && hiringRate.d1_low ? hiringRate.d1_low : 0,
      hiringRateD1High:
        hiringRate && hiringRate.d1_high ? hiringRate.d1_high : 0,
      hiringRateD1Close:
        hiringRate && hiringRate.d1_close ? hiringRate.d1_close : 0,
      hiringRateD2SettleDate:
        hiringRate && hiringRate.d2_settleDate?.toJSDate()
          ? hiringRate.d2_settleDate?.toJSDate()
          : '1900-01-01',
      hiringRateD2Low: hiringRate && hiringRate.d2_low ? hiringRate.d2_low : 0,
      hiringRateD2High:
        hiringRate && hiringRate.d2_high ? hiringRate.d2_high : 0,
      hiringRateD2Close:
        hiringRate && hiringRate.d2_close ? hiringRate.d2_close : 0,

      hiringVolHiringDate:
        hiringVolume && hiringVolume.hiringDate?.toJSDate()
          ? hiringVolume.hiringDate?.toJSDate()
          : '1900-01-01',
      hiringVolD0SettleDate:
        hiringVolume && hiringVolume.d0_settleDate?.toJSDate()
          ? hiringVolume.d0_settleDate?.toJSDate()
          : '1900-01-01',
      hiringVolD0ForeignFinVol:
        hiringVolume && hiringVolume.d0_foreignFinVol
          ? hiringVolume.d0_foreignFinVol
          : 0,
      hiringVolD0BrlFinVol:
        hiringVolume && hiringVolume.d0_brlFinVol
          ? hiringVolume.d0_brlFinVol
          : 0,
      hiringVolD0QtyTrades:
        hiringVolume && hiringVolume.d0_qtyTrades
          ? hiringVolume.d0_qtyTrades
          : 0,
      hiringVolD1SettleDate:
        hiringVolume && hiringVolume.d1_settleDate?.toJSDate()
          ? hiringVolume.d1_settleDate?.toJSDate()
          : '1900-01-01',
      hiringVolD1ForeignFinVol:
        hiringVolume && hiringVolume.d1_foreignFinVol
          ? hiringVolume.d1_foreignFinVol
          : 0,
      hiringVolD1BrlFinVol:
        hiringVolume && hiringVolume.d1_brlFinVol
          ? hiringVolume.d1_brlFinVol
          : 0,
      hiringVolD1QtyTrades:
        hiringVolume && hiringVolume.d1_qtyTrades
          ? hiringVolume.d1_qtyTrades
          : 0,
      hiringVolD2SettleDate:
        hiringVolume && hiringVolume.d2_settleDate?.toJSDate()
          ? hiringVolume.d2_settleDate?.toJSDate()
          : '1900-01-01',
      hiringVolD2ForeignFinVol:
        hiringVolume && hiringVolume.d2_foreignFinVol
          ? hiringVolume.d2_foreignFinVol
          : 0,
      hiringVolD2BrlFinVol:
        hiringVolume && hiringVolume.d2_brlFinVol
          ? hiringVolume.d2_brlFinVol
          : 0,
      hiringVolD2QtyTrades:
        hiringVolume && hiringVolume.d2_qtyTrades
          ? hiringVolume.d2_qtyTrades
          : 0,
      hiringVolTotForeignFinVol:
        hiringVolume && hiringVolume.total_foreignFinVol
          ? hiringVolume.total_foreignFinVol
          : 0,
      hiringVolTotBrlFinVol:
        hiringVolume && hiringVolume.total_brlFinVol
          ? hiringVolume.total_brlFinVol
          : 0,
      hiringVolTotQtyTrades:
        hiringVolume && hiringVolume.total_qtyTrades
          ? hiringVolume.total_qtyTrades
          : 0,

      settleTransD0SettleDate:
        settleTrans && settleTrans.d0_settleDate?.toJSDate()
          ? settleTrans.d0_settleDate?.toJSDate()
          : '1900-01-01',
      settleTransD0ForeignFinVol:
        settleTrans && settleTrans.d0_foreignFinVol
          ? settleTrans.d0_foreignFinVol
          : 0,
      settleTransD0BrlFinVol:
        settleTrans && settleTrans.d0_brlFinVol ? settleTrans.d0_brlFinVol : 0,
      settleTransD1SettleDate:
        settleTrans && settleTrans.d1_settleDate?.toJSDate()
          ? settleTrans.d1_settleDate?.toJSDate()
          : '1900-01-01',
      settleTransD1ForeignFinVol:
        settleTrans && settleTrans.d1_foreignFinVol
          ? settleTrans.d1_foreignFinVol
          : 0,
      settleTransD1BrlFinVol:
        settleTrans && settleTrans.d1_brlFinVol ? settleTrans.d1_brlFinVol : 0,
      settleTransD2SettleDate:
        settleTrans && settleTrans.d2_settleDate?.toJSDate()
          ? settleTrans.d2_settleDate?.toJSDate()
          : '1900-01-01',
      settleTransD2ForeignFinVol:
        settleTrans && settleTrans.d2_foreignFinVol
          ? settleTrans.d2_foreignFinVol
          : 0,
      settleTransD2BrlFinVol:
        settleTrans && settleTrans.d2_brlFinVol ? settleTrans.d2_brlFinVol : 0,

      openParamsHiringDate:
        openParams && openParams.hiringDate?.toJSDate()
          ? openParams.hiringDate?.toJSDate()
          : '1900-01-01',
      openParamsD0SettleDate:
        openParams && openParams.d0_settleDate?.toJSDate()
          ? openParams.d0_settleDate?.toJSDate()
          : '1900-01-01',
      openParamsD0StressRisk:
        openParams && openParams.d0_stressRisk ? openParams.d0_stressRisk : 0,
      openParamsD0OpenRate:
        openParams && openParams.d0_openingRate ? openParams.d0_openingRate : 0,
      openParamsD1SettleDate:
        openParams && openParams.d1_settleDate?.toJSDate()
          ? openParams.d1_settleDate?.toJSDate()
          : '1900-01-01',
      openParamsD1StressRisk:
        openParams && openParams.d1_stressRisk ? openParams.d1_stressRisk : 0,
      openParamsD1OpenRate:
        openParams && openParams.d1_openingRate ? openParams.d1_openingRate : 0,
      openParamsD2SettleDate:
        openParams && openParams.d2_settleDate?.toJSDate()
          ? openParams.d2_settleDate?.toJSDate()
          : '1900-01-01',
      openParamsD2StressRisk:
        openParams && openParams.d2_stressRisk ? openParams.d2_stressRisk : 0,
      openParamsD2OpenRate:
        openParams && openParams.d2_openingRate ? openParams.d2_openingRate : 0,
      date: dateRef,
    });
    if (qNewDay && qNewDay.length > 0) {
      this.logger.silly(
        `[${this.processName}] - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - No updated data to read`,
      );
      return { inserted: -1, deleted: 0 };
    }

    const sql = `INSERT INTO "b3-spotexchange" (date, "timestamp-load", "currency-code", 
    "avgrate-hiringdate", 
    "avgrate-d0-settledate", "avgrate-d0-tcam", 
    "avgrate-d1-settledate", "avgrate-d1-tcam", 
    "avgrate-d2-settledate", "avgrate-d2-tcam", 
    "hiringrate-hiringdate", 
    "hiringrate-d0-settledate", "hiringrate-d0-low", "hiringrate-d0-high", "hiringrate-d0-close", 
    "hiringrate-d1-settledate", "hiringrate-d1-low", "hiringrate-d1-high", "hiringrate-d1-close", 
    "hiringrate-d2-settledate", "hiringrate-d2-low", "hiringrate-d2-high", "hiringrate-d2-close", 
    "hiringvol-hiringdate", 
    "hiringvol-d0-settledate", "hiringvol-d0-foreignFinVol", "hiringvol-d0-brlFinVol", "hiringvol-d0-qtyTrades", 
    "hiringvol-d1-settledate", "hiringvol-d1-foreignFinVol", "hiringvol-d1-brlFinVol", "hiringvol-d1-qtyTrades", 
    "hiringvol-d2-settledate", "hiringvol-d2-foreignFinVol", "hiringvol-d2-brlFinVol", "hiringvol-d2-qtyTrades", 
    "hiringvol-total-foreignFinVol", "hiringvol-total-brlFinVol", "hiringvol-total-qtyTrades", 
    "settletrans-d0-settledate", "settletrans-d0-foreignFinVol", "settletrans-d0-brlFinVol",
    "settletrans-d1-settledate", "settletrans-d1-foreignFinVol", "settletrans-d1-brlFinVol",
    "settletrans-d2-settledate", "settletrans-d2-foreignFinVol", "settletrans-d2-brlFinVol",
    "openparams-hiringdate", 
    "openparams-d0-settledate", "openparams-d0-stressrisk", "openparams-d0-openrate", 
    "openparams-d1-settledate", "openparams-d1-stressrisk", "openparams-d1-openrate", 
    "openparams-d2-settledate", "openparams-d2-stressrisk", "openparams-d2-openrate")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
      $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 
      $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, 
      $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, 
      $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, 
      $50, $51, $52, $53, $54, $55, $56, $57, $58)`;

    await this.queryFactory.runQuery(sql, {
      date: dateRef.toJSDate(),
      timestampLoad,
      currencyCode: TCurrencyCode.USD,
      avgrateHiringDate:
        avgRate && avgRate.hiringDate?.toJSDate()
          ? avgRate.hiringDate?.toJSDate()
          : null,
      avgrateD0SettleDate:
        avgRate && avgRate.d0_settleDate?.toJSDate()
          ? avgRate.d0_settleDate?.toJSDate()
          : null,
      avgrateD0Tcam: avgRate && avgRate.d0_tcam ? avgRate.d0_tcam : null,
      avgrateD1SettleDate:
        avgRate && avgRate.d1_settleDate?.toJSDate()
          ? avgRate.d1_settleDate?.toJSDate()
          : null,
      avgrateD1Tcam: avgRate && avgRate.d1_tcam ? avgRate.d1_tcam : null,
      avgrateD2SettleDate:
        avgRate && avgRate.d2_settleDate?.toJSDate()
          ? avgRate.d2_settleDate?.toJSDate()
          : null,
      avgrateD2Tcam: avgRate && avgRate.d2_tcam ? avgRate.d2_tcam : null,
      hiringRateHiringDate:
        hiringRate && hiringRate.hiringDate?.toJSDate()
          ? hiringRate.hiringDate?.toJSDate()
          : null,
      hiringRateD0SettleDate:
        hiringRate && hiringRate.d0_settleDate?.toJSDate()
          ? hiringRate.d0_settleDate?.toJSDate()
          : null,
      hiringRateD0Low:
        hiringRate && hiringRate.d0_low ? hiringRate.d0_low : null,
      hiringRateD0High:
        hiringRate && hiringRate.d0_high ? hiringRate.d0_high : null,
      hiringRateD0Close:
        hiringRate && hiringRate.d0_close ? hiringRate.d0_close : null,
      hiringRateD1SettleDate:
        hiringRate && hiringRate.d1_settleDate?.toJSDate()
          ? hiringRate.d1_settleDate?.toJSDate()
          : null,
      hiringRateD1Low:
        hiringRate && hiringRate.d1_low ? hiringRate.d1_low : null,
      hiringRateD1High:
        hiringRate && hiringRate.d1_high ? hiringRate.d1_high : null,
      hiringRateD1Close:
        hiringRate && hiringRate.d1_close ? hiringRate.d1_close : null,
      hiringRateD2SettleDate:
        hiringRate && hiringRate.d2_settleDate?.toJSDate()
          ? hiringRate.d2_settleDate?.toJSDate()
          : null,
      hiringRateD2Low:
        hiringRate && hiringRate.d2_low ? hiringRate.d2_low : null,
      hiringRateD2High:
        hiringRate && hiringRate.d2_high ? hiringRate.d2_high : null,
      hiringRateD2Close:
        hiringRate && hiringRate.d2_close ? hiringRate.d2_close : null,
      hiringVolHiringDate:
        hiringVolume && hiringVolume.hiringDate?.toJSDate()
          ? hiringVolume.hiringDate?.toJSDate()
          : null,
      hiringVolD0SettleDate:
        hiringVolume && hiringVolume.d0_settleDate?.toJSDate()
          ? hiringVolume.d0_settleDate?.toJSDate()
          : null,
      hiringVolD0ForeignFinVol:
        hiringVolume && hiringVolume.d0_foreignFinVol
          ? hiringVolume.d0_foreignFinVol
          : null,
      hiringVolD0BrlFinVol:
        hiringVolume && hiringVolume.d0_brlFinVol
          ? hiringVolume.d0_brlFinVol
          : null,
      hiringVolD0QtyTrades:
        hiringVolume && hiringVolume.d0_qtyTrades
          ? hiringVolume.d0_qtyTrades
          : null,
      hiringVolD1SettleDate:
        hiringVolume && hiringVolume.d1_settleDate?.toJSDate()
          ? hiringVolume.d1_settleDate?.toJSDate()
          : null,
      hiringVolD1ForeignFinVol: hiringVolume
        ? hiringVolume.d1_foreignFinVol
        : null,
      hiringVolD1BrlFinVol:
        hiringVolume && hiringVolume.d1_brlFinVol
          ? hiringVolume.d1_brlFinVol
          : null,
      hiringVolD1QtyTrades:
        hiringVolume && hiringVolume.d1_qtyTrades
          ? hiringVolume.d1_qtyTrades
          : null,
      hiringVolD2SettleDate:
        hiringVolume && hiringVolume.d2_settleDate?.toJSDate()
          ? hiringVolume.d2_settleDate?.toJSDate()
          : null,
      hiringVolD2ForeignFinVol:
        hiringVolume && hiringVolume.d2_foreignFinVol
          ? hiringVolume.d2_foreignFinVol
          : null,
      hiringVolD2BrlFinVol:
        hiringVolume && hiringVolume.d2_brlFinVol
          ? hiringVolume.d2_brlFinVol
          : null,
      hiringVolD2QtyTrades:
        hiringVolume && hiringVolume.d2_qtyTrades
          ? hiringVolume.d2_qtyTrades
          : null,
      hiringVolTotForeignFinVol:
        hiringVolume && hiringVolume.total_foreignFinVol
          ? hiringVolume.total_foreignFinVol
          : null,
      hiringVolTotBrlFinVol:
        hiringVolume && hiringVolume.total_brlFinVol
          ? hiringVolume.total_brlFinVol
          : null,
      hiringVolTotQtyTrades:
        hiringVolume && hiringVolume.total_qtyTrades
          ? hiringVolume.total_qtyTrades
          : null,
      settleTransD0SettleDate:
        settleTrans && settleTrans.d0_settleDate?.toJSDate()
          ? settleTrans.d0_settleDate?.toJSDate()
          : null,
      settleTransD0ForeignFinVol:
        settleTrans && settleTrans.d0_foreignFinVol
          ? settleTrans.d0_foreignFinVol
          : null,
      settleTransD0BrlFinVol:
        settleTrans && settleTrans.d0_brlFinVol
          ? settleTrans.d0_brlFinVol
          : null,
      settleTransD1SettleDate:
        settleTrans && settleTrans.d1_settleDate?.toJSDate()
          ? settleTrans.d1_settleDate?.toJSDate()
          : null,
      settleTransD1ForeignFinVol:
        settleTrans && settleTrans.d1_foreignFinVol
          ? settleTrans.d1_foreignFinVol
          : null,
      settleTransD1BrlFinVol:
        settleTrans && settleTrans.d1_brlFinVol
          ? settleTrans.d1_brlFinVol
          : null,
      settleTransD2SettleDate:
        settleTrans && settleTrans.d2_settleDate?.toJSDate()
          ? settleTrans.d2_settleDate?.toJSDate()
          : null,
      settleTransD2ForeignFinVol:
        settleTrans && settleTrans.d2_foreignFinVol
          ? settleTrans.d2_foreignFinVol
          : null,
      settleTransD2BrlFinVol:
        settleTrans && settleTrans.d2_brlFinVol
          ? settleTrans.d2_brlFinVol
          : null,
      openParamsHiringDate:
        openParams && openParams.hiringDate?.toJSDate()
          ? openParams.hiringDate?.toJSDate()
          : null,
      openParamsD0SettleDate:
        openParams && openParams.d0_settleDate?.toJSDate()
          ? openParams.d0_settleDate?.toJSDate()
          : null,
      openParamsD0StressRisk:
        openParams && openParams.d0_stressRisk
          ? openParams.d0_stressRisk
          : null,
      openParamsD0OpenRate:
        openParams && openParams.d0_openingRate
          ? openParams.d0_openingRate
          : null,
      openParamsD1SettleDate:
        openParams && openParams.d1_settleDate?.toJSDate()
          ? openParams.d1_settleDate?.toJSDate()
          : null,
      openParamsD1StressRisk:
        openParams && openParams.d1_stressRisk
          ? openParams.d1_stressRisk
          : null,
      openParamsD1OpenRate:
        openParams && openParams.d1_openingRate
          ? openParams.d1_openingRate
          : null,
      openParamsD2SettleDate:
        openParams && openParams.d2_settleDate?.toJSDate()
          ? openParams.d2_settleDate?.toJSDate()
          : null,
      openParamsD2StressRisk:
        openParams && openParams.d2_stressRisk
          ? openParams.d2_stressRisk
          : null,
      openParamsD2OpenRate:
        openParams && openParams.d2_openingRate
          ? openParams.d2_openingRate
          : null,
    });

    return { inserted: 1, deleted: 0 };
  }

  private async getD1D2Schedule(
    dateRef: DateTime,
  ): Promise<{ d1: DateTime; d2: DateTime }> {
    const qSch = await this.queryFactory.runQuery(
      `SELECT * FROM "loadcontrol-schedule" WHERE name=$1`,
      {
        name: this.processName,
      },
    );

    if (!qSch) {
      throw new Error(`Schedule not found: ${this.processName}`);
    }

    let d1 = dateRef;
    let cron = parseExpression(qSch[0].cron, {
      currentDate: dateRef.toJSDate(),
    });
    while (d1.hasSame(dateRef, 'day') || (await this.isHoliday(d1))) {
      d1 = DateTime.fromJSDate(cron.next().toDate());
    }

    let d2 = d1;
    cron = parseExpression(qSch[0].cron, { currentDate: d1.toJSDate() });
    while (d2.hasSame(d1, 'day') || (await this.isHoliday(d2))) {
      d2 = DateTime.fromJSDate(cron.next().toDate());
    }
    return { d1, d2 };
  }
}

export default spotExchangeB3;
