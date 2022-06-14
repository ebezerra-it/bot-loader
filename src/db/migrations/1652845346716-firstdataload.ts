/* eslint-disable prefer-destructuring */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-nested-ternary */
import { MigrationInterface, QueryRunner } from 'typeorm';
import { DateTime } from 'luxon';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import childprocess from 'child_process';
import MyLogger from '../../controllers/myLogger';
import { QueryFactory } from '../queryFactory';
import GlobalParameters from '../../controllers/loaders/globalParameters';
import { TUserType } from '../../bot/telegramBot';
import DataFileLoader, {
  LAYOUT_PROFIT_ROLLING_TT,
  LAYOUT_PROFIT_1M,
  LAYOUT_PROFIT_FRP,
  LAYOUT_HOLIDAYS_CAL,
} from '../../controllers/loaders/dataFileLoader';
import CloudFileManager from '../../controllers/cloudFileManager';
import ZipFileManager from '../../controllers/zipFileManager';
import BackupRestoreDB from '../../controllers/loaders/backupRestoreDB';
import { TDataOrigin } from './1634260181468-tbl_b3_ts_summary';

export default class firstdataload1652845346716 implements MigrationInterface {
  private async createDirectory(dir: string | undefined): Promise<void> {
    if (!dir || dir.trim() === '')
      throw new Error(`[SERVICE ERROR] Can't create empty directory`);

    const pathDir = path.resolve(__dirname, '../../../', dir);
    try {
      if (!fs.existsSync(pathDir)) fs.mkdirSync(pathDir, { recursive: false });
      else {
        childprocess.execSync(`rm -rf ${pathDir}/*`);
      }
    } catch (err) {
      throw new Error(
        `[SERVICE ERROR] Can't create directory: ${pathDir} due to error: ${err.message} `,
      );
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    dotenv.config();
    await this.createDirectory(process.env.LOG_FILES_DIRECTORY);
    await this.createDirectory(process.env.TEMP_DATA_FILES_DIR);
    await this.createDirectory(process.env.PROFIT_FILES_DIR);

    const logger = new MyLogger(false);

    const queryFactory = new QueryFactory();
    await queryFactory.initialize(false);

    logger.info(`[First data loading] Loading global parameters table`);
    await GlobalParameters.init(queryFactory, true);

    // download and restore last db backup, if exists
    const query = CloudFileManager.getTsGoogleDrive()
      .query()
      .setFileOnly()
      .inFolder(process.env.BACKUP_DB_CLOUD_FOLDER || '')
      .setPageSize(300)
      .setOrderBy('name');
    if (query.hasNextPage()) {
      const files = await query.run();
      if (files) {
        const bkpFilePathName = path.join(
          __dirname,
          '../../../',
          process.env.TEMP_DATA_FILES_DIR || '',
          files[files.length - 1].name,
        );
        fs.writeFileSync(
          bkpFilePathName,
          await files[files.length - 1].download(),
        );

        logger.info(
          `[BackupRestoreDB] Restoring database from backup file: ${path.basename(
            bkpFilePathName,
          )}`,
        );
        await BackupRestoreDB.restoreDataBase(bkpFilePathName);

        logger.info(
          `[BackupRestoreDB] Database SUCCESSFULLY restored from backup file: ${path.basename(
            bkpFilePathName,
          )}`,
        );
        fs.unlinkSync(bkpFilePathName);

        return;
      }
    }

    // if no backup file found in cloud, load data from profit files
    const pool: Pool = new Pool({
      connectionString: `postgresql://${process.env.DB_USER || 'dbuser'}:${
        process.env.DB_PASS || 'dbpass'
      }@${process.env.DB_HOST || 'dbhost'}:${process.env.DB_PORT || '3211'}/${
        process.env.DB_NAME || 'dbname'
      }`,
    });

    logger.info(`[First data loading] Loading users table`);
    await pool.query(`TRUNCATE TABLE "users" CASCADE`);
    await pool.query(`VACUUM(FULL) "users"`);

    await queryRunner.query(
      `INSERT INTO "users" (name, username, type, email, active) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        process.env.TELEGRAM_BOT_USERNAME || 'MyOraculum_bot',
        process.env.TELEGRAM_BOT_USERNAME || 'MyOraculum_bot',
        TUserType.OWNER,
        process.env.GOOGLE_EMAIL || 'myoraculum@gmail.com',
        true,
      ],
    );

    await queryRunner.query(
      `INSERT INTO "users" (name, username, type, email, active) VALUES ($1, $2, $3, $4, $5)`,
      [
        'Eduardo Bulhões',
        'edubbulhoes',
        TUserType.OWNER,
        'ebezerra.it@gmail.com',
        true,
      ],
    );

    const fileLoader = new DataFileLoader(pool);

    const pathProfitDir = path.resolve(
      __dirname,
      '../../../',
      process.env.PROFIT_FILES_DIR || 'profit',
    );

    const pathProfitZip = path.join(pathProfitDir, 'MP_FIRST_DATA_LOAD.zip');
    await CloudFileManager.downloadFileCloud(
      CloudFileManager.getTsGoogleDrive(),
      pathProfitZip,
      process.env.REMOTE_PROFITDATA_FOLDER || '',
    );
    await ZipFileManager.unzipFile(pathProfitZip);

    const files = fs.readdirSync(pathProfitDir, {
      withFileTypes: true,
    });
    if (!files || files.length === 0)
      throw new Error(
        `[Profit data loading] No files found. Empty directory: ${pathProfitDir}`,
      );

    // certify all data tables are clean for first load
    await pool.query(`TRUNCATE TABLE "holiday-calendar"`);
    await pool.query(`VACUUM(FULL) "holiday-calendar"`);

    await pool.query(`TRUNCATE TABLE "b3-ts-summary"`);
    await pool.query(`VACUUM(FULL) "b3-ts-summary"`);

    await pool.query(`TRUNCATE TABLE "b3-rollingtrades"`);
    await pool.query(`VACUUM(FULL) "b3-rollingtrades"`);

    // HOLIDAYS.CAL file
    if (!fs.existsSync(path.join(pathProfitDir, 'HOLIDAYS.CAL')))
      throw new Error(`HOLIDAYS.CAL file not found in dir: ${pathProfitDir}`);
    else {
      LAYOUT_HOLIDAYS_CAL.fields.find(
        f => f.dbColumn === 'updated-at',
      )!.fixedValue = DateTime.now();

      const inserted = await fileLoader.loadFile(
        path.join(pathProfitDir, 'HOLIDAYS.CAL'),
        LAYOUT_HOLIDAYS_CAL,
        {},
      );

      logger.info(
        `[First data loading] File HOLIDAYS.CAL - Records loaded: ${inserted}`,
      );
    }

    // .frp files
    let totalRecords = 0;
    let qttyLoadedfrp = 0;
    for await (const file of files) {
      const match = new RegExp(/^(FRP0|FRP1)\.frp$/gi).exec(file.name);
      if (match && match.length > 0) {
        logger.info(`[First data loading] Loading file ${file.name}`);
        const inserted = await fileLoader.loadFile(
          path.join(pathProfitDir, file.name),
          LAYOUT_PROFIT_FRP,
          {},
        );
        logger.info(
          `[First data loading] File ${file.name} - Records loaded: ${inserted}`,
        );
        totalRecords += inserted;
        qttyLoadedfrp++;
      }
    }
    logger.info(
      `[First data loading] Total .frp files loaded: ${qttyLoadedfrp}`,
    );
    logger.info(
      `[First data loading] Total .frp records loaded: ${totalRecords}`,
    );

    // .1m files
    totalRecords = 0;
    let qttyLoaded1m = 0;
    for await (const file of files) {
      const match = new RegExp(
        /^(DOL|WDO|IND|WIN)([FGHJKMNQUVXZ][0-9]{2})\.1m$/gi,
      ).exec(file.name);
      if (match && match.length > 0) {
        const financialVolumeDivisor =
          match[1] === 'DOL'
            ? 50
            : match[1] === 'WDO'
            ? 10
            : match[1] === 'IND'
            ? 1
            : 0.2; // WIN

        LAYOUT_PROFIT_1M.fields.find(
          f => f.dbColumn === 'asset',
        )!.fixedValue = `${match[1]}${match[2]}`;

        logger.info(`[First data loading] Loading file ${file.name}`);
        const inserted = await fileLoader.loadFile(
          path.join(pathProfitDir, file.name),
          LAYOUT_PROFIT_1M,
          {
            filename: path.join(pathProfitDir, file.name),
            financialVolumeDivisor,
          },
        );
        logger.info(
          `[First data loading] File ${file.name} - Records loaded: ${inserted}`,
        );
        totalRecords += inserted;
        qttyLoaded1m++;
      }
    }
    logger.info(`[First data loading] Total .1m files loaded: ${qttyLoaded1m}`);
    logger.info(
      `[First data loading] Total .1m records loaded: ${totalRecords}`,
    );

    // Rolling .tt files
    totalRecords = 0;
    let qttyLoadedtt = 0;
    for await (const file of files) {
      const match = new RegExp(
        /^(DR1|WD1|IR1|WI1)([FGHJKMNQUVXZ][0-9]{2})([FGHJKMNQUVXZ][0-9]{2})(\.tt)$/gi,
      ).exec(file.name);
      if (match && match.length > 0) {
        const assetCode =
          match[1] === 'DR1'
            ? 'DOL'
            : match[1] === 'WD1'
            ? 'WDO'
            : match[1] === 'IR1'
            ? 'IND'
            : 'WIN';

        LAYOUT_PROFIT_ROLLING_TT.fields.find(
          f => f.dbColumn === 'asset-code',
        )!.fixedValue = assetCode;
        LAYOUT_PROFIT_ROLLING_TT.fields.find(
          f => f.dbColumn === 'contract-from',
        )!.fixedValue = match[2];
        LAYOUT_PROFIT_ROLLING_TT.fields.find(
          f => f.dbColumn === 'contract-to',
        )!.fixedValue = match[3];

        logger.info(`[First data loading] Loading file ${file.name}`);
        const inserted = await fileLoader.loadFile(
          path.join(pathProfitDir, file.name),
          LAYOUT_PROFIT_ROLLING_TT,
          {
            filename: path.join(pathProfitDir, file.name),
          },
        );
        logger.info(
          `[First data loading] File ${file.name} - Records loaded: ${inserted}`,
        );
        qttyLoadedtt++;
        totalRecords += inserted;
      }
    }
    logger.info(`[First data loading] Total .tt files loaded: ${qttyLoadedtt}`);
    logger.info(
      `[First data loading] Total .tt records loaded: ${totalRecords}`,
    );

    // clean profit folder
    fs.rmSync(pathProfitDir, { recursive: true, force: true });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "b3-rollingtrades" WHERE origin=${TDataOrigin.PROFIT_LOADER}`,
    );
    await queryRunner.query(`VACUUM(FULL) "b3-rollingtrades"`);

    await queryRunner.query(
      `DELETE FROM "b3-ts-summary" WHERE origin=${TDataOrigin.PROFIT_LOADER}`,
    );
    await queryRunner.query(`VACUUM(FULL) "b3-ts-summary"`);
  }
}
