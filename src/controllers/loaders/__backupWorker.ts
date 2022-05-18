/* 
import { DateTime } from 'luxon';
import { to as pgCopyTo } from 'pg-copy-streams';
import { Pool } from 'pg';
import fs from 'fs';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { TsGoogleDrive } from 'ts-google-drive';
import childprocess from 'child_process';
import path from 'path';
import { TCountryCode } from '../tcountry';
import reportLoader, { ILoadResult } from '../reportLoader';
import ReportLoaderCalendar from '../reportLoaderCalendar';

interface IFilterField {
  field: string;
  value: string;
}

class BackupWorker extends reportLoader {
  async process(params: {
    dateRef: DateTime;
    dateMatch: DateTime;
  }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );

    const tables: {
      process: string;
      name: string;
      dateField: string;
      filterFields: IFilterField[] | undefined;
      orderFields: string[] | undefined;
    }[] = [];
    tables.push({
      process: 'ContractB3',
      name: 'b3-oi-contracts',
      dateField: 'date',
      orderFields: ['date'],
      filterFields: [],
    });
    tables.push({
      process: 'PlayersB3',
      name: 'b3-oi-players',
      dateField: 'date',
      orderFields: ['date'],
      filterFields: [],
    });
    tables.push({
      process: 'PlayersB3',
      name: 'b3-spot-players',
      dateField: 'timestamp-load',
      orderFields: ['timestamp-load'],
      filterFields: [],
    });
    tables.push({
      process: 'TimesNSalesB3',
      name: 'b3-rollingtrades',
      dateField: 'trade-timestamp',
      orderFields: ['trade-timestamp'],
      filterFields: [],
    });
    tables.push({
      process: 'TimesNSalesB3',
      name: 'b3-ts-summary',
      dateField: 'timestamp-open',
      orderFields: ['timestamp-open'],
      filterFields: [],
    });
    tables.push({
      process: 'SpotExchangeB3',
      name: 'b3-spotexchange',
      dateField: 'date',
      orderFields: ['date', 'timestamp-load'],
      filterFields: [],
    });
    tables.push({
      process: 'SpotExchangeIntradayB3',
      name: 'b3-spotexchange-intraday',
      dateField: 'date',
      orderFields: ['date', 'timestamp-load'],
      filterFields: [],
    });
    tables.push({
      process: 'SummaryB3',
      name: 'b3-summary',
      dateField: 'date',
      orderFields: ['date'],
      filterFields: [],
    });
    tables.push({
      process: 'PtaxBCB',
      name: 'bcb-ptax',
      dateField: 'date',
      orderFields: ['date'],
      filterFields: [],
    });
    tables.push({
      process: 'AssetsExpiryCME',
      name: 'cme-assets-expiry',
      dateField: '',
      orderFields: [],
      filterFields: [],
    });
    tables.push({
      process: 'SummaryCME',
      name: 'cme-blocktrades',
      dateField: 'calendar-date',
      orderFields: ['calendar-date'],
      filterFields: [],
    });
    tables.push({
      process: 'SummaryCME',
      name: 'cme-opts-summary',
      dateField: 'date',
      orderFields: ['date'],
      filterFields: [],
    });
    tables.push({
      process: 'SummaryCME',
      name: 'cme-summary',
      dateField: 'date',
      orderFields: ['date'],
      filterFields: [],
    });
    tables.push({
      process: 'ChartLoaderCME',
      name: 'cme-chartdata',
      dateField: 'timestamp-open',
      orderFields: ['timestamp-open'],
      filterFields: [],
    });
    tables.push({
      process: '',
      name: 'economic-calendar',
      dateField: '',
      orderFields: [],
      filterFields: [],
    });
    tables.push({
      process: '',
      name: 'holiday-calendar',
      dateField: '',
      orderFields: [],
      filterFields: [],
    });
    tables.push({
      process: '',
      name: 'global-parameters',
      dateField: '',
      orderFields: [],
      filterFields: [],
    });
    tables.push({
      process: '',
      name: 'loadcontrol-schedule',
      dateField: '',
      orderFields: [],
      filterFields: [],
    });
    tables.push({
      process: '',
      name: 'loadcontrol',
      dateField: 'date-match',
      filterFields: [{ field: 'status', value: 'DONE' }],
      orderFields: [],
    });
    tables.push({
      process: '',
      name: 'users',
      dateField: '',
      orderFields: [],
      filterFields: [],
    });

    const result: ILoadResult = { inserted: 0, deleted: 0 };

    // extract distinct processess from tables array
    const procs = tables.filter(
      (v, i, a) =>
        a.findIndex(t => t.process === v.process && t.process !== '') === i,
    );

    try {
      const qProcs = await this.queryFactory.runQuery(
        `SELECT process, COUNT(*) as qty FROM "loadcontrol" WHERE 
        "date-ref"::DATE=$1::DATE AND status='DONE' 
        GROUP BY process ORDER BY process ASC`,
        {
          date: params.dateRef.toJSDate(),
        },
      );
      let procPending = false;
      if (qProcs) {
        for (const t of procs) {
          // eslint-disable-next-line no-continue
          if (t.process === '') continue;

          const tblProc = qProcs.find(
            (p: any) =>
              String(p.process).toUpperCase() ===
              String(t.process).toUpperCase(),
          );
          if (!tblProc) {
            procPending = true;
            break;
          }
        }
      }

      if (procPending) {
        this.logger.warn(
          `[${this.processName}] - DateRef: ${params.dateRef.toFormat(
            'dd/MM/yyyy',
          )} - Backup procedure can´t start. Waiting for all processess to finish`,
        );
        return { inserted: 0, deleted: 0 };
      }

      for await (const table of tables) {
        const res = await this.backupData(
          table.name,
          table.dateField,
          params.dateRef,
          table.filterFields,
          table.orderFields,
        );
        if (table.process !== '') {
          result.inserted += res.inserted;
          result.deleted += res.deleted;
        }
      }

      if (result.inserted === 0) return { inserted: 0, deleted: 0 };

      // zip table files
      await this.compactBackupFiles(params.dateRef);

      // upload zip file to the cloud
      await this.retry({ dateRef: params.dateRef });

      // clean log files
      this.cleanLogFiles(params.dateRef);

      // execute database data delete policy
      if (String(process.env.BACKUP_TABLES_DELETE).toUpperCase() === 'TRUE') {
        for await (const table of tables) {
          const res = await this.deleteDBData(
            table.name,
            table.dateField,
            params.dateRef,
            table.filterFields,
          );
          result.inserted += res.inserted;
          result.deleted += res.deleted;
        }
      }

      // clean cloud backup files
      await this.cleanCloudBackupFiles(params.dateRef);
    } catch (err) {
      this.logger.error(
        `[${this.processName}] - DateRef: ${params.dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Backup procedure has failed: ${err.message}`,
      );
      throw err;
    }
    return result;
  }

  async performQuery(params: { dateRef: DateTime }): Promise<any> {
    const res = await this.uploadBackupZipFile(params.dateRef);
    if (res) {
      childprocess.execSync(
        `rm -rf ${process.env.TEMP_DATA_FILES_DIR || 'data'}/*`,
      );
    }
  }

  public async compactBackupFiles(dateRef: DateTime): Promise<void> {
    return new Promise((resolve, reject) => {
      // copy log file to backup dir
      const pathLogFile = path.resolve(
        __dirname,
        '../../../',
        process.env.LOG_FILES_DIRECTORY || '',
        `${process.env.LOG_FILES_PREFIX || ''}${dateRef.toFormat(
          'yyyyMMdd',
        )}.log`,
      );

      if (fs.existsSync(pathLogFile)) {
        fs.copyFileSync(
          pathLogFile,
          path.resolve(
            __dirname,
            '../../../',
            process.env.TEMP_DATA_FILES_DIR || 'data',
            `${process.env.BACKUP_FILE_PREFIX || ''}${
              process.env.LOG_FILES_PREFIX || ''
            }${dateRef.toFormat('yyyyMMdd')}.log`,
          ),
        );
      }

      const filename = `${
        process.env.BACKUP_FILE_PREFIX || ''
      }${dateRef.toFormat('yyyyMMdd')}.zip`;
      const zipFile = fs.createWriteStream(
        `${process.env.TEMP_DATA_FILES_DIR || 'data'}/${filename}`,
      );
      const archive = archiver('zip', {
        zlib: {
          level: 9,
        },
      });
      zipFile.on('close', () => {
        this.logger.silly(
          `[${this.processName}] - DateRef: ${dateRef.toFormat(
            'dd/MM/yyyy',
          )} - Backup files compressed - Zip file: ${filename}`,
        );
        resolve();
      });

      archive.on('error', err => {
        reject(err);
      });

      archive.pipe(zipFile);
      archive.glob(`${process.env.BACKUP_FILE_PREFIX || ''}*.csv`, {
        nodir: true,
        cwd: process.env.TEMP_DATA_FILES_DIR || 'data',
      });
      archive.glob(`${process.env.BACKUP_FILE_PREFIX || ''}*.log`, {
        nodir: true,
        cwd: process.env.TEMP_DATA_FILES_DIR || 'data',
      });
      archive.finalize();
    });
  }

  public async uploadBackupZipFile(dateRef: DateTime): Promise<boolean> {
    const filename = `${process.env.BACKUP_FILE_PREFIX || ''}${dateRef.toFormat(
      'yyyyMMdd',
    )}.zip`;
    const filePath = `${process.env.TEMP_DATA_FILES_DIR || 'data'}/${filename}`;
    const remoteFolder = process.env.BACKUP_DB_CLOUD_FOLDER || '';

    try {
      await BackupWorker.uploadFileCloud(filePath, remoteFolder, true, true);
    } catch (error) {
      this.logger.error(
        `[${this.processName}] - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Unable to upload backup file do the cloud - File: ${filename} - Error: ${JSON.stringify(
          error,
        )}`,
      );
      return false;
    }
    this.logger.silly(
      `[${this.processName}] - DateRef: ${dateRef.toFormat(
        'dd/MM/yyyy',
      )} - Backup file was sucessfuly uploaded to the cloud - File: ${filename}`,
    );
    return true;
  }

  public static async uploadFileCloud(
    pathFile: string,
    remoteFolder: string,
    deleteIfExists = false,
    uploadIfExists = false,
  ): Promise<void> {
    const gdrive = new TsGoogleDrive({
      credentials: {
        client_email: process.env.GDRIVE_CLIENT_EMAIL,
        private_key: String(process.env.GDRIVE_PRIVATE_KEY).replace(
          /\\n/g,
          '\n',
        ),
      },
    });

    let found = false;
    const query = gdrive
      .query()
      .setFileOnly()
      .inFolder(remoteFolder)
      .setNameEqual(path.basename(pathFile));
    while (query.hasNextPage()) {
      const files = await query.run();

      for await (const file of files) {
        if (deleteIfExists) await file.delete();
        else found = true;
      }
    }

    if (!found || uploadIfExists || deleteIfExists) {
      await gdrive.upload(pathFile, {
        parent: remoteFolder,
      });
    }
  }

  private async cleanCloudBackupFiles(dateRef: DateTime): Promise<number> {
    const gdrive = new TsGoogleDrive({
      credentials: {
        client_email: process.env.GDRIVE_CLIENT_EMAIL,
        private_key: String(process.env.GDRIVE_PRIVATE_KEY).replace(
          /\\n/g,
          '\n',
        ),
      },
    });

    const backupFolder = process.env.BACKUP_DB_CLOUD_FOLDER || '';
    const zipFilename = `${
      process.env.BACKUP_FILE_PREFIX || ''
    }${dateRef.toFormat('yyyyMMdd')}.zip`;

    let found = false;
    let query = gdrive
      .query()
      .setFileOnly()
      .inFolder(backupFolder)
      .setNameEqual(zipFilename)
      .setOrderBy('name');

    if (query.hasNextPage()) {
      const files = await query.run();
      if (files.length > 0) found = true;
    }

    let deleted = 0;
    if (found) {
      const filesToDelete: { dtFile: DateTime; file: any }[] = [];
      query = gdrive.query().setFileOnly().inFolder(backupFolder);

      while (query.hasNextPage()) {
        const files = await query.run();
        for await (const file of files) {
          const filematch = file.name.match(
            new RegExp(`${process.env.BACKUP_FILE_PREFIX || ''}(\\d{8}).zip`),
          );
          if (filematch) {
            const dtFile = DateTime.fromFormat(filematch[1], 'yyyyMMdd');
            if (
              dtFile.isValid &&
              dtFile.startOf('day').toMillis() <
                dateRef.startOf('day').toMillis()
            ) {
              filesToDelete.push({
                dtFile,
                file,
              });
            }
          }
        }
      }

      if (filesToDelete.length === 0) return 0;

      // sorts in date ascending order to delete the oldest files first
      filesToDelete.sort(
        (a, b) =>
          a.dtFile.startOf('day').diff(b.dtFile.startOf('day'), 'days').days,
      );

      const retention =
        !process.env.BACKUP_CLOUD_FILES_RETENTION ||
        Number(process.env.BACKUP_CLOUD_FILES_RETENTION) <= 0
          ? Number.POSITIVE_INFINITY
          : Number(process.env.BACKUP_CLOUD_FILES_RETENTION);

      if (filesToDelete.length > retention - 1) {
        for (let i = 0; filesToDelete.length - i > retention - 1; i++) {
          await filesToDelete[i].file.delete();
          deleted++;
          this.logger.silly(
            `[${this.processName}] Cloud backup file deleted: ${filesToDelete[i].file.name}`,
          );
        }
      }
    }
    return deleted;
  }

  public static async downloadFileCloud(
    pathFile: string,
    remoteFolderId: string,
  ): Promise<boolean> {
    const gdrive = new TsGoogleDrive({
      credentials: {
        client_email: process.env.GDRIVE_CLIENT_EMAIL,
        private_key: String(process.env.GDRIVE_PRIVATE_KEY).replace(
          /\\n/g,
          '\n',
        ),
      },
    });
    const remoteFolder = await gdrive.getFile(remoteFolderId);
    if (!remoteFolder)
      throw new Error(
        `Download file from cloud failed - Remote folder Id not found: ${remoteFolderId}`,
      );

    const query = gdrive
      .query()
      .setFileOnly()
      .inFolder(remoteFolderId)
      .setNameEqual(path.basename(pathFile));

    if (query.hasNextPage()) {
      const files = await query.run();
      if (!files || files.length === 0) return false;

      let found;
      for await (const file of files) {
        if (
          file.parents[0] === remoteFolderId &&
          file.name === path.basename(pathFile)
        )
          found = file;
        break;
      }
      if (!found) return false;

      fs.writeFileSync(pathFile, await found.download());
      return true;
    }
    return false;
  }

  public async cleanLogFiles(dateRef: DateTime): Promise<void> {
    const logDir = path.resolve(
      path.join(
        `${__dirname}/../../../`,
        process.env.LOG_FILES_DIRECTORY || 'log',
      ),
    );

    let deleted = 0;

    if (process.env.BACKUP_LOG_FILES_CLEAN_DAYS) {
      const files = fs.readdirSync(logDir, { withFileTypes: true });
      for await (const file of files) {
        if (
          file.name.match(
            new RegExp(`/(${process.env.LOG_FILES_PREFIX || ''})(\\d){8}/i`),
          )
        ) {
          const dtFile = DateTime.fromFormat(
            file.name.match(/(\d){8}/i)![0],
            'yyyyMMdd',
          );

          if (
            (await ReportLoaderCalendar.differenceInTradeDays(
              this.queryFactory,
              dateRef,
              dtFile,
              TCountryCode.BR,
            )) > parseInt(process.env.BACKUP_LOG_FILES_CLEAN_DAYS || '5')
          ) {
            fs.unlinkSync(path.join(logDir, file.name));
            deleted++;
          }
        }
      }
    }
    this.logger.silly(
      `[${this.processName}] - DateRef: ${dateRef.toFormat(
        'dd/MM/yyyy',
      )} - Log files cleaned: ${deleted}`,
    );
  }

  public async backupData(
    table: string,
    dateField: string,
    dateRef: DateTime,
    filterFields: IFilterField[] | undefined,
    orderFields: string[] | undefined,
  ): Promise<ILoadResult> {
    let sqlWhere =
      dateField && dateField.trim() !== ''
        ? ` WHERE "${dateField}"::DATE<='${dateRef.toFormat(
            'yyyy-MM-dd',
          )}'::DATE`
        : '';

    if (filterFields && filterFields?.length > 0) {
      if (sqlWhere === '') sqlWhere += ` WHERE `;
      filterFields.forEach(f => {
        sqlWhere += `"${f.field}"='${f.value}' AND `;
      });
      sqlWhere = sqlWhere.slice(0, ' AND '.length);
    }
    const inserted = parseInt(
      (
        await this.queryFactory.runQuery(
          `SELECT COUNT(*) as inserted FROM "${table}"${sqlWhere}`,
          {},
        )
      )[0].inserted,
    );

    return new Promise((resolve, reject) => {
      const pool = new Pool({
        connectionString: `postgresql://${process.env.DB_USER || 'dbuser'}:${
          process.env.DB_PASS || 'dbpass'
        }@${process.env.DB_HOST || 'dbhost'}:${process.env.DB_PORT || '3211'}/${
          process.env.DB_NAME || 'dbname'
        }`,
      });

      pool.connect((pgErr, client, done) => {
        if (pgErr) {
          reject(
            new Error(`BACKUP - Database connection error: ${pgErr.message}`),
          );
        }
        const fsBackup = fs.createWriteStream(
          `${process.env.TEMP_DATA_FILES_DIR || 'data'}/${
            process.env.BACKUP_FILE_PREFIX || ''
          }${table.toUpperCase()}_${dateRef.toFormat('yyyyMMdd')}.csv`,
        );

        fsBackup.on('ready', () => {
          sqlWhere =
            dateField && dateField.trim() !== ''
              ? ` WHERE "${dateField}"::DATE<='${dateRef.toFormat(
                  'yyyy-MM-dd',
                )}'::DATE`
              : '';

          if (filterFields && filterFields?.length > 0) {
            if (sqlWhere === '') {
              sqlWhere += ` WHERE `;
              filterFields.forEach(f => {
                sqlWhere += `"${f.field}"='${f.value}' AND `;
              });
              sqlWhere = sqlWhere.slice(0, ' AND '.length);
            } else {
              filterFields.forEach(f => {
                sqlWhere += ` AND "${f.field}"='${f.value}'`;
              });
            }
          }

          const sqlOrderBy =
            orderFields && orderFields.length > 0
              ? ` ORDER BY "${orderFields.join('" ASC, "')}" ASC`
              : '';

          const sql = `COPY (SELECT * FROM "${table}"${sqlWhere}${sqlOrderBy}) TO STDOUT With CSV DELIMITER '${
            process.env.BACKUP_DELIMITER || ','
          }' HEADER`;

          this.logger.silly(
            `[${this.processName}] - DateRef: ${dateRef.toFormat(
              'dd/MM/yyyy',
            )} - SQL backup query: ${sql}`,
          );
          const stream = client.query(pgCopyTo(sql));

          stream.pipe(fsBackup);

          stream.on('end', async () => {
            this.logger.silly(
              `[${this.processName}] - DateRef: ${dateRef.toFormat(
                'dd/MM/yyyy',
              )} - Backup completed for table [${table}] - Count: ${inserted}`,
            );
            fsBackup.close();
            done();
            resolve({
              inserted,
              deleted: 0,
            });
          });

          stream.on('error', error => {
            fsBackup.close();
            done();
            reject(
              new Error(
                `BACKUP - Backup error for table [${table}] DateRef: ${dateRef.toFormat(
                  'dd-MM-yyyy',
                )}: ${error}`,
              ),
            );
          });
        });
      });
    });
  }

  private async deleteDBData(
    table: string,
    dateField: string,
    dateRef: DateTime,
    filterFields: IFilterField[] | undefined,
  ): Promise<ILoadResult> {
    let deleted = '0';
    const aTableKeepDays = (process.env.BACKUP_TABLES_DELETE_KEEPDAYS || '')
      .split(',')
      .find(t => t.split(';')[0].trim().toUpperCase() === table.toUpperCase());
    const tableKeepDays =
      aTableKeepDays && aTableKeepDays.split(';').length === 2
        ? parseInt(aTableKeepDays.split(';')[1])
        : undefined;

    if (
      dateField &&
      dateField !== '' &&
      tableKeepDays &&
      tableKeepDays >=
        parseInt(process.env.BACKUP_TABLES_DELETE_KEEPDAYS_MINIMUM || '90')
    ) {
      const deleteBefore = dateRef.minus({ days: tableKeepDays });
      let sqlWhereDel = '';
      if (filterFields && filterFields?.length > 0) {
        filterFields.forEach(f => {
          sqlWhereDel += ` AND ${f.field}='${f.value}'`;
        });
      }
      const sqlDel = `DELETE FROM "${table}" WHERE "${dateField}"<=$1${sqlWhereDel}`;
      [, deleted] = await this.queryFactory.runQuery(sqlDel, {
        date: deleteBefore.startOf('day').toJSDate(),
      });
      await this.queryFactory.runQuery(`VACUUM(FULL) "${table}";`, {});
      this.logger.silly(
        `[${this.processName}] - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Table ${table} records cleaned: ${deleted}`,
      );
    }

    return { inserted: 0, deleted: parseInt(deleted) };
  }

  public static async compactSingleFile(
    pathFileName: string,
    zipFileName?: string,
  ): Promise<string> {
    if (!fs.existsSync(pathFileName))
      throw new Error(`File not found: ${pathFileName}`);

    return new Promise((resolve, reject) => {
      let pathZipFilename: string;
      if (zipFileName) {
        pathZipFilename = path.join(path.dirname(pathFileName), zipFileName);
      } else {
        pathZipFilename = path.join(
          path.dirname(pathFileName),
          `${path.basename(pathFileName, path.extname(pathFileName))}.zip`,
        );
      }
      const fsZipFile = fs.createWriteStream(pathZipFilename);
      const archive = archiver('zip', {
        zlib: {
          level: 9,
        },
      });
      fsZipFile.on('close', () => {
        resolve(pathZipFilename);
      });

      archive.on('error', err => {
        reject(err);
      });

      archive.pipe(fsZipFile);
      archive.file(pathFileName, { name: path.basename(pathFileName) });
      archive.finalize();
    });
  }

  public static async unzipFile(zipPathFilename: string): Promise<string[]> {
    const dir = await unzipper.Open.file(zipPathFilename);

    if (!dir) throw new Error(`Incompatible zip file: ${zipPathFilename}`);
    if (dir.files.length === 0)
      throw new Error(
        `Empty zip file: ${zipPathFilename} - ${JSON.stringify(
          dir.files.map(f => f.path),
        )}`,
      );

    await dir.extract({ path: path.dirname(zipPathFilename) });

    return dir.files
      .filter(f => f.type === 'File')
      .map(f =>
        path.join(path.dirname(zipPathFilename), path.basename(f.path)),
      );
  }

  public static async unzipFirstFileNamed(
    zipPathFilename: string,
    firstFilename: string,
  ): Promise<string> {
    const dir = await unzipper.Open.file(zipPathFilename);
    if (!dir || dir.files.length !== 1)
      throw new Error(`Incompatible zip file: ${JSON.stringify(dir.files)}`);

    const unzipFilePathName = path.join(
      path.dirname(zipPathFilename),
      firstFilename,
    );

    return new Promise((resolve, reject) => {
      dir.files[0]
        .stream()
        .pipe(fs.createWriteStream(unzipFilePathName))
        .on('close', () => resolve(unzipFilePathName))
        .on('error', error => reject(error));
    });
  }

  public static async unzipFileNamed(
    zipPathFilename: string,
    filename: string,
  ): Promise<string> {
    const dir = await unzipper.Open.file(zipPathFilename);
    if (!dir)
      throw new Error(
        `[UnzipFile] Can't find zipfile ${path.basename(zipPathFilename)}`,
      );

    const file = dir.files.find(f => path.basename(f.path) === filename);
    if (!file)
      throw new Error(
        `[UnzipFile] Can't find file ${filename} in zipfile ${path.basename(
          zipPathFilename,
        )}`,
      );

    const unzipFilePathName = path.join(
      path.dirname(zipPathFilename),
      filename,
    );

    return new Promise((resolve, reject) => {
      file
        .stream()
        .pipe(fs.createWriteStream(unzipFilePathName))
        .on('close', () => resolve(unzipFilePathName))
        .on('error', error => reject(error));
    });
  }

  public static async recoverBackup(
    tablename: string,
    dateRef: DateTime,
  ): Promise<ILoadResult> {
    const backupPathFilename = path.join(
      __dirname,
      process.env.TEMP_DATA_FILES_DIR || 'data',
      `${process.env.BACKUP_FILE_PREFIX || ''}${dateRef.toFormat(
        'yyyyMMdd',
      )}.zip`,
    );

    if (fs.existsSync(backupPathFilename))
      throw new Error(
        `[Backup Recovery] Can't recover backup while running backup process - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} `,
      );

    if (
      !(await BackupWorker.downloadFileCloud(
        backupPathFilename,
        process.env.BACKUP_DB_CLOUD_FOLDER || '',
      ))
    )
      return { inserted: -1, deleted: 0 };

    const filename = `${
      process.env.BACKUP_FILE_PREFIX || ''
    }${tablename.toUpperCase()}_${dateRef.toFormat('yyyyMMdd')}.csv`;

    const pathFilename = await BackupWorker.unzipFileNamed(
      backupPathFilename,
      filename,
    );

    return { inserted: 0, deleted: 0 };
  }
}

export default BackupWorker;
 */
