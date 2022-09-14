/* eslint-disable no-nested-ternary */
/* eslint-disable no-case-declarations */
/* eslint-disable camelcase */
/* eslint-disable no-useless-escape */
/* eslint-disable no-restricted-syntax */
import axios from 'axios';
import { DateTime } from 'luxon';
import path from 'path';
import fs from 'fs';
import csv from 'csv-parser';
import { Pool } from 'pg';
import { from as pgCopyFrom } from 'pg-copy-streams';
import { ILoadResult } from '../reportLoader';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import ZipFileManager from '../zipFileManager';
import CloudFileManager from '../cloudFileManager';
import { TDataOrigin } from '../../db/migrations/1634260181468-tbl_b3_ts_summary';

interface ITimesAndSales {
  timestamp: DateTime;
  asset: string;
  level: number;
  size: number;
  tradeId: string;
  updt: number;
}

interface IRollAsset {
  roll: string;
  asset: string;
}

interface IVolumeProfile {
  level: number;
  volume: number;
  quantity: number;
}

class TimesAndSalesB3 extends ReportLoaderCalendar {
  async process(params: { dateRef: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );

    const qSch = await this.queryFactory.runQuery(
      `SELECT "date-ref-adjust" dtadj FROM "loadcontrol-schedule" WHERE name=$1`,
      { process: this.processName },
    );
    let origin;
    if (qSch && qSch.length > 0)
      origin = params.dateRef.hasSame(
        DateTime.now().plus({ days: Number(qSch[0].dtadj) }),
        'day',
      )
        ? TDataOrigin.B3_LOADER_PROCESS
        : TDataOrigin.B3_LOADER_REPROCESS;
    else origin = TDataOrigin.B3_LOADER_REPROCESS;

    const url = `http://arquivos.b3.com.br/apinegocios/tickercsv/${params.dateRef.toFormat(
      'yyyy-MM-dd',
    )}`;

    const zipFilename = (
      process.env.B3_TIMESNSALES_ZIPFILENAME || 'TS_FULL_$YYYYMMDD.zip'
    ).replace('$YYYYMMDD', params.dateRef.toFormat('yyyyMMdd'));

    let zipPathFilename = path.resolve(
      __dirname,
      '../../../',
      process.env.TEMP_DATA_FILES_DIR || 'data',
      zipFilename,
    );

    if (!(await this.downloadTSFile(params.dateRef, url, zipPathFilename))) {
      this.logger.error(
        `[${this.processName}] - DateRef: ${params.dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Unable to download TS data file`,
      );
      if (fs.existsSync(zipPathFilename)) fs.unlinkSync(zipPathFilename);

      return { inserted: 0, deleted: 0 };
    }

    // Compact (LEVEL9) and upload zip file to cloud
    const csvPathFilename = await ZipFileManager.unzipSingleFile(
      zipPathFilename,
    );
    zipPathFilename = await ZipFileManager.compactSingleFile(
      csvPathFilename,
      zipFilename,
    );
    await CloudFileManager.uploadFileCloudPool(
      zipPathFilename,
      process.env.B3_TIMESNSALES_REMOTE_FOLDER || '',
      false,
      false,
    );

    // Certify b3-timesnsales table is empty
    await this.queryFactory.runQuery(`TRUNCATE TABLE "b3-timesnsales"`, {});
    await this.queryFactory.runQuery(`VACUUM(FULL) "b3-timesnsales"`, {});

    const resTSLoad = await this.dbLoadCSVTSFile(csvPathFilename);
    const resTSDel = await this.deleteUpdtTrades(params.dateRef);
    this.logger.info(
      `${this.processName} DateRef: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )} - TimesNSales file records loaded: ${JSON.stringify({
        inserted: resTSLoad.inserted,
        deleted: resTSDel.deleted,
      })}`,
    );

    const resRoll = await this.calculateRollingInstList(
      params.dateRef,
      this.getRollAssetList(),
      origin,
    );

    this.logger.info(
      `${this.processName} DateRef: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )} - Rolling trades loaded: ${JSON.stringify(resRoll)}`,
    );

    const res = await this.summarizeTSData(params.dateRef, origin);

    await this.queryFactory.runQuery(`TRUNCATE TABLE "b3-timesnsales"`, {});
    await this.queryFactory.runQuery(`VACUUM(FULL) "b3-timesnsales"`, {});

    if (fs.existsSync(csvPathFilename)) fs.unlinkSync(csvPathFilename);
    if (fs.existsSync(zipPathFilename)) fs.unlinkSync(zipPathFilename);

    return res;
  }

