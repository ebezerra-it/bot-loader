/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
/* eslint-disable camelcase */
/* eslint-disable no-useless-escape */
import path from 'path';
import axios from 'axios';
import https from 'https';
import { parse as parseHTML } from 'node-html-parser';
import { DateTime } from 'luxon';
import qs from 'qs';
import { ILoadResult } from '../reportLoader';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { loadJSONFile } from '../utils';

enum TAssetType {
  FUTURES = 'FUTURES',
  OPTIONS_CALL = 'OPTIONS_CALL',
  OPTIONS_PUT = 'OPTIONS_PUT',
}

interface IAsset {
  code: string;
  type: TAssetType;
  caption: string;
}

interface IOIPlayers {
  date: DateTime;
  assetCode: string | undefined;
  assetType: TAssetType | undefined;
  caption: string;
  central_bank: { buy: number; sell: number };
  fin_corp: { buy: number; sell: number };
  fin_corp_banks: { buy: number; sell: number };
  fin_corp_dtvm_ctvm: { buy: number; sell: number };
  fin_corp_others: { buy: number; sell: number };
  inst_inv: { buy: number; sell: number };
  inst_inv_national_investor: { buy: number; sell: number };
  for_inv: { buy: number; sell: number };
  for_inv_res2687: { buy: number; sell: number };
  for_inv_res2689: { buy: number; sell: number };
  non_fin_corp: { buy: number; sell: number };
  ind_inv: { buy: number; sell: number };
  total: { buy: number; sell: number };
  raw_data: string;
}

class OIPlayersB3 extends ReportLoaderCalendar {
  assets: IAsset[];

  async process(params: { dateRef: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );

    const assetsFilePath = path.join(
      __dirname,
      '../../../',
      'config/',
      'b3_oiplayers_assets.json',
    );
    this.assets = await loadJSONFile(assetsFilePath);

    if (!this.assets || this.assets.length === 0) {
      throw new Error(`Empty assets file: ${assetsFilePath}`);
    }

    await this.getSpotReport();
    return this.getB3Report(params.dateRef);
  }

  private getAsset(caption: string): IAsset | undefined {
    const asset = this.assets.find(
      a =>
        a.caption
          .toUpperCase()
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .trim()
          .replace(/[^A-Z0-9&\(\)]|[-]/g, '') ===
        caption.replace(/[^A-Z0-9&\(\)]|[-]/g, ''),
    );
    return asset || undefined;
  }

