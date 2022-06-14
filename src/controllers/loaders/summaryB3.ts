/* eslint-disable no-nested-ternary */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-useless-return */
/* eslint-disable camelcase */
import { DateTime } from 'luxon';
import puppeteer, { Page } from 'puppeteer';
import axios from 'axios';
import https from 'https';
import { parse as parseHTML } from 'node-html-parser';
import { ILoadResult } from '../reportLoader';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import { TAssetType, TOptionType } from './assetsExpiryB3';

interface ISummaryB3 {
  date: DateTime;
  asset: string;
  assetCode: string;
  caption: string;
  contract: string;
  oiOpen: number | null;
  oiClose: number | null;
  tradesQuantity: number | null;
  volumeSize: number | null;
  financialVolume: number | null;
  previousSettle: number | null;
  previousAdjustSettle: number | null;
  open: number | null;
  low: number | null;
  high: number | null;
  close: number | null;
  vwap: number | null;
  settle: number | null;
  oscilation: number | null;
  variationPoints: number | null;
  referencePremium: number | null;
  lastBuy: number | null;
  lastSell: number | null;
  assetType: TAssetType | undefined;
  optionType: TOptionType | undefined;
}

class StatisticSummaryB3 extends ReportLoaderCalendar {
  async process(params: { dateRef: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );

    const assets = await this.getAssets(params.dateRef);
    if (!assets) {
      this.logger.warn(
        `${this.processName} - DateRef: [${params.dateRef.toFormat(
          'dd/MM/yyyy',
        )}] - Empty process. No assets found.`,
      );
      return { inserted: 0, deleted: 0 };
    }
    const res = await this.getB3ReportAssets(params.dateRef, assets);

    // Find and fix previous day openpos_close
    const sql = `select qq.date, qq.asset, qq.contract, 
    qq."oi-open" as oiopen, qq.prevdate, pp."oi-close" as oiclose from 
    (select date, asset, contract, "oi-open", 
    (select date from "b3-summary" p 
    where p."date"<s."date" and p.asset=s.asset and p.contract=s.contract 
    order by p."date" desc limit 1) as prevdate
    from "b3-summary" s where s.date::DATE=$1::DATE order by date, asset, contract) qq
    left join "b3-summary" pp 
    on (qq.prevdate=pp.date and qq.asset=pp.asset and qq.contract=pp.contract)
    where qq."oi-open" <> pp."oi-close" order by qq.date desc`;

    const qFixReport = await this.queryFactory.runQuery(sql, {
      date: params.dateRef.toJSDate(),
    });
    let updated = 0;
    let prevDate: DateTime | undefined;

    for await (const row of qFixReport) {
      if (!prevDate) prevDate = DateTime.fromJSDate(row.prevdate);

      const [, updt] = await this.queryFactory.runQuery(
        `update "b3-summary" set "oi-close"=$4 
        where date::DATE=$1::DATE and asset=$2 and contract=$3`,
        {
          date: prevDate.toJSDate(),
          asset: row.asset,
          contract: row.contract,
          posclose: row.oiopen,
        },
      );
      updated += parseInt(updt);
    }

    if (updated > 0) {
      // Mark previous
      await this.queryFactory.runQuery(
        `update "loadcontrol" set status='DONE' where 
        "date-ref"::DATE=$1::DATE and UPPER(process)=UPPER($2) and status<>'DONE'`,
        {
          date: prevDate?.toJSDate(),
          process: this.processName,
        },
      );
      this.logger.warn(
        `${this.processName} - DateRef: [${params.dateRef.toFormat(
          'dd/MM/yyyy',
        )}] - Previous date updated: ${prevDate?.toFormat(
          'dd/MM/yyyy',
        )} - Records fixed: ${updated}`,
      );
    }

    // Checks if report data is right on the source
    const qHasData = await this.queryFactory.runQuery(
      `SELECT SUM("oi-open" - "oi-close") as diff FROM "b3-summary" WHERE date=$1`,
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

  private async getAssets(dateRef: DateTime): Promise<string[]> {
    const assets: string[] = [];
    const html = await this.retry({
      type: 'ASSETS',
      dateRef,
      asset: 'DOL',
    });
    const root = parseHTML(html.data);
    const cboAssets = root.querySelectorAll('option');
    if (cboAssets) {
      cboAssets.forEach(option => {
        if (option.getAttribute('value')!.trim().length > 2)
          assets.push(option.getAttribute('value')!.trim().toUpperCase());
      });
    }

    return assets;
    // AUS,B3SAO,BGI,CAD,CCM,CCROO,CNH,CIELO,CMIGP,CPM,D13,DAP,DCO,DDI,DI1,DOL,DR1,DS1,ETH,EUP,FRC,FRO,FRP,GBR,HYPEO,ICF,IDI,IND,ISP,JAP,MEX,OZ1,PETRP,PSSAO,SJC,SCS,SWI,USIMA,VALEO,VVARO,WD1,WDO,WIN,WSP
  }

  public async getB3ReportAssets(
    dtParam: DateTime,
    assets: string[],
  ): Promise<ILoadResult> {
    const loadResults: ILoadResult[] = [];

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--single-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--no-zygote',
        process.env.NODE_ENV === 'PROD' ? '' : '--remote-debugging-port=9228',
        process.env.NODE_ENV === 'PROD'
          ? ''
          : '--remote-debugging-address=0.0.0.0',
      ],
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);

    try {
      // eslint-disable-next-line no-restricted-syntax
      for await (const asset of assets) {
        if (
          (process.env.B3_REPORT_SUMMARY_ASSETS || '')
            .split(',')
            .find(a => asset === a.trim().toUpperCase()) ||
          String(process.env.B3_REPORT_SUMMARY_ASSETS).trim().toUpperCase() ===
            'ALL'
        ) {
          await this.sleep(parseInt(process.env.QUERY_INTERVAL || '2'));

          const loadResult = await this.getB3Report(dtParam, asset, page);
          loadResults.push(loadResult);

          this.logger.silly(
            `${this.processName} - DateRef: [${dtParam.toFormat(
              'dd/MM/yyyy',
            )}] - Asset: [${asset}]: ${JSON.stringify(loadResult)}`,
          );
        }
      }
    } finally {
      await browser.close();
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

  async performQuery(params: {
    type?: string;
    page: Page;
    dateRef: DateTime;
    asset: string;
  }): Promise<any | void> {
    const url =
      'https://www2.bmf.com.br/pages/portal/bmfbovespa/lumis/lum-sistema-pregao-ptBR.asp';

    const postData = {
      Data: params.dateRef.toFormat('dd/MM/yyyy'),
      Mercadoria: params.asset,
    };

    switch (params.type) {
      case 'ASSETS':
        return axios({
          method: 'get',
          url: `${url}?${new URLSearchParams(postData)}`,
          responseType: 'arraybuffer',
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });
      default:
        await params.page.goto(`${url}?${new URLSearchParams(postData)}`);
        // eslint-disable-next-line consistent-return
        return;
    }
  }

  private async getB3Report(
    dateRef: DateTime,
    assetCode: string,
    page: Page,
  ): Promise<ILoadResult> {
    const results: ISummaryB3[] = [];

    const volColumns = [
      {
        column: 'CONTR ABERT',
        index: -1,
      },
      {
        column: 'CONTR FECH',
        index: -1,
      },
      {
        column: 'NÚM NEGOC',
        index: -1,
      },
      {
        column: 'CONTR NEGOC',
        index: -1,
      },
      {
        column: 'VOL', // apagar '(R$)'
        index: -1,
      },
    ];

    const dataColumns = [
      {
        column: 'AJUSTE ANTER',
        index: -1,
      },
      {
        column: 'AJUSTE ANTER CORRIG',
        index: -1,
      },
      {
        column: 'PREÇO ABERT',
        index: -1,
      },
      {
        column: 'PREÇO MÍN',
        index: -1,
      },
      {
        column: 'PREÇO MÁX',
        index: -1,
      },
      {
        column: 'PREÇO MÉD',
        index: -1,
      },
      {
        column: 'ÚLT PREÇO',
        index: -1,
      },
      {
        column: 'AJUSTE',
        index: -1,
      },
      {
        column: 'AJUSTEDE REF',
        index: -1,
      },
      {
        column: 'OSCIL',
        index: -1,
      },
      {
        column: 'VAR PTOS',
        index: -1,
      },
      {
        column: 'PRÊMIO DE REFERÊNCIA',
        index: -1,
      },
      {
        column: 'ÚLT OF COMPRA',
        index: -1,
      },
      {
        column: 'ÚLT OF VENDA',
        index: -1,
      },
    ];

    await this.retry({
      page,
      dateRef,
      asset: assetCode,
    });

    const tblInst = await page.$$('table#principal');
    if (tblInst) {
      for (let i = 0; i < tblInst.length; i++) {
        const elCaption = await tblInst[i].$('caption');
        if (elCaption) {
          const caption = await elCaption.evaluate(el =>
            el
              .textContent!.trim()
              .toUpperCase()
              .normalize('NFD')
              .replace(/\p{Diacritic}/gu, ''),
          );

          const tblContent = await tblInst[i].$$('table');

          let tblContract;
          let tblVolume;
          let tblData;

          if (tblContent.length === 3) {
            [tblContract, tblVolume, tblData] = tblContent;
          } else if (tblContent.length === 2) {
            [tblVolume, tblData] = tblContent;
          } else {
            throw new Error(
              `Asset: [${assetCode}] - Invalid content - Caption: ${caption}`,
            );
          }

          const volCols:
            | { array: any; qtyCols: number; unknownCols: string[] }
            | any = await tblVolume.$$eval(
            'th',
            (ths, vc: { column: string; index: number }[] | any) => {
              // Verifica se há coluna não reconhecida
              const unknownCols: string[] = [];
              ths.forEach(th => {
                const sth = th
                  .textContent!.replace(/\(.*\)/g, '')
                  .replace(/[.]/g, '')
                  .toUpperCase()
                  .trim();
                if (
                  vc.findIndex(
                    (c: { column: string; index: number }) => c.column === sth,
                  ) < 0
                )
                  unknownCols.push(sth);
              });

              return {
                array: vc.map((c: { column: string; index: number }) => {
                  const ic = ths.findIndex(
                    th =>
                      th
                        .textContent!.replace(/\(.*\)/g, '')
                        .replace(/[.]/g, '')
                        .toUpperCase()
                        .trim() === c.column,
                  );
                  return ic >= 0 ? { column: c.column, index: ic } : c;
                }),
                qtyCols: ths.length,
                unknownCols,
              };
            },
            volColumns,
          );

          volCols.unknownCols.forEach((col: any) =>
            this.logger.warn(
              `${
                this.processName
              } - Volume => Unknow column - DateRef: [${dateRef.toFormat(
                'dd/MM/yyyy',
              )}] - Asset: [${assetCode}] - Column: [${col}]`,
            ),
          );

          const dataCols:
            | { array: any; qtyCols: number; unknownCols: string[] }
            | any = await tblData.$$eval(
            'th',
            (ths, dc: { column: string; index: number }[] | any) => {
              // Verifica se há coluna não reconhecida
              const unknownCols: string[] = [];
              ths.forEach(th => {
                const sth = th
                  .textContent!.replace(/\(.*\)/g, '')
                  .replace(/[.]/g, '')
                  .toUpperCase()
                  .trim();
                if (
                  dc.findIndex(
                    (c: { column: string; index: number }) => c.column === sth,
                  ) < 0
                )
                  unknownCols.push(sth);
              });

              return {
                array: dc.map((c: { column: string; index: number }) => {
                  const ic = ths.findIndex(
                    th =>
                      th
                        .textContent!.replace(/\(.*\)/g, '')
                        .replace(/[.]/g, '')
                        .toUpperCase()
                        .trim() === c.column,
                  );
                  return ic >= 0 ? { column: c.column, index: ic } : c;
                }),
                qtyCols: ths.length,
                unknownCols,
              };
            },
            dataColumns,
          );

          dataCols.unknownCols.forEach((col: any) =>
            this.logger.warn(
              `${
                this.processName
              } - Dados => Unknow column - DateRef: [${dateRef.toFormat(
                'dd/MM/yyyy',
              )}] - Asset: [${assetCode}] - Column: [${col}]`,
            ),
          );

          const volume:
            | {
                oiOpen: number | null;
                oiClose: number | null;
                tradesQuantity: number | null;
                volumeSize: number | null;
                financialVolume: number | null;
              }[]
            | any = await tblVolume.$$eval(
            'td',
            (
              tds,
              iCols: number | any,
              vc: { column: string; index: number }[] | any,
            ) => {
              const vol = [];
              for (let j = 0; j < tds.length; j += iCols) {
                vol.push({
                  oiOpen:
                    vc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'CONTR ABERT',
                    )!.index >= 0
                      ? parseInt(
                          tds[
                            j +
                              vc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'CONTR ABERT',
                              )!.index
                          ].textContent!.replace(/\./g, ''),
                          10,
                        )
                      : null,
                  oiClose:
                    vc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'CONTR FECH',
                    )!.index >= 0
                      ? parseInt(
                          tds[
                            j +
                              vc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'CONTR FECH',
                              )!.index
                          ].textContent!.replace(/\./g, ''),
                          10,
                        )
                      : null,
                  tradesQuantity:
                    vc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'NÚM NEGOC',
                    )!.index >= 0
                      ? parseInt(
                          tds[
                            j +
                              vc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'NÚM NEGOC',
                              )!.index
                          ].textContent!.replace(/\./g, ''),
                          10,
                        )
                      : null,
                  volumeSize:
                    vc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'CONTR NEGOC',
                    )!.index >= 0
                      ? parseInt(
                          tds[
                            j +
                              vc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'CONTR NEGOC',
                              )!.index
                          ].textContent!.replace(/\./g, ''),
                          10,
                        )
                      : null,
                  financialVolume:
                    vc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'VOL',
                    )!.index >= 0
                      ? parseInt(
                          tds[
                            j +
                              vc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'VOL',
                              )!.index
                          ].textContent!.replace(/\./g, ''),
                          10,
                        )
                      : null,
                });
              }
              return vol;
            },
            volCols.qtyCols,
            volCols.array,
          );

          const data:
            | {
                previousSettle: number | null;
                previousAdjustSettle: number | null;
                open: number | null;
                low: number | null;
                high: number | null;
                close: number | null;
                vwap: number | null;
                settle: number | null;
                oscilation: number | null;
                variationPoints: number | null;
                referencePremium: number | null;
                lastBuy: number | null;
                lastSell: number | null;
              }[]
            | any = await tblData.$$eval(
            'td',
            (
              tds,
              iCols: number | any,
              dc: { column: string; index: number }[] | any,
            ) => {
              const myParseFloat = (sNumber: string): number | null => {
                if (!sNumber) return null;

                const fNumber = parseFloat(
                  sNumber
                    .trim()
                    .replace(/\./g, '')
                    .replace(',', '.')
                    .replace('+', '')
                    .replace('-', ''),
                );
                // eslint-disable-next-line no-restricted-globals
                if (isNaN(fNumber)) return null;
                if (sNumber.includes('-')) return -fNumber;
                return fNumber;
              };

              const aData = [];
              for (let j = 0; j < tds.length; j += iCols) {
                aData.push({
                  previousSettle:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'AJUSTE ANTER',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'AJUSTE ANTER',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  previousAdjustSettle:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'AJUSTE ANTER CORRIG',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'AJUSTE ANTER CORRIG',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  open:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'PREÇO ABERT',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'PREÇO ABERT',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  low:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'PREÇO MÍN',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'PREÇO MÍN',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  high:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'PREÇO MÁX',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'PREÇO MÁX',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  vwap:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'PREÇO MÉD',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'PREÇO MÉD',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  close:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'ÚLT PREÇO',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'ÚLT PREÇO',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  settle:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'AJUSTE',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'AJUSTE',
                              )!.index
                          ].textContent!,
                        )
                      : dc.find(
                          (col: { column: string; index: number }) =>
                            col.column === 'AJUSTEDE REF',
                        )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'AJUSTEDE REF',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  oscilation:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'OSCIL',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'OSCIL',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  variationPoints:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'VAR PTOS',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'VAR PTOS',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  referencePremium:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'PRÊMIO DE REFERÊNCIA',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'PRÊMIO DE REFERÊNCIA',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  lastBuy:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'ÚLT OF COMPRA',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'ÚLT OF COMPRA',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                  lastSell:
                    dc.find(
                      (col: { column: string; index: number }) =>
                        col.column === 'ÚLT OF VENDA',
                    )!.index >= 0
                      ? myParseFloat(
                          tds[
                            j +
                              dc.find(
                                (col: { column: string; index: number }) =>
                                  col.column === 'ÚLT OF VENDA',
                              )!.index
                          ].textContent!,
                        )
                      : null,
                });
              }
              return aData;
            },
            dataCols.qtyCols,
            dataCols.array,
          );

          let contracts;
          if (tblContract) {
            contracts = await tblContract.$$eval('td', tds =>
              tds.map(td => td.textContent!.trim().toUpperCase()),
            );
          } else {
            contracts = volume.map(() => 'SPOT');
          }

          contracts.forEach((contract: any, j: number) => {
            let asset: string;
            let assetType: TAssetType;
            let optionType: TOptionType | undefined;

            let symbol = String(contract)
              .toUpperCase()
              .match(/^(.*)((F|G|H|J|K|M|N|Q|U|V|X|Z)\d\d)(C|P)(\d{6})$/);
            if (symbol) {
              assetType = TAssetType.OPTIONS;
              optionType =
                symbol[4] === 'C' ? TOptionType.CALL : TOptionType.PUT;

              asset = `${symbol[0].replace(symbol[1], assetCode)}`;
              contract = `${symbol[2]}`;
            } else if (contract === 'SPOT') {
              assetType = TAssetType.SPOT;
              asset = assetCode;
            } else {
              symbol = String(contract)
                .toUpperCase()
                .match(
                  /^([F|G|H|J|K|M|N|Q|U|V|X|Z]\d)([F|G|H|J|K|M|N|Q|U|V|X|Z]\d)$/,
                );

              if (symbol) {
                assetType = TAssetType.FUTURES;
                contract = `${this.futuresContractConvert2DigitsYear(
                  symbol[1],
                  dateRef,
                )}${this.futuresContractConvert2DigitsYear(
                  symbol[2],
                  dateRef,
                )}`;
                asset = `${assetCode}${contract}`;
              } else {
                symbol = String(contract)
                  .toUpperCase()
                  .match(/^([F|G|H|J|K|M|N|Q|U|V|X|Z]\d)$/);

                if (symbol) {
                  assetType = TAssetType.FUTURES;
                  contract = this.futuresContractConvert2DigitsYear(
                    contract,
                    dateRef,
                  );
                  asset = `${assetCode}${contract}`;
                } else if (
                  String(contract)
                    .toUpperCase()
                    .match(/^([F|G|H|J|K|M|N|Q|U|V|X|Z]\d\d)$/)
                ) {
                  assetType = TAssetType.FUTURES;
                  asset = `${assetCode}${contract}`;
                } else {
                  symbol = String(contract)
                    .toUpperCase()
                    .match(/^([F|G|H|J|K|M|N|Q|U|V|X|Z])(\d)\d\d$/);
                  if (symbol) {
                    assetType = TAssetType.FUTURES;
                    asset = `${assetCode}${contract}`;
                    contract = this.futuresContractConvert2DigitsYear(
                      `${symbol[1]}${symbol[2]}`,
                      dateRef,
                    );
                  } else {
                    assetType = TAssetType.FUTURES;
                    asset = contract;
                  }
                }
              }
            }

            results.push({
              date: dateRef,
              asset,
              assetCode,
              caption,
              contract,
              oiOpen: volume[j].oiOpen,
              oiClose: volume[j].oiClose,
              tradesQuantity: volume[j].tradesQuantity,
              volumeSize: volume[j].volumeSize,
              financialVolume: volume[j].financialVolume,
              previousSettle: data[j].previousSettle,
              previousAdjustSettle: data[j].previousAdjustSettle,
              open: data[j].open,
              high: data[j].high,
              low: data[j].low,
              vwap: data[j].vwap,
              close: data[j].close,
              settle: data[j].settle,
              oscilation: data[j].oscilation,
              variationPoints: data[j].variationPoints,
              referencePremium: data[j].referencePremium,
              lastBuy: data[j].lastBuy,
              lastSell: data[j].lastSell,
              assetType,
              optionType,
            });
          });
        }
      }
    }
    return this.toDatabase(results);
  }

  private async toDatabase(results: ISummaryB3[]): Promise<ILoadResult> {
    const sql = `INSERT INTO "b3-summary" (date, asset, "asset-code", 
    "asset-type", caption, contract, "oi-open", "oi-close", "trades-quantity", 
    "volume-size", "financial-volume", "previous-settle", "previous-adjust-settle", 
    open, low, high, close, vwap, settle, oscilation, "variation-points", 
    "reference-premium", "last-buy", "last-sell", "option-type") VALUES 
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 
      $18, $19, $20, $21, $22, $23, $24, $25)`;

    let inserted = 0;
    let deleted = '';
    if (results.length > 0) {
      const sqlDel = `DELETE FROM "b3-summary" WHERE date=$1 AND "asset-code"=$2`;
      [, deleted] = await this.queryFactory.runQuery(sqlDel, {
        date: results[0].date.startOf('day').toJSDate(),
        assetCode: results[0].assetCode,
      });
    }

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      await this.queryFactory.runQuery(sql, {
        date: res.date.startOf('day').toJSDate(),
        asset: res.asset,
        assetCode: res.assetCode,
        assetType: res.assetType,
        caption: res.caption,
        contract: res.contract,
        oiOpen: res.oiOpen || null,
        oiClose: res.oiClose || null,
        tradesQuantity: res.tradesQuantity || null,
        volumeSize: res.volumeSize || null,
        financialVolume: res.financialVolume || null,
        previousSettle: res.previousSettle || null,
        previousAdjustSettle: res.previousAdjustSettle || null,
        open: res.open || null,
        low: res.low || null,
        high: res.high || null,
        close: res.close || null,
        vwap: res.vwap || null,
        settle: res.settle || null,
        oscilation: res.oscilation || null,
        variationPoints: res.variationPoints || null,
        referencePremium: res.referencePremium || null,
        lastBuy: res.lastBuy || null,
        lastSell: res.lastSell || null,
        optionType: res.optionType || null,
      });
      inserted++;
    }
    return { inserted, deleted: parseInt(deleted) || 0 };
  }
}

export default StatisticSummaryB3;