  async performQuery(params: {
    action: string;
    url?: string;
    filePath?: string;
  }): Promise<any> {
    if (params.action === 'GET_T&S_DATES') {
      const url = 'https://arquivos.b3.com.br/apinegocios/dates';
      const tradeDates = (await axios({ url, method: 'GET' })).data;

      if (!tradeDates || !Array.isArray(tradeDates) || tradeDates.length === 0)
        throw new Error(`Can't read B3 available trade dates: ${tradeDates}`);

      return tradeDates.map((d: string) =>
        DateTime.fromFormat(d, 'yyyy-MM-dd'),
      );
    }
    if (params.action === 'GET_T&S_B3') {
      if (!params.url)
        throw new Error(
          `[${
            this.processName
          }] performQuery() - Missing parameters: ${JSON.stringify(params)}`,
        );

      return axios({
        url: params.url,
        method: 'GET',
        responseType: 'stream',
      });
    }
    if (params.action === 'GET_T&S_CLOUD') {
      if (!params.filePath)
        throw new Error(
          `[${
            this.processName
          }] performQuery() - Missing parameters: ${JSON.stringify(params)}`,
        );

      const foundInCloud = await CloudFileManager.downloadFileCloudPool(
        params.filePath,
        process.env.B3_TIMESNSALES_REMOTE_FOLDER || '',
      );

      return foundInCloud;
    }
    throw new Error(`Missing action parameter: ${JSON.stringify(params)}`);
  }

  public async downloadTSFile(
    dateRef: DateTime,
    url: string,
    filePath: string,
  ): Promise<boolean> {
    const foundInCloud: boolean = await this.retry({
      action: 'GET_T&S_CLOUD',
      filePath,
    });

    if (foundInCloud) return new Promise(resolve => resolve(true));

    const availableDates: DateTime[] = await this.retry({
      action: 'GET_T&S_DATES',
    });

    if (
      !availableDates.find(
        d => d.toMillis() === dateRef.startOf('day').toMillis(),
      )
    ) {
      this.logger.warn(
        `[${this.processName}] Trade date not available: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )}`,
      );
      return false;
    }

    let response;
    try {
      response = await this.retry({ action: 'GET_T&S_B3', url });
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return false;
      }
      throw err;
    }
    const fsStream = fs.createWriteStream(filePath);
    response.data.pipe(fsStream);

