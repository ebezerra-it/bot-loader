/* eslint-disable no-restricted-syntax */
import { DateTime } from 'luxon';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import CloudFileManager from '../cloudFileManager';
import { TCountryCode } from '../tcountry';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import ReportLoader, { ILoadResult } from '../reportLoader';
import { TUserType } from '../../bot/baseBot';
import { TLoadStatus } from '../task';

export default class BackupRestoreDB extends ReportLoader {
  public async process(params: {
    dateRef: DateTime;
    restoreTable?: string;
  }): Promise<ILoadResult> {
    this.logger.info(
      `[${this.processName}] Process started: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )}${
        params.restoreTable ? ` - Restore table: ${params.restoreTable}` : ''
      }`,
    );

    const cloudManager = new CloudFileManager();

    const backupPathFileName = path.join(
      __dirname,
      '../../../',
      process.env.TEMP_DATA_FILES_DIR || 'data',
      `${process.env.BACKUP_FILE_PREFIX || ''}${params.dateRef.toFormat(
        'yyyyMMdd',
      )}.zip`,
    );
    if (fs.existsSync(backupPathFileName)) fs.unlinkSync(backupPathFileName);

    if (params.restoreTable) {
      await this.retry({
        action: 'BKP_CLOUD_DOWNLOAD',
        cloudManager,
        pathFileName: backupPathFileName,
      });

      process.env.RESTOREDB = 'TRUE'; // used to stop user bot control

      await this.sendBotMsgToUsers({
        userType: TUserType.DEFAULT,
        message: `[Service OFFLINE] Database restore procedure in progress and service is OFFLINE. Please, wait...`,
      });

      await this.sleep(30);

      await BackupRestoreDB.restoreDataBase(
        backupPathFileName,
        params.restoreTable,
      );
      if (fs.existsSync(backupPathFileName)) fs.unlinkSync(backupPathFileName);

      delete process.env.RESTOREDB;

      await this.sendBotMsgToUsers({
        userType: TUserType.DEFAULT,
        message: `[Service ONLINE] Database restore procedure finished and service is now ONLINE!`,
      });

      this.logger.warn(
        `[${this.processName}] Database restored: ${params.dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Table: ${params.restoreTable}`,
      );

      return { inserted: 1, deleted: 1 };
    }

    if (
      String(process.env.BACKUP_WAIT_FOR_DEPENDECY_LIST).toUpperCase() ===
      'TRUE'
    ) {
      const dependencyList = String(process.env.BACKUP_PROCESS_DEPENDECY_LIST)
        .split(',')
        .map(p => p.trim().toUpperCase());

      if (dependencyList && dependencyList.length > 0) {
        const qProcess = await this.queryFactory.runQuery(
          `SELECT DISTINCT process FROM "loadcontrol" WHERE "date-ref"::DATE=$1::DATE AND status=$2`,
          {
            dateRef: params.dateRef.toJSDate(),
            status: TLoadStatus.DONE,
          },
        );

        let allDependenciesDone = true;
        const waitingProcess: string[] = [];

        dependencyList.forEach(d => {
          if (
            !qProcess.find((p: any) => String(p.process).toUpperCase() === d)
          ) {
            allDependenciesDone = false;
            waitingProcess.push(d);
          }
        });

        if (!allDependenciesDone) {
          this.logger.warn(
            `[${
              this.processName
            }] Process won't initiate due to pending process: ${waitingProcess.join(
              ', ',
            )}.`,
          );
          return { inserted: 0, deleted: 0 };
        }
      }
    }

    await BackupRestoreDB.backupDataBase(backupPathFileName);
    await this.retry({
      action: 'BKP_CLOUD_UPLOAD',
      cloudManager,
      pathFileName: backupPathFileName,
    });
    if (fs.existsSync(backupPathFileName)) fs.unlinkSync(backupPathFileName);
    await this.cleanCloudBackupFiles(cloudManager, params.dateRef);

    const pathLogFileName = await this.compactLogFile(params.dateRef);

    if (pathLogFileName) {
      await this.retry({
        action: 'LOG_CLOUD_UPLOAD',
        cloudManager,
        pathFileName: pathLogFileName,
      });
      if (fs.existsSync(pathLogFileName)) fs.unlinkSync(pathLogFileName);
      await this.cleanLogFiles(params.dateRef);
    }

    return { inserted: 1, deleted: 0 };
  }

  public static async backupDataBase(
    backupPathFileName: string,
  ): Promise<void> {
    process.env.PGPASSWORD = process.env.DB_PASS;

    // pg_restore only works with dump file created in custom format: --format=c
    execSync(
      `pg_dump --host=${process.env.DB_HOST} --port=${process.env.DB_PORT} --username=${process.env.DB_USER} --no-password --dbname=${process.env.DB_NAME} --format=c | pigz -9 > ${backupPathFileName}`,
    );

    process.env.PGPASSWORD = undefined;

    if (!fs.existsSync(backupPathFileName)) {
      throw new Error(
        `[BackupDatabase] PG_DUMP process didn't create backup zip file: ${backupPathFileName}`,
      );
    }
  }