  async performQuery(params: { url: string; postData?: any }): Promise<any> {
    if (params.postData) {
      return axios({
        method: 'post',
        url: params.url,
        data: qs.stringify(params.postData),
        responseType: 'arraybuffer',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });
    }
    return (
      await axios({
        method: 'GET',
        url: params.url,
        headers: {
          'Accept-Encoding': 'gzip, deflate, br',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
          Connection: 'keep-alive',
          'Cache-Control': 'max-age=0',
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      })
    ).data;
  }

  public async getB3Report(dt: DateTime): Promise<ILoadResult> {
    const results: IOIPlayers[] = [];

    const postData = {
      dData1: dt.toFormat('dd/MM/yyyy'),
    };

    const url =
      'https://www2.bmf.com.br/pages/portal/bmfbovespa/lumis/lum-tipo-de-participante-ptBR.asp';
    const html = await this.retry({ url, postData });

    const fixedHtml: string = html.data
      .toString('latin1')
      .replace(
        / *<br \/>\s*<table>/g,
        '</TR>\n</tbody>\n</table>\n<br />\n<table>\n',
      )
      .replace(/<\/td>\s*<TR>/g, '</td>\n</TR>\n\n<TR>\n')
      .replace(
        /<br \/>\s*<\/tbody>\s*<\/table>/g,
        '</TR>\n</tbody>\n</table>\n',
      );

    const root = parseHTML(fixedHtml);
    const tables = root.querySelectorAll('table');

    for await (const table of tables) {
      const caption = table.querySelectorAll('caption');
      if (!caption || !Array.isArray(caption) || caption.length === 0) continue;
      let sCaption = caption[0].innerText
        .replace('  ', ' ')
        .toUpperCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .trim();

      if (!sCaption || sCaption === '') continue;
      const Asset = this.getAsset(sCaption);
      let assetCode: string | undefined;
      let assetType: TAssetType | undefined;
      if (!Asset) {
        this.logger.warn(
          `[${this.processName}] - DateRef: ${dt.toFormat(
            'dd/MM/yyyy',
          )} - Unknown asset for caption: ${sCaption}`,
        );
      } else {
        assetCode = Asset.code;
        sCaption = Asset.caption;
        assetType = Asset.type;
      }

      const oiPlayer = <IOIPlayers>{};
      oiPlayer.date = dt;
      oiPlayer.assetCode = assetCode || undefined;
      oiPlayer.assetType = assetType || undefined;
      oiPlayer.caption = sCaption;

      const tds = table.querySelectorAll('td');
      const aRawData: { field: string; buy: number; sell: number }[] = [];
      for (let i = 0; i < tds.length; i++) {
        const tdCaption = tds[i].innerText.trim().toUpperCase();
        aRawData.push({
          field: tdCaption,
          buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
          sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
        });
        switch (tdCaption) {
          case 'BANCO CENTRAL':
            oiPlayer.central_bank = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'PESSOA JURÍDICA FINANCEIRA':
            oiPlayer.fin_corp = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'BANCOS':
            oiPlayer.fin_corp_banks = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case "DTVM'S E CORRETORAS DE VALORES":
            oiPlayer.fin_corp_dtvm_ctvm = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'OUTRAS JURÍDICAS FINANCEIRAS':
            oiPlayer.fin_corp_others = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'INVESTIDOR INSTITUCIONAL':
            oiPlayer.inst_inv = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'INVEST. INSTITUCIONAL NACIONAL':
            oiPlayer.inst_inv_national_investor = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'INVESTIDORES NÃO RESIDENTES':
            oiPlayer.for_inv = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'INV. NÃO RESIDENTE - RES.2687 AGROP':
            oiPlayer.for_inv_res2687 = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'INV. NÃO RESIDENTE - RES.2689':
            oiPlayer.for_inv_res2689 = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'PESSOA JURÍDICA NÃO FINANCEIRA':
            oiPlayer.non_fin_corp = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'PESSOA FÍSICA':
            oiPlayer.ind_inv = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          case 'TOTAL GERAL':
            oiPlayer.total = {
              buy: Number(tds[i + 1].rawText.replace(/\./g, '')),
              sell: Number(tds[i + 3].rawText.replace(/\./g, '')),
            };
            i += 4;
            break;

          default:
            this.logger.warn(
              `[${this.processName}] - DateRef: ${dt.toFormat(
                'dd/MM/yyyy',
              )} - Unknown player stored in raw_data column - Asset: [${sCaption}] - I: [${i}] TD: [${tdCaption}]`,
            );
            i += 4;
            break;
        }
      }
      oiPlayer.raw_data = JSON.stringify(aRawData);
      results.push(oiPlayer);
    }

    return this.toDatabase(results);
  }

  private async toDatabase(results: IOIPlayers[]): Promise<ILoadResult> {
    const sql = `INSERT INTO "b3-oi-players" (date, "asset-code", "asset-type", caption, 
      central_bank_buy, central_bank_sell, 
      fin_corp_buy, fin_corp_sell, 
      fin_corp_banks_buy, fin_corp_banks_sell, 
      fin_corp_dtvm_ctvm_buy, fin_corp_dtvm_ctvm_sell, 
      fin_corp_others_buy, fin_corp_others_sell,
      inst_inv_buy, inst_inv_sell, 
      inst_inv_national_investor_buy, inst_inv_national_investor_sell, 
      for_inv_buy, for_inv_sell, 
      for_inv_res2687_buy, for_inv_res2687_sell, 
      for_inv_res2689_buy, for_inv_res2689_sell, 
      non_fin_corp_buy, non_fin_corp_sell, 
      ind_inv_buy, ind_inv_sell, raw_data) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29) 
      ON CONFLICT (date, caption) DO UPDATE SET 
      "asset-code"=$2, "asset-type"=$3, 
      central_bank_buy=$5, central_bank_sell=$6, 
      fin_corp_buy=$7, fin_corp_sell=$8, 
      fin_corp_banks_buy=$9, fin_corp_banks_sell=$10, 
      fin_corp_dtvm_ctvm_buy=$11, fin_corp_dtvm_ctvm_sell=$12, 
      fin_corp_others_buy=$13, fin_corp_others_sell=$14,
      inst_inv_buy=$15, inst_inv_sell=$16, 
      inst_inv_national_investor_buy=$17, inst_inv_national_investor_sell=$18, 
      for_inv_buy=$19, for_inv_sell=$20, 
      for_inv_res2687_buy=$21, for_inv_res2687_sell=$22, 
      for_inv_res2689_buy=$23, for_inv_res2689_sell=$24, 
      non_fin_corp_buy=$25, non_fin_corp_sell=$26, 
      ind_inv_buy=$27, ind_inv_sell=$28, raw_data=$29`;

    let loadCount = 0;
    let deleted = '';
    if (results.length > 0) {
      const sqlDel = `DELETE FROM "b3-oi-players" WHERE date=$1`;
      [, deleted] = await this.queryFactory.runQuery(sqlDel, {
        date: results[0].date.startOf('day').toJSDate(),
      });
    } else return { inserted: 0, deleted: 0 };

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      await this.queryFactory.runQuery(sql, {
        date: res.date.startOf('day').toJSDate(),
        assetCode: res.assetCode,
        type: res.assetType,
        caption: res.caption,
        central_bank_buy: res.central_bank ? res.central_bank.buy : null,
        central_bank_sell: res.central_bank ? res.central_bank.sell : null,
        fin_corp_buy: res.fin_corp ? res.fin_corp.buy : null,
        fin_corp_sell: res.fin_corp ? res.fin_corp.sell : null,
        fin_corp_banks_buy: res.fin_corp_banks ? res.fin_corp_banks.buy : null,
        fin_corp_banks_sell: res.fin_corp_banks
          ? res.fin_corp_banks.sell
          : null,
        fin_corp_dtvm_ctvm_buy: res.fin_corp_dtvm_ctvm
          ? res.fin_corp_dtvm_ctvm.buy
          : null,
        fin_corp_dtvm_ctvm_sell: res.fin_corp_dtvm_ctvm
          ? res.fin_corp_dtvm_ctvm.sell
          : null,
        fin_corp_others_buy: res.fin_corp_others ? res.fin_corp_others.buy : 0,
        fin_corp_others_sell: res.fin_corp_others
          ? res.fin_corp_others.sell
          : null,
        inst_inv_buy: res.inst_inv ? res.inst_inv.buy : null,
        inst_inv_sell: res.inst_inv ? res.inst_inv.sell : null,
        inst_inv_national_investor_buy: res.inst_inv_national_investor
          ? res.inst_inv_national_investor.buy
          : null,
        inst_inv_national_investor_sell: res.inst_inv_national_investor
          ? res.inst_inv_national_investor.sell
          : null,
        for_inv_buy: res.for_inv ? res.for_inv.buy : null,
        for_inv_sell: res.for_inv ? res.for_inv.sell : null,
        for_inv_res2687_buy: res.for_inv_res2687
          ? res.for_inv_res2687.buy
          : null,
        for_inv_res2687_sell: res.for_inv_res2687
          ? res.for_inv_res2687.sell
          : null,
        for_inv_res2689_buy: res.for_inv_res2689
          ? res.for_inv_res2689.buy
          : null,
        for_inv_res2689_sell: res.for_inv_res2689
          ? res.for_inv_res2689.sell
          : null,
        non_fin_corp_buy: res.non_fin_corp ? res.non_fin_corp.buy : null,
        non_fin_corp_sell: res.non_fin_corp ? res.non_fin_corp.sell : null,
        ind_inv_buy: res.ind_inv ? res.ind_inv.buy : null,
        ind_inv_sell: res.ind_inv ? res.ind_inv.sell : null,
        raw_data: res.raw_data ? res.raw_data : null,
      });
      loadCount++;
    }
    return { inserted: loadCount, deleted: parseInt(deleted) || 0 };
  }

