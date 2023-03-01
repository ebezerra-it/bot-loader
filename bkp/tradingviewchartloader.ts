/* eslint-disable import/newline-after-import */
/* eslint-disable import/first */
/* import dotenv from 'dotenv';
import { Logger } from 'tslog';
import { DateTime } from 'luxon';
dotenv.config();
import TelegramBot from './bot/telegramBot';
import { TUserType } from './bot/baseBot';
import queryFactory from './db/queryFactory';
import ChartLoaderTradingView from './controllers/loaders/chartLoaderTradingView';
import GlobalParameters from './controllers/loaders/globalParameters';
import { TExchange } from './controllers/tcountry';

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

  const chart = new ChartLoaderTradingView(
    'ChartLoaderTradingView',
    logger,
    queryFactory,
    TExchange.CME,
  );

  const msgStart = `TRADINGVIEW - ChartLoader STARTED - ${new Date()}`;
  await bot.sendMessageToUsers(TUserType.OWNER, msgStart);
  logger.info(msgStart);

  const res = await chart.process({ dateMatch: DateTime.now() });

  const msgEnd = `TRADINGVIEW - ChartLoader FINISHED: ${JSON.stringify(
    res,
  )} - ${new Date()}`;
  await bot.sendMessageToUsers(TUserType.OWNER, msgEnd);
  logger.info(msgEnd);

  // process.stdin.emit('SIGINT');
  process.kill(process.pid, 'SIGINT');
  process.exit(0);
})();
 */