  public static async restoreDataBase(
    backupPathFileName: string,
    restoreTable?: string,
  ): Promise<void> {
    process.env.PGUSER = process.env.DB_USER;
    process.env.PGPASSWORD = process.env.DB_PASS;

    execSync(
      `unpigz -c ${backupPathFileName} | pg_restore --exit-on-error --single-transaction --host=${
        process.env.DB_HOST
      } --port=${process.env.DB_PORT} --clean --if-exists --no-owner --role=${
        process.env.DB_USER
      } --no-password --dbname=${process.env.DB_NAME}${
        restoreTable && restoreTable.toUpperCase() !== 'ALL'
          ? ` --table=${restoreTable}`
          : ''
      }`,
    );

    process.env.PGUSER = undefined;
    process.env.PGPASSWORD = undefined;
  }

  public async performQuery(params: {
    action: string;
    cloudManager: CloudFileManager;
    pathFileName: string;
  }): Promise<boolean> {
    if (params.action === 'BKP_CLOUD_DOWNLOAD') {
      if (
        !(await params.cloudManager.fileExistsInCloudPool(
          path.basename(params.pathFileName),
          process.env.BACKUP_DB_CLOUD_FOLDER || '',
        ))
      ) {
        this.logger.warn(`Backup file not found in cloud`);
        return false;
      }

      await params.cloudManager.downloadFileCloudPool(
        params.pathFileName,
        process.env.BACKUP_DB_CLOUD_FOLDER || '',
      );
      return true;
    }
    if (params.action === 'BKP_CLOUD_UPLOAD') {
      await params.cloudManager.uploadFileCloudPool(
        params.pathFileName,
        process.env.BACKUP_DB_CLOUD_FOLDER || '',
        false,
        false,
      );
      return true;
    }
    if (params.action === 'LOG_CLOUD_UPLOAD') {
      await params.cloudManager.uploadFileCloudPool(
        params.pathFileName,
        process.env.BACKUP_LOG_CLOUD_FOLDER || '',
        true,
        true,
      );
      return true;
    }
    throw new Error(
      `[${this.processName}] performQuery() - Wrong action parameter`,
    );
  }

  private async compactLogFile(dateRef: DateTime): Promise<string | undefined> {
    const logPathFileName = path.join(
      __dirname,
      '../../../',
      process.env.LOG_FILES_DIRECTORY || 'log',
      `${process.env.LOG_FILES_PREFIX || ''}${dateRef.toFormat(
        'yyyyMMdd',
      )}.log`,
    );

    if (!fs.existsSync(logPathFileName)) return undefined;

    execSync(`pigz -9 --keep ${logPathFileName}`);

    return logPathFileName;
  }

  private async cleanLogFiles(dateRef: DateTime): Promise<void> {
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

  private async cleanCloudBackupFiles(
    cloudManager: CloudFileManager,
    dateRef: DateTime,
  ): Promise<number> {
    const backupFolder = process.env.BACKUP_DB_CLOUD_FOLDER || 'DB Backup';

    const zipFilename = `${
      process.env.BACKUP_FILE_PREFIX || ''
    }${dateRef.toFormat('yyyyMMdd')}.zip`;

    const cloud = cloudManager.cloudPool[cloudManager.cloudPool.length - 1];
    const backupFolderId = await CloudFileManager.getFolderId(
      cloud,
      backupFolder,
    );
    if (!backupFolderId)
      throw new Error(
        `[${this.processName}] CleanCloudBackupfiles() - Missing backup folder in cloud: ${backupFolder}`,
      );

    let found = false;
    let query = cloud
      .query()
      .setFileOnly()
      .inFolder(backupFolderId)
      .setNameEqual(zipFilename)
      .setOrderBy('name');

    if (query.hasNextPage()) {
      const files = await query.run();
      if (files.length > 0) found = true;
    }

    let deleted = 0;
    if (found) {
      const filesToDelete: { dtFile: DateTime; file: any }[] = [];
      query = cloud.query().setFileOnly().inFolder(backupFolderId);

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
          try {
            await filesToDelete[i].file.delete();
            deleted++;
            this.logger.silly(
              `[${this.processName}] Cloud backup file deleted: ${filesToDelete[i].file.name}`,
            );
          } catch (err) {
            this.logger.error(
              `[${this.processName}] Cloud backup file ${filesToDelete[i].file.name} couldn't be deleted due to error: ${err.message}`,
            );
          }
        }
      }
    }
    return deleted;
  }
}
