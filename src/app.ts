/* eslint-disable no-restricted-syntax */
/* eslint-disable import/first */
import express from 'express';
import https from 'https';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import fs, { mkdirSync, existsSync } from 'fs';
import path from 'path';

dotenv.config(); // to avoid deprecated messages - NTBA_FIX
import MyLogger from './controllers/myLogger';
import TelegramBot from './bot/telegramBot';
import createConnection from './db';
import queryFactory from './db/queryFactory';
import GlobalParameters from './controllers/loaders/globalParameters';
import Loader from './loader';
import BotRoutes from './routes/botRoutes';
import LoadRoutes from './routes/loadRoutes';

const apiBot = express();
apiBot.use(bodyParser.urlencoded({ extended: false }));
apiBot.use(bodyParser.json());

const apiProfit = express();
apiProfit.use(bodyParser.urlencoded({ extended: false }));
apiProfit.use(bodyParser.json());

const logger = new MyLogger();

const port = parseInt(process.env.TELEGRAM_API_PORT || '8001');
let bot: TelegramBot;
let server: any;
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
      `[SERVICE ERROR] Can't create log directory: ${dirpath} due to error: ${err.message} `,
    );
    throw new Error(
      `[SERVICE ERROR] Can't create log directory: ${dirpath} due to error: ${err.message} `,
    );
  }

  try {
    dirpath = path.resolve(
      `${__dirname}/../${process.env.TEMP_DATA_FILES_DIR || 'data'}`,
    );
    if (!existsSync(dirpath)) mkdirSync(dirpath, { recursive: false });
  } catch (err) {
    logger.fatal(
      `[SERVICE ERROR] Can't create backup/data directory: ${dirpath} due to error: ${err.message} `,
    );
    throw new Error(
      `[SERVICE ERROR] Can't create backup/data directory: ${dirpath} due to error: ${err.message} `,
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
      `[SERVICE ERROR] BOT USER not found: ${
        process.env.TELEGRAM_BOT_USERNAME || 'MyOraculum_bot'
      }`,
    );
    throw new Error(
      `[SERVICE ERROR] BOT USER not found: ${
        process.env.TELEGRAM_BOT_USERNAME || 'MyOraculum_bot'
      }`,
    );
  }
  process.env.TELEGRAM_BOT_USER_ID = qUser[0].id;

  if (process.env.GLOBAL_PARAMETERS_RESET === 'TRUE')
    logger.info(`[SERVICE PARAMETERS] - Reseting parameters...`);

  await GlobalParameters.init(
    queryFactory,
    process.env.GLOBAL_PARAMETERS_RESET === 'TRUE',
  );
  await GlobalParameters.load(queryFactory);

  bot = new TelegramBot(
    process.env.TELEGRAM_BOT_TOKEN || '',
    queryFactory,
    logger,
  );

  apiBot.use(await new BotRoutes(queryFactory, logger, bot).getRouter());
  apiProfit.use(await new LoadRoutes(queryFactory, logger, bot).getRouter());
})()
  .catch(e => {
    logger.fatal(
      `[SERVICE ERROR] Service not started due to error: ${e.message}`,
    );
    throw e;
  })
  .then(async () => {
    const sslOptions = {
      key: fs.readFileSync(
        path.join(__dirname, '../cert/ssl', '/client.key'),
        'utf8',
      ),
      cert: fs.readFileSync(
        path.join(__dirname, '../cert/ssl', '/client.crt'),
        'utf8',
      ),
    };

    await new Promise((resolve, reject) =>
      https
        .createServer(sslOptions, apiProfit)
        .listen(Number(process.env.PROFIT_API_PORT || '8002'))
        .once('listening', resolve)
        .once('error', reject),
    );
    logger.info(
      `[SERVICE STARTED] - API PROFIT started and running on port ${Number(
        process.env.PROFIT_API_PORT || '8002',
      )}`,
    );

    await new Promise((resolve, reject) =>
      apiBot
        .listen(port, '0.0.0.0')
        .once('listening', resolve)
        .once('error', reject),
    );
    logger.info(`[SERVICE STARTED] - BOT started and running on port ${port}`);

    loader = new Loader(queryFactory, bot, logger);

    process.on('SIGINT', async errMsg => {
      const stopMsg =
        errMsg ||
        `[SERVICE STOPED] Service stoped due to: terminal <CTRL + C> command.`;
      logger.fatal(stopMsg);

      try {
        if (loader.isRunning) loader.stop(stopMsg);
        process.kill(process.pid, 'SIGINT');
        process.exit(errMsg ? 1 : 0);
      } catch (err) {
        logger.fatal(
          `[SERVICE ERROR] An error occurred when trying to stop service: ${err.message}`,
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
    if (!botOnly) {
      await loader.start();

      loader.taskManager.on('stoped', async msg => {
        await bot.stopPolling({
          cancel: true,
          reason: `[BOT] polling stoped due to: ${msg}`,
        });

        server.close();
        process.kill(process.pid, 'SIGINT');
        process.exit(0);
      });
    }
  });
