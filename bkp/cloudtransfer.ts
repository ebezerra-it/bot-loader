/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
/* eslint-disable import/newline-after-import */
/* eslint-disable import/first */

/* import dotenv from 'dotenv';
import { Logger } from 'tslog';
import path from 'path';
import { DateTime } from 'luxon';
import fs from 'fs';
dotenv.config();
import TelegramBot from './bot/telegramBot';
import { TUserType } from './bot/baseBot';
import queryFactory from './db/queryFactory';
import GlobalParameters from './controllers/loaders/globalParameters';
import CloudFileManager from './controllers/cloudFileManager';

(async () => {
  await queryFactory.initialize(true);
  await GlobalParameters.init(queryFactory);
  const logger = new Logger();
  const bot = new TelegramBot(queryFactory, logger, {
    BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || '',
    MAX_MESSAGE_SIZE: process.env.TELEGRAM_MAX_MESSAGE_SIZE
      ? Number(process.env.TELEGRAM_MAX_MESSAGE_SIZE)
      : undefined,
  });
  const cloud = new CloudFileManager();
  const oldCloud = new CloudFileManager(true);

  logger.info(`CloudTransfer started: ${new Date()}`);

  const query = oldCloud.gdrive
    .query()
    .setFileOnly()
    .setOrderBy('name')
    .inFolder(process.env.B3_TIMESNSALES_REMOTE_FOLDER_OLD || '')
    .setPageSize(300);

  let count = 0;
  if (query.hasNextPage()) {
    const files = await query.run();

    for await (const file of files) {
      const filenameMatch = file.name.match(/TS_FULL_(\d\d\d\d\d\d\d\d).zip/);
      if (
        !filenameMatch ||
        !DateTime.fromFormat(filenameMatch[1], 'yyyyMMdd').isValid ||
        DateTime.fromFormat(filenameMatch[1], 'yyyyMMdd').toMillis() >=
          DateTime.fromFormat('20220512', 'yyyyMMdd').toMillis() ||
        DateTime.fromFormat(filenameMatch[1], 'yyyyMMdd').toMillis() <=
          DateTime.fromFormat('20211129', 'yyyyMMdd').toMillis()
      )
        continue;

      const pathFile = path.join(
        __dirname,
        '../',
        process.env.TEMP_DATA_FILES_DIR || '',
        file.name,
      );
      if (
        await oldCloud.downloadFileCloud(
          pathFile,
          process.env.B3_TIMESNSALES_REMOTE_FOLDER_OLD || '',
        )
      ) {
        await cloud.uploadFileCloud(
          pathFile,
          process.env.B3_TIMESNSALES_REMOTE_FOLDER || '',
          false,
          false,
        );
        fs.unlinkSync(pathFile);
        logger.info(
          `${++count}/${files.length} - File ${path.basename(
            pathFile,
          )} uploaded to the new cloud`,
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
  );

  // process.stdin.emit('SIGINT');
  process.kill(process.pid, 'SIGINT');
  process.exit(0);
})();
 */