  private async getSpotReport(): Promise<ILoadResult> {
    const url =
      'https://sistemaswebb3-listados.b3.com.br/investorParticipationProxy/investorParticipationCall/GetOpendaily/eyJwYWdlU2l6ZSI6MjAsImlkZW50aWZpZXIiOm51bGwsImxhbmd1YWdlIjoicHQtYnIifQ==';
    // 'http://sistemaswebb3-listados.b3.com.br/investorParticipationPage/';

    const spotPlayers = await this.retry({ url });

    const dtStart = DateTime.fromFormat(
      spotPlayers.HeaderDates.StartDate,
      `yyyy-MM-dd'T'HH:mm:ss`,
    );
    const dtEnd = DateTime.fromFormat(
      spotPlayers.HeaderDates.EndDate,
      `yyyy-MM-dd'T'HH:mm:ss`,
    );

    let invalid = false;

    if (!dtStart.isValid || !dtEnd.isValid) invalid = true;
    else if (
      !spotPlayers ||
      !spotPlayers.Result ||
      spotPlayers.Result.length === 0
    )
      invalid = true;
    if (invalid) {
      this.logger.error(
        `[${
          this.processName
        }] - SpotPlayersReport - Invalid response dates: ${JSON.stringify(
          spotPlayers,
        )}`,
      );
      return { inserted: 0, deleted: 0 };
    }

    let ind_inv_buy: number | undefined;
    let ind_inv_buy_perc: number | undefined;
    let ind_inv_sell: number | undefined;
    let ind_inv_sell_perc: number | undefined;
    let inv_club_buy: number | undefined;
    let inv_club_buy_perc: number | undefined;
    let inv_club_sell: number | undefined;
    let inv_club_sell_perc: number | undefined;
    let inst_inv_buy: number | undefined;
    let inst_inv_buy_perc: number | undefined;
    let inst_inv_sell: number | undefined;
    let inst_inv_sell_perc: number | undefined;
    let for_inv_buy: number | undefined;
    let for_inv_buy_perc: number | undefined;
    let for_inv_sell: number | undefined;
    let for_inv_sell_perc: number | undefined;
    let pub_pri_corp_buy: number | undefined;
    let pub_pri_corp_buy_perc: number | undefined;
    let pub_pri_corp_sell: number | undefined;
    let pub_pri_corp_sell_perc: number | undefined;
    let fin_inst_buy: number | undefined;
    let fin_inst_buy_perc: number | undefined;
    let fin_inst_sell: number | undefined;
    let fin_inst_sell_perc: number | undefined;
    let others_buy: number | undefined;
    let others_buy_perc: number | undefined;
    let others_sell: number | undefined;
    let others_sell_perc: number | undefined;
    let hasUnknownColumn = false;
    const MULTIPLIER = 1000;
    spotPlayers.Result.forEach((r: any) => {
      if (r.TypeInvestor === 'Investidores Individuais') {
        ind_inv_buy =
          Number(String(r.BuyVolume).replace(/\./g, '')) * MULTIPLIER;
        ind_inv_buy_perc = Number(
          String(r.BuyParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );

        ind_inv_sell =
          Number(String(r.SaleVolume).replace(/\./g, '')) * MULTIPLIER;
        ind_inv_sell_perc = Number(
          String(r.SaleParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );
      } else if (r.TypeInvestor === 'Clubes de Investimento') {
        inv_club_buy =
          Number(String(r.BuyVolume).replace(/\./g, '')) * MULTIPLIER;
        inv_club_buy_perc = Number(
          String(r.BuyParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );

        inv_club_sell =
          Number(String(r.SaleVolume).replace(/\./g, '')) * MULTIPLIER;
        inv_club_sell_perc = Number(
          String(r.SaleParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );
      } else if (r.TypeInvestor === 'Institucionais') {
        inst_inv_buy =
          Number(String(r.BuyVolume).replace(/\./g, '')) * MULTIPLIER;
        inst_inv_buy_perc = Number(
          String(r.BuyParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );

        inst_inv_sell =
          Number(String(r.SaleVolume).replace(/\./g, '')) * MULTIPLIER;
        inst_inv_sell_perc = Number(
          String(r.SaleParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );
      } else if (r.TypeInvestor === 'Investidor Estrangeiro') {
        for_inv_buy =
          Number(String(r.BuyVolume).replace(/\./g, '')) * MULTIPLIER;
        for_inv_buy_perc = Number(
          String(r.BuyParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );

        for_inv_sell =
          Number(String(r.SaleVolume).replace(/\./g, '')) * MULTIPLIER;
        for_inv_sell_perc = Number(
          String(r.SaleParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );
      } else if (r.TypeInvestor === 'Empresas Públicas e Privadas') {
        pub_pri_corp_buy =
          Number(String(r.BuyVolume).replace(/\./g, '')) * MULTIPLIER;
        pub_pri_corp_buy_perc = Number(
          String(r.BuyParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );

        pub_pri_corp_sell =
          Number(String(r.SaleVolume).replace(/\./g, '')) * MULTIPLIER;
        pub_pri_corp_sell_perc = Number(
          String(r.SaleParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );
      } else if (r.TypeInvestor === 'Instituições Financeiras') {
        fin_inst_buy =
          Number(String(r.BuyVolume).replace(/\./g, '')) * MULTIPLIER;
        fin_inst_buy_perc = Number(
          String(r.BuyParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );

        fin_inst_sell =
          Number(String(r.SaleVolume).replace(/\./g, '')) * MULTIPLIER;
        fin_inst_sell_perc = Number(
          String(r.SaleParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );
      } else if (r.TypeInvestor === 'Outros') {
        others_buy =
          Number(String(r.BuyVolume).replace(/\./g, '')) * MULTIPLIER;
        others_buy_perc = Number(
          String(r.BuyParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );

        others_sell =
          Number(String(r.SaleVolume).replace(/\./g, '')) * MULTIPLIER;
        others_sell_perc = Number(
          String(r.SaleParticipation).replace(/\%/g, '').replace(/\,/, '.'),
        );
      } else {
        hasUnknownColumn = true;
      }
    });

    const qLast = await this.queryFactory.runQuery(
      `select "start-date" as startdate, "end-date" as enddate,
      coalesce("ind-inv-buy", 0) as indinvbuy, 
      coalesce("ind-inv-buy-perc", 0) as indinvbuyperc, 
      coalesce("ind-inv-sell", 0) as indinvsell, 
      coalesce("ind-inv-sell-perc", 0) as indinvsellperc, 
      coalesce("inv-club-buy", 0) as invclubbuy, 
      coalesce("inv-club-buy-perc", 0) as invclubbuyperc, 
      coalesce("inv-club-sell", 0) as invclubsell, 
      coalesce("inv-club-sell-perc", 0) as invclubsellperc, 
      coalesce("inst-inv-buy", 0) as instinvbuy, 
      coalesce("inst-inv-buy-perc", 0) as instinvbuyperc, 
      coalesce("inst-inv-sell", 0) as instinvsell, 
      coalesce("inst-inv-sell-perc", 0) as instinvsellperc, 
      coalesce("for-inv-buy", 0) as forinvbuy, 
      coalesce("for-inv-buy-perc", 0) as forinvbuyperc, 
      coalesce("for-inv-sell", 0) as forinvsell, 
      coalesce("for-inv-sell-perc", 0) as forinvsellperc, 
      coalesce("pub-pri-corp-buy", 0) as pubpricorpbuy, 
      coalesce("pub-pri-corp-buy-perc", 0) as pubpricorpbuyperc, 
      coalesce("pub-pri-corp-sell", 0) as pubpricorpsell, 
      coalesce("pub-pri-corp-sell-perc", 0) as pubpricorpsellperc, 
      coalesce("fin-inst-buy", 0) as fininstbuy, 
      coalesce("fin-inst-buy-perc", 0) as fininstbuyperc, 
      coalesce("fin-inst-sell", 0) as fininstsell, 
      coalesce("fin-inst-sell-perc", 0) as fininstsellperc, 
      coalesce("others-buy", 0) as othersbuy, 
      coalesce("others-buy-perc", 0) as othersbuyperc, 
      coalesce("others-sell", 0) as otherssell, 
      coalesce("others-sell-perc", 0) as otherssellperc,
      "has-unknown-column" as hasunknowncolumn
      from "b3-spot-players" where "start-date"=$1::DATE and "end-date"=$2::DATE`,
      { dtStart: dtStart.toJSDate(), dtEnd: dtEnd.toJSDate() },
    );

    if (
      qLast &&
      qLast.length > 0 &&
      DateTime.fromJSDate(qLast[0].startdate).hasSame(dtStart, 'day') &&
      DateTime.fromJSDate(qLast[0].enddate).hasSame(dtEnd, 'day') &&
      Number(qLast[0].indinvbuy) === ind_inv_buy &&
      Number(qLast[0].indinvbuyperc) === ind_inv_buy_perc &&
      Number(qLast[0].indinvsell) === ind_inv_sell &&
      Number(qLast[0].indinvsellperc) === ind_inv_sell_perc &&
      Number(qLast[0].invclubbuy) === inv_club_buy &&
      Number(qLast[0].invclubbuyperc) === inv_club_buy_perc &&
      Number(qLast[0].invclubsell) === inv_club_sell &&
      Number(qLast[0].invclubsellperc) === inv_club_sell_perc &&
      Number(qLast[0].instinvbuy) === inst_inv_buy &&
      Number(qLast[0].instinvbuyperc) === inst_inv_buy_perc &&
      Number(qLast[0].instinvsell) === inst_inv_sell &&
      Number(qLast[0].instinvsellperc) === inst_inv_sell_perc &&
      Number(qLast[0].forinvbuy) === for_inv_buy &&
      Number(qLast[0].forinvbuyperc) === for_inv_buy_perc &&
      Number(qLast[0].forinvsell) === for_inv_sell &&
      Number(qLast[0].forinvsellperc) === for_inv_sell_perc &&
      Number(qLast[0].pubpricorpbuy) === pub_pri_corp_buy &&
      Number(qLast[0].pubpricorpbuyperc) === pub_pri_corp_buy_perc &&
      Number(qLast[0].pubpricorpsell) === pub_pri_corp_sell &&
      Number(qLast[0].pubpricorpsellperc) === pub_pri_corp_sell_perc &&
      Number(qLast[0].fininstbuy) === fin_inst_buy &&
      Number(qLast[0].fininstbuyperc) === fin_inst_buy_perc &&
      Number(qLast[0].fininstsell) === fin_inst_sell &&
      Number(qLast[0].fininstsellperc) === fin_inst_sell_perc &&
      Number(qLast[0].othersbuy) === others_buy &&
      Number(qLast[0].othersbuyperc) === others_buy_perc &&
      Number(qLast[0].otherssell) === others_sell &&
      Number(qLast[0].otherssellperc) === others_sell_perc &&
      (String(qLast[0].hasunknowncolumn).toLocaleLowerCase() === 'true') ===
        hasUnknownColumn
    ) {
      this.logger.info(
        `[${
          this.processName
        }] - SpotPlayersReport - No updated data to read: ${JSON.stringify(
          spotPlayers,
        )}`,
      );
      return { inserted: -1, deleted: 0 };
    }

    const sql = `insert into "b3-spot-players" ("timestamp-load", "start-date", "end-date", 
    "ind-inv-buy", "ind-inv-buy-perc", "ind-inv-sell", "ind-inv-sell-perc", 
    "inv-club-buy", "inv-club-buy-perc", "inv-club-sell", "inv-club-sell-perc", 
    "inst-inv-buy", "inst-inv-buy-perc", "inst-inv-sell", "inst-inv-sell-perc", 
    "for-inv-buy", "for-inv-buy-perc", "for-inv-sell", "for-inv-sell-perc", 
    "pub-pri-corp-buy", "pub-pri-corp-buy-perc", "pub-pri-corp-sell", "pub-pri-corp-sell-perc", 
    "fin-inst-buy", "fin-inst-buy-perc", "fin-inst-sell", "fin-inst-sell-perc", 
    "others-buy", "others-buy-perc", "others-sell", "others-sell-perc", 
    "has-unknown-column", "json-data") values 
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 
    $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, 
    $33)`;

    await this.queryFactory.runQuery(sql, {
      tsLoad: DateTime.now().toJSDate(),
      startdate: dtStart.toJSDate(),
      enddate: dtEnd.toJSDate(),
      ind_inv_buy: ind_inv_buy || null,
      ind_inv_buy_perc: ind_inv_buy_perc || null,
      ind_inv_sell: ind_inv_sell || null,
      ind_inv_sell_perc: ind_inv_sell_perc || null,
      inv_club_buy: inv_club_buy || null,
      inv_club_buy_perc: inv_club_buy_perc || null,
      inv_club_sell: inv_club_sell || null,
      inv_club_sell_perc: inv_club_sell_perc || null,
      inst_inv_buy: inst_inv_buy || null,
      inst_inv_buy_perc: inst_inv_buy_perc || null,
      inst_inv_sell: inst_inv_sell || null,
      inst_inv_sell_perc: inst_inv_sell_perc || null,
      for_inv_buy: for_inv_buy || null,
      for_inv_buy_perc: for_inv_buy_perc || null,
      for_inv_sell: for_inv_sell || null,
      for_inv_sell_perc: for_inv_sell_perc || null,
      pub_pri_corp_buy: pub_pri_corp_buy || null,
      pub_pri_corp_buy_perc: pub_pri_corp_buy_perc || null,
      pub_pri_corp_sell: pub_pri_corp_sell || null,
      pub_pri_corp_sell_perc: pub_pri_corp_sell_perc || null,
      fin_inst_buy: fin_inst_buy || null,
      fin_inst_buy_perc: fin_inst_buy_perc || null,
      fin_inst_sell: fin_inst_sell || null,
      fin_inst_sell_perc: fin_inst_sell_perc || null,
      others_buy: others_buy || null,
      others_buy_perc: others_buy_perc || null,
      others_sell: others_sell || null,
      others_sell_perc: others_sell_perc || null,
      hasUnknownColumn,
      json: JSON.stringify(spotPlayers.Result),
    });
    return { inserted: 1, deleted: 0 };
  }
}

export default OIPlayersB3;
export { TAssetType };
