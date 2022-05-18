/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
/* eslint-disable import/newline-after-import */
/* eslint-disable import/first */
import dotenv from 'dotenv';
import { Logger } from 'tslog';
import path from 'path';
import { DateTime } from 'luxon';
dotenv.config();
import TelegramBot, { TUserType } from './bot/telegramBot';
import queryFactory from './db/queryFactory';
import GlobalParameters from './controllers/loaders/globalParameters';
import CloudFileManager from './controllers/cloudFileManager';

(async () => {
  await queryFactory.initialize(true);
  await GlobalParameters.init(queryFactory);
  const logger = new Logger();
  const bot = new TelegramBot(
    process.env.TELEGRAM_BOT_TOKEN || '',
    queryFactory,
    logger,
  );
  const cloud = new CloudFileManager();
  const newCloud = new CloudFileManager(true);

  logger.info(`CloudTransfer started: ${new Date()}`);

  const query = cloud.gdrive
    .query()
    .setFileOnly()
    .setOrderBy('name')
    .inFolder(process.env.B3_TIMESNSALES_REMOTE_FOLDER || '')
    .setPageSize(300);

  let count = 0;
  if (query.hasNextPage()) {
    const files = await query.run();

    for await (const file of files) {
      const filenameMatch = file.name.match(/TS_FULL_(\d\d\d\d\d\d\d\d).zip/);
      if (!filenameMatch) continue;
      if (
        DateTime.fromFormat(filenameMatch[1], 'yyyyMMdd') <=
        DateTime.fromFormat('20220207', 'yyyyMMdd')
      )
        continue;

      const pathFile = path.join(
        __dirname,
        '../',
        process.env.TEMP_DATA_FILES_DIR || '',
        file.name,
      );
      if (
        await cloud.downloadFileCloud(
          pathFile,
          process.env.B3_TIMESNSALES_REMOTE_FOLDER || '',
        )
      ) {
        await newCloud.uploadFileCloud(
          pathFile,
          process.env.B3_TIMESNSALES_REMOTE_FOLDER_NEW || '',
          false,
          false,
        );
        // fs.unlinkSync(pathFile);
        logger.info(
          `${++count}/${files.length} - File ${path.basename(
            pathFile,
          )} uploaded to new cloud`,
        );
      }
    }
  }
  logger.info(
    `CloudTransfer ended - Files uploaded: ${count} => ${new Date()}`,
  );
  await bot.sendMessageToUsers(
    TUserType.OWNER,
    `CloudTransfer ended - Files uploaded: ${count} => ${new Date()}`,
    {},
  );

  // process.stdin.emit('SIGINT');
  process.kill(process.pid, 'SIGINT');
  process.exit(0);
})();