    return new Promise((resolve, reject) => {
      fsStream.on('finish', async () => {
        if (fsStream.bytesWritten === 0) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
      fsStream.on('error', error => {
        reject(error);
      });
    });
  }

  public async dbLoadCSVTSFile(pathFilename: string): Promise<ILoadResult> {
    const assets =
      String(process.env.B3_TIMESNSALES_ASSETS_REGEX).trim().toUpperCase() ===
      'ALL'
        ? ['.*']
        : (process.env.B3_TIMESNSALES_ASSETS_REGEX || '')
            .split(',')
            .map(a =>
              a.trim() !== ''
                ? a
                    .trim()
                    .toUpperCase()
                    .replace(/@/g, '(F|G|H|J|K|M|N|Q|U|V|X|Z)\\d\\d')
                    .replace(/[\^\$]/g, '')
                    .replace(/^/, '^')
                    .concat('$')
                : undefined,
            )
            .filter(a => !!a);

    if (!assets || assets.length === 0) return { inserted: 0, deleted: 0 };
    let inserted = 0;
    let read = 0;

    const pool = new Pool({
      connectionString: `postgresql://${process.env.DB_USER || 'dbuser'}:${
        process.env.DB_PASS || 'dbpass'
      }@${process.env.DB_HOST || 'dbhost'}:${process.env.DB_PORT || '3211'}/${
        process.env.DB_NAME || 'dbname'
      }`,
    });

    return new Promise((resolve, reject) => {
      pool.connect((pgErr, client, done) => {
        if (pgErr) {
          reject(new Error(`Database connection error: ${pgErr.message}`));
        }

        const pgStream = client.query(
          pgCopyFrom(
            `COPY "b3-timesnsales" ("trade-timestamp", asset, level, size, "trade-id", updt) FROM STDIN WITH CSV DELIMITER ';'`,
          ),
        );

        fs.createReadStream(pathFilename)
          .pipe(
            csv({
              separator: process.env.B3_TIMESNSALES_CSVFILE_SEPARATOR || ';',
            }),
          )
          .on('data', row => {
            read++;

            const ts: ITimesAndSales = {
              timestamp: DateTime.fromFormat(
                `${row.RptDt} ${row.NtryTm}`,
                'yyyy-MM-dd HHmmssSSS',
                { zone: this.exchange.timezone },
              ),
              asset: row.TckrSymb,
              level: parseFloat(String(row.GrssTradAmt).replace(/,/g, '.')),
              size: parseInt(row.TradQty),
              tradeId: row.TradId,
              updt: parseInt(row.UpdActn),
            };

            if (assets.some(a => new RegExp(`${a}`).test(ts.asset))) {
              pgStream.write(
                `${ts.timestamp.toISO()};${ts.asset};${ts.level};${ts.size};${
                  ts.tradeId
                };${ts.updt}\n`,
              );
              inserted++;
            }
          })
          .on('end', async () => {
            pgStream.end();
            done();
            resolve({ inserted, deleted: 0 });
          })
          .on('error', error => {
            this.logger.error(
              `[${this.processName}] - Records read / inserted: ${read} / ${inserted} - Error: ${error.message}`,
            );

            pgStream.end();
            done();
            reject(error);
          });
      });
    });
  }

  public async deleteUpdtTrades(dateRef: DateTime): Promise<ILoadResult> {
    const [, deleted] = await this.queryFactory.runQuery(
      `DELETE FROM "b3-timesnsales" bt WHERE 
      CONCAT(asset, "trade-timestamp"::DATE::text, "trade-id") in 
      (SELECT CONCAT(asset, "trade-timestamp"::DATE::text, "trade-id") 
      FROM "b3-timesnsales" WHERE "trade-timestamp"::date=$1::date AND updt=2)`,
      { date: dateRef.toJSDate() },
    );

    return { inserted: 0, deleted: parseInt(deleted) };
  }

  public async calculateRollingInstrument(
    dateRef: DateTime,
    rollInstrument: string,
    assetCode: string,
    origin: number,
  ): Promise<ILoadResult> {
    const [, deleted] = await this.queryFactory.runQuery(
      `DELETE FROM "b3-rollingtrades" WHERE "asset-code"=$1 AND 
      "trade-timestamp"::DATE=$2::DATE AND origin<>3`,
      { assetCode, date: dateRef.toJSDate() },
    );

    const qRoll = await this.queryFactory.runQuery(
      `SELECT "trade-timestamp" as ts, asset, size, level, "trade-id" as tradeid 
      FROM "b3-timesnsales" WHERE asset ~ $1 AND 
      "trade-timestamp"::DATE=$2::DATE ORDER BY asset, "trade-timestamp"`,
      {
        asset: `^${rollInstrument}((F|G|H|J|K|M|N|Q|U|V|X|Z)\\d\\d){2}$`,
        date: dateRef.toJSDate(),
      },
    );

    let inserted = 0;
    if (qRoll && qRoll.length > 0) {
      for await (const row of qRoll) {
        const contracts = String(row.asset).match(
          /(F|G|H|J|K|M|N|Q|U|V|X|Z)\d\d/g,
        );
        const qAsset = await this.queryFactory.runQuery(
          `(SELECT "trade-timestamp" ts, asset, level as price 
          FROM "b3-timesnsales" WHERE asset=$1 AND "trade-timestamp"<=$2 
          ORDER BY "trade-timestamp" DESC, "trade-id" DESC LIMIT 1)
          UNION ALL
          (SELECT "timestamp-open" ts, asset, close as price 
          FROM "b3-ts-summary" 
          WHERE asset = $1 AND "timestamp-open"::DATE < $2::DATE 
          ORDER BY "timestamp-open" DESC 
          LIMIT 1) ORDER BY ts DESC LIMIT 1`,
          {
            asset: assetCode.concat(contracts![0]),
            tradeTimestamp: DateTime.fromJSDate(row.ts).toJSDate(),
          },
        );

        if (qAsset && qAsset.length > 0) {
          await this.queryFactory.runQuery(
            `INSERT INTO "b3-rollingtrades" ("trade-timestamp", "asset-code", 
            "contract-from", "contract-to", size, level, "trade-id", origin) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            {
              ts: DateTime.fromJSDate(row.ts).toJSDate(),
              assetCode,
              contractFrom: contracts![0],
              contractTo: contracts![1],
              size: row.size,
              level: parseFloat(qAsset[0].price) + parseFloat(row.level),
              tradeId: row.tradeid,
              origin,
            },
          );
          inserted++;
        } else {
          throw new Error(
            `calculateRollingInstrument() - Roll instrument: ${
              row.asset
            } - No data was found for asset-code [${assetCode}${
              contracts![0]
            }] in the timestamp: ${row.ts}`,
          );
        }
      }
    }
    return { inserted, deleted: parseInt(deleted) };
  }

  public async calculateRollingInstList(
    dateRef: DateTime,
    rollAssetList: IRollAsset[] | undefined,
    origin: number,
  ): Promise<ILoadResult> {
    const res: ILoadResult[] = [];

    if (!rollAssetList) {
      this.logger.warn(
        `[${this.processName}] Date Ref: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Empty rolling instrument list was provided. ENV_B3_TIMESNSALES_ROLL_ASSET_LIST: ${
          process.env.B3_TIMESNSALES_ROLL_ASSET_LIST
        }`,
      );
      return { inserted: 0, deleted: 0 };
    }

    for await (const rollAsset of rollAssetList) {
      res.push(
        await this.calculateRollingInstrument(
          dateRef,
          rollAsset.roll,
          rollAsset.asset,
          origin,
        ),
      );
    }

    return res.length > 0
      ? res.reduce((total, result) => {
          return {
            inserted: total.inserted + result.inserted,
            deleted: total.deleted + result.deleted,
          };
        })
      : { inserted: 0, deleted: 0 };
  }

  private getRollAssetList(): IRollAsset[] | undefined {
    return (process.env.B3_TIMESNSALES_ROLL_ASSET_LIST || '').trim() === ''
      ? undefined
      : (process.env.B3_TIMESNSALES_ROLL_ASSET_LIST || '').split(';').map(r => {
          const a = r.split(',');
          if (a.length !== 2) throw new Error('Invalid B3-T&S RollAsset List');
          return {
            asset: a[0]
              .trim()
              .toUpperCase()
              .replace(/[^A-Za-z0-9]/g, ''),
            roll: a[1]
              .trim()
              .toUpperCase()
              .replace(/[^A-Za-z0-9]/g, ''),
          };
        });
  }

  private async summarizeTSData(
    dateRef: DateTime,
    origin: number,
  ): Promise<ILoadResult> {
    let inserted = 0;
    const [, deleted] = await this.queryFactory.runQuery(
      `DELETE FROM "b3-ts-summary" WHERE "timestamp-open"::DATE=$1::DATE AND origin<>${TDataOrigin.PROFIT_LOADER}`,
      {
        date: dateRef.toJSDate(),
      },
    );

    const POC_AVG_FRAME =
      parseInt(process.env.B3_TIMESNSALES_SUMMARIZE_POC_AVG_FRAME || '5') < 1
        ? 0
        : parseInt(process.env.B3_TIMESNSALES_SUMMARIZE_POC_AVG_FRAME || '5');

    let sqlSummary = `SELECT asset, 
    MAX(level) FILTER(WHERE rn_asc=1) AS open, 
    MAX(level) FILTER(WHERE rn_desc=1) AS close, 
    MAX(level) AS high, MIN(level) AS low, SUM(size) AS volume, 
    COUNT(size) AS quantity, AVG(level) AS avgp,
    ROUND(SUM(size*level) / SUM(size), 2) AS vwap, 
    ROUND(STDDEV_POP(level), 4) AS sigma 
    FROM (SELECT t.*,
      ROW_NUMBER() OVER (PARTITION BY asset ORDER BY "trade-timestamp" ASC) rn_asc,
      ROW_NUMBER() OVER (PARTITION BY asset ORDER BY "trade-timestamp" DESC) rn_desc
    FROM (SELECT t.* FROM "b3-timesnsales" t WHERE 
    "trade-timestamp"::DATE=$1::DATE AND 
    asset !~ $2 AND asset !~ $3 AND asset !~ $4) t) t
    GROUP BY asset ORDER BY asset ASC`;

    // '@' => CONTRACT: F22
    let qAssets = await this.queryFactory.runQuery(sqlSummary, {
      dateRef: dateRef.toJSDate(),
      assetsIgnore: `^(${((
        process.env.B3_TIMESNSALES_SUMMARIZE_ASSETS_IGNORE || ''
      ).trim() === ''
        ? '[^\\s\\S]'
        : process.env.B3_TIMESNSALES_SUMMARIZE_ASSETS_IGNORE || ''
      )
        .split(',')
        .map(a =>
          a
            .trim()
            .replace(/@/g, '(F|G|H|J|K|M|N|Q|U|V|X|Z)\\d\\d')
            .replace(/[\^\$]/g, ''),
        )
        .join('|')})$`,
      assetsXRayed: `^(${((
        process.env.B3_TIMESNSALES_SUMMARIZE_ASSETS_XRAYED || ''
      ).trim() === ''
        ? '[^\\s\\S]'
        : (process.env.B3_TIMESNSALES_SUMMARIZE_ASSETS_XRAYED || '')
            .trim()
            .toUpperCase() === 'ALL'
        ? '.*'
        : process.env.B3_TIMESNSALES_SUMMARIZE_ASSETS_XRAYED || ''
      )
        .split(',')
        .map(a =>
          a
            .trim()
            .replace(/@/g, '(F|G|H|J|K|M|N|Q|U|V|X|Z)\\d\\d')
            .replace(/[\^\$]/g, ''),
        )
        .join('|')})$`,
      rollAssets: '^((.*)((F|G|H|J|K|M|N|Q|U|V|X|Z)\\d\\d){2})$',
    });

    for await (const qAsset of qAssets) {
      const qVP = await this.queryFactory.runQuery(
        `SELECT level, SUM(size) AS volume, COUNT(size) AS quantity 
        FROM "b3-timesnsales" 
        WHERE asset=$1 AND "trade-timestamp"::DATE=$2::DATE 
        GROUP BY level ORDER BY level ASC`,
        { asset: qAsset.asset, dateRef: dateRef.toJSDate() },
      );

      const volumeProfile: IVolumeProfile[] = qVP.map((vp: any) => {
        return {
          level: Number(vp.level),
          volume: Number(vp.volume),
          quantity: Number(vp.quantity),
        };
      });

      let idx_poc_max = 0;
      let idx_vpoc_max = 0;
      if (volumeProfile && volumeProfile.length >= POC_AVG_FRAME) {
        let i = 0;
        let idx_poc = 0;
        let idx_vpoc = 0;
        let avgFrameVolume = 0.0;
        let avgFrameQuantity = 0.0;
        let maxAvgFrameVolume = 0.0;
        let maxAvgFrameQuantity = 0.0;

        while (i + POC_AVG_FRAME <= volumeProfile.length) {
          avgFrameVolume = 0;
          avgFrameQuantity = 0;
          idx_poc = i;
          idx_vpoc = i;

          for (let j = i; j < i + POC_AVG_FRAME; j++) {
            avgFrameQuantity += volumeProfile[j].quantity;
            if (volumeProfile[j].quantity > volumeProfile[idx_poc].quantity) {
              idx_poc = j;
            }

            avgFrameVolume += volumeProfile[j].volume;
            if (volumeProfile[j].volume > volumeProfile[idx_vpoc].volume) {
              idx_vpoc = j;
            }
          }

          avgFrameQuantity /= POC_AVG_FRAME;
          avgFrameVolume /= POC_AVG_FRAME;
          if (avgFrameQuantity > maxAvgFrameQuantity) {
            maxAvgFrameQuantity = avgFrameQuantity;
            idx_poc_max = idx_poc;
          }
          if (avgFrameVolume > maxAvgFrameVolume) {
            maxAvgFrameVolume = avgFrameVolume;
            idx_vpoc_max = idx_vpoc;
          }
          i++;
        }
      } else {
        for (let i = 0; i < volumeProfile.length; i++) {
          if (volumeProfile[i].quantity > volumeProfile[idx_poc_max].quantity)
            idx_poc_max = i;
          if (volumeProfile[i].volume > volumeProfile[idx_vpoc_max].volume)
            idx_vpoc_max = i;
        }
      }
      await this.queryFactory.runQuery(
        `INSERT INTO "b3-ts-summary" (asset, "timestamp-open", 
          open, close, high, low, volume, quantity, avgp, vwap, poc, vpoc,
          sigma, "volume-profile", origin) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        {
          asset: qAsset.asset,
          tsOpen: DateTime.fromFormat(
            `${dateRef.toFormat('dd/MM/yyyy')} 00:00:00.000`,
            'dd/MM/yyyy HH:mm:ss.SSS',
            { zone: this.exchange.timezone },
          ),
          open: qAsset.open,
          close: qAsset.close,
          high: qAsset.high,
          low: qAsset.low,
          volume: qAsset.volume,
          quantity: qAsset.quantity,
          avgp: qAsset.avgp,
          vwap: qAsset.vwap,
          poc: volumeProfile[idx_poc_max].level,
          vpoc: volumeProfile[idx_vpoc_max].level,
          sigma: qAsset.sigma,
          vp: JSON.stringify(volumeProfile),
          origin,
        },
      );
      inserted++;
    }

    const minutesInterval: number =
      parseInt(process.env.B3_TIMESNSALES_SUMMARIZE_MINUTES_FRAME || '0') <= 0
        ? 1
        : parseInt(process.env.B3_TIMESNSALES_SUMMARIZE_MINUTES_FRAME || '0');

    const dtRefIni = DateTime.fromFormat(
      `${dateRef.toFormat('dd/MM/yyyy')} 00:00:00.000`,
      'dd/MM/yyyy HH:mm:ss.SSS',
      { zone: this.exchange.timezone },
    );

    const dtRefEnd = DateTime.fromFormat(
      `${dateRef.toFormat('dd/MM/yyyy')} 23:59:59.999`,
      'dd/MM/yyyy HH:mm:ss.SSS',
      { zone: this.exchange.timezone },
    );

    let dtFrom = dtRefIni;
    while (dtRefEnd.toMillis() >= dtFrom.toMillis()) {
      const dtTo = dtFrom.plus({ minutes: minutesInterval });
      sqlSummary = `SELECT asset, 
      MAX(level) FILTER(WHERE rn_asc=1) AS open, 
      MAX(level) FILTER(WHERE rn_desc=1) AS close, 
      MAX(level) AS high, MIN(level) AS low, SUM(size) AS volume, 
      COUNT(size) AS quantity, AVG(level) AS avgp,
      ROUND(SUM(size*level) / SUM(size), 2) AS vwap, 
      ROUND(STDDEV_POP(level), 4) AS sigma 
      FROM (SELECT t.*,
        ROW_NUMBER() OVER (PARTITION BY asset ORDER BY "trade-timestamp" ASC) rn_asc,
        ROW_NUMBER() OVER (PARTITION BY asset ORDER BY "trade-timestamp" DESC) rn_desc 
      FROM (SELECT t.* FROM "b3-timesnsales" t WHERE 
      "trade-timestamp">=$1 AND "trade-timestamp"<$2 AND 
      asset !~ $3 AND asset ~ $4 AND asset !~ $5) t) t
      GROUP BY asset ORDER BY asset ASC`;
      qAssets = await this.queryFactory.runQuery(sqlSummary, {
        dtFrom: dtFrom.toJSDate(),
        dtTo: dtTo.toJSDate(),
        assetsIgnore: `^(${((
          process.env.B3_TIMESNSALES_SUMMARIZE_ASSETS_IGNORE || ''
        ).trim() === ''
          ? '[^\\s\\S]'
          : process.env.B3_TIMESNSALES_SUMMARIZE_ASSETS_IGNORE || ''
        )
          .split(',')
          .map(a =>
            a
              .trim()
              .replace(/@/g, '(F|G|H|J|K|M|N|Q|U|V|X|Z)\\d\\d')
              .replace(/[\^\$]/g, ''),
          )
          .join('|')})$`,
        assetsXRayed: `^(${((
          process.env.B3_TIMESNSALES_SUMMARIZE_ASSETS_XRAYED || ''
        ).trim() === ''
          ? '[^\\s\\S]'
          : (process.env.B3_TIMESNSALES_SUMMARIZE_ASSETS_XRAYED || '')
              .trim()
              .toUpperCase() === 'ALL'
          ? '.*'
          : process.env.B3_TIMESNSALES_SUMMARIZE_ASSETS_XRAYED || ''
        )
          .split(',')
          .map(a =>
            a
              .trim()
              .replace(/@/g, '(F|G|H|J|K|M|N|Q|U|V|X|Z)\\d\\d')
              .replace(/[\^\$]/g, ''),
          )
          .join('|')})$`,
        rollAssets: '^((.*)((F|G|H|J|K|M|N|Q|U|V|X|Z)\\d\\d){2})$',
      });

      for await (const qAsset of qAssets) {
        const qVP = await this.queryFactory.runQuery(
          `SELECT level, SUM(size) AS volume, COUNT(size) AS quantity FROM 
          "b3-timesnsales" WHERE asset=$1 AND "trade-timestamp">=$2 AND 
          "trade-timestamp"<$3 GROUP BY level ORDER BY level ASC`,
          {
            asset: qAsset.asset,
            dtFrom: dtFrom.toJSDate(),
            dtTo: dtTo.toJSDate(),
          },
        );

        const volumeProfile: IVolumeProfile[] = qVP.map((vp: any) => {
          return {
            level: Number(vp.level),
            volume: Number(vp.volume),
            quantity: Number(vp.quantity),
          };
        });

        let idx_poc_max = 0;
        let idx_vpoc_max = 0;
        if (volumeProfile && volumeProfile.length >= POC_AVG_FRAME) {
          let i = 0;
          let idx_poc = 0;
          let idx_vpoc = 0;
          let avgFrameVolume = 0.0;
          let avgFrameQuantity = 0.0;
          let maxAvgFrameVolume = 0.0;
          let maxAvgFrameQuantity = 0.0;

          while (i + POC_AVG_FRAME <= volumeProfile.length) {
            avgFrameVolume = 0;
            avgFrameQuantity = 0;
            idx_poc = i;
            idx_vpoc = i;

            for (let j = i; j < i + POC_AVG_FRAME; j++) {
              avgFrameQuantity += volumeProfile[j].quantity;
              if (volumeProfile[j].quantity > volumeProfile[idx_poc].quantity) {
                idx_poc = j;
              }

              avgFrameVolume += volumeProfile[j].volume;
              if (volumeProfile[j].volume > volumeProfile[idx_vpoc].volume) {
                idx_vpoc = j;
              }
            }

            avgFrameQuantity /= POC_AVG_FRAME;
            avgFrameVolume /= POC_AVG_FRAME;
            if (avgFrameQuantity > maxAvgFrameQuantity) {
              maxAvgFrameQuantity = avgFrameQuantity;
              idx_poc_max = idx_poc;
            }
            if (avgFrameVolume > maxAvgFrameVolume) {
              maxAvgFrameVolume = avgFrameVolume;
              idx_vpoc_max = idx_vpoc;
            }
            i++;
          }
        } else {
          for (let i = 0; i < volumeProfile.length; i++) {
            if (volumeProfile[i].quantity > volumeProfile[idx_poc_max].quantity)
              idx_poc_max = i;
            if (volumeProfile[i].volume > volumeProfile[idx_vpoc_max].volume)
              idx_vpoc_max = i;
          }
        }

        await this.queryFactory.runQuery(
          `INSERT INTO "b3-ts-summary" (asset, "timestamp-open", 
          open, close, high, low, volume, quantity, avgp, vwap, poc, vpoc,
          sigma, "volume-profile", origin) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          {
            asset: qAsset.asset,
            tsOpen: dtFrom.toJSDate(),
            open: qAsset.open,
            close: qAsset.close,
            high: qAsset.high,
            low: qAsset.low,
            volume: qAsset.volume,
            quantity: qAsset.quantity,
            avgp: qAsset.avgp,
            poc: volumeProfile[idx_poc_max].level,
            vpoc: volumeProfile[idx_vpoc_max].level,
            vwap: qAsset.vwap,
            sigma: qAsset.sigma,
            vp: JSON.stringify(volumeProfile),
            origin,
          },
        );
        inserted++;
      }
      dtFrom = dtTo;
    }

    return { inserted, deleted: parseInt(deleted) };
  }
}

export default TimesAndSalesB3;
