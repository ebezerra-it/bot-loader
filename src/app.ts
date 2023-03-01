/* eslint-disable no-restricted-syntax */
/* eslint-disable import/first */
import { Server } from 'https';
import dotenv from 'dotenv';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';

dotenv.config(); // to avoid deprecated messages - NTBA_FIX
import MyLogger from './controllers/myLogger';
import TelegramBot from './bot/telegramBot';
import createConnection from './db';
import queryFactory from './db/queryFactory';
import GlobalParameters from './controllers/loaders/globalParameters';
import Loader from './loader';

const logger = new MyLogger();

let bot: TelegramBot;
let server: Server;
let loader: Loader;

(async () => {
  // Create required directories
  let dirpath = '';
  try {
    dirpath = path.resolve(
      `${__dirname}/../${process.env.LOG_FILES_DIRECTORY || 'log'}`,
    );
    if (!existsSync(dirpath)) mkdirSync(dirpath, { recursive: false });
  } catch (err) {
    logger.fatal(
      `[MyOraculum] Can't create log directory: ${dirpath} due to error: ${err.message} `,
    );
    throw new Error(
      `[MyOraculum] Can't create log directory: ${dirpath} due to error: ${err.message} `,
    );
  }

  try {
    dirpath = path.resolve(
      `${__dirname}/../${process.env.TEMP_DATA_FILES_DIR || 'data'}`,
    );
    if (!existsSync(dirpath)) mkdirSync(dirpath, { recursive: false });
  } catch (err) {
    logger.fatal(
      `[MyOraculum] Can't create backup/data directory: ${dirpath} due to error: ${err.message} `,
    );
    throw new Error(
      `[MyOraculum] Can't create backup/data directory: ${dirpath} due to error: ${err.message} `,
    );
  }

  // Initialization
  await createConnection();
  await queryFactory.initialize();
  const qUser = await queryFactory.runQuery(
    `SELECT id FROM "users" WHERE name=$1`,
    {
      name: process.env.TELEGRAM_BOT_USERNAME || 'MyOraculum_bot',
    },
  );
  if (!qUser || qUser.length < 1) {
    logger.fatal(
      `[MyOraculum] BOT USER not found: ${
        process.env.TELEGRAM_BOT_USERNAME || 'MyOraculum_bot'
      }`,
    );
    throw new Error(
      `[MyOraculum] BOT USER not found: ${
        process.env.TELEGRAM_BOT_USERNAME || 'MyOraculum_bot'
      }`,
    );
  }
  process.env.TELEGRAM_BOT_USER_ID = qUser[0].id;

  if (process.env.GLOBAL_PARAMETERS_RESET === 'TRUE')
    logger.info(`[MyOraculum] Reseting parameters...`);

  await GlobalParameters.init(
    queryFactory,
    process.env.GLOBAL_PARAMETERS_RESET === 'TRUE',
  );
  await GlobalParameters.load(queryFactory);

  bot = new TelegramBot(queryFactory, logger, {
    BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || '',
    MAX_MESSAGE_SIZE: process.env.TELEGRAM_MAX_MESSAGE_SIZE
      ? Number(process.env.TELEGRAM_MAX_MESSAGE_SIZE)
      : undefined,
    BOT_API_PORT: Number(process.env.TELEGRAM_API_PORT || '8001'),
  });
  await bot.start();
})()
  .catch(e => {
    logger.fatal(`[MyOraculum] Service not started due to error: ${e.message}`);
    throw e;
  })
  .then(async () => {
    loader = new Loader(queryFactory, bot, logger);

    process.on('SIGINT', async errMsg => {
      const stopMsg =
        errMsg ||
        `[MyOraculum] Service stoped due to: terminal <CTRL + C> command.`;
      logger.fatal(stopMsg);

      try {
        if (loader.isRunning) loader.stop(stopMsg);
        process.kill(process.pid, 'SIGINT');
        process.exit(errMsg ? 1 : 0);
      } catch (err) {
        logger.fatal(
          `[MyOraculum] An error occurred when trying to stop service: ${err.message}`,
        );
        process.kill(process.pid, 'SIGINT');
        process.exit(1);
      }
    });
    process.on('SIGTERM', errMsg => {
      process.stdin.emit('SIGINT', errMsg);
      process.exit(errMsg ? 1 : 0);
    });

    const args: string[] = process.argv.slice(2);
    let botOnly = false;
    for (const arg of args) {
      botOnly = !!(arg.trim().toUpperCase() === 'BOT-ONLY');
      if (botOnly) break;
    }
    if (botOnly) {
      logger.warn(`[MyOraculum BOT-ONLY] Bot is now waiting for commands...`);
    } else {
      await loader.start();

      loader.taskManager.on('stoped', () => {
        bot.stop();

        server.close();
        process.kill(process.pid, 'SIGINT');
        process.exit(0);
      });
    }
  });
