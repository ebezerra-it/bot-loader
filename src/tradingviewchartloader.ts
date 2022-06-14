/* eslint-disable import/newline-after-import */
/* eslint-disable import/first */
import dotenv from 'dotenv';
import { Logger } from 'tslog';
import { DateTime } from 'luxon';
dotenv.config();
import TelegramBot, { TUserType } from './bot/telegramBot';
import queryFactory from './db/queryFactory';
import ChartLoaderTradingView from './controllers/loaders/chartLoaderTradingView';
import GlobalParameters from './controllers/loaders/globalParameters';
import { TExchange } from './controllers/tcountry';

(async () => {
  await queryFactory.initialize(true);
  await GlobalParameters.init(queryFactory);
  const logger = new Logger();
  const bot = new TelegramBot(
    process.env.TELEGRAM_BOT_TOKEN || '',
    queryFactory,
    logger,
  );

  const chart = new ChartLoaderTradingView(
    'ChartLoaderTradingView',
    logger,
    queryFactory,
    TExchange.CME,
  );

  const msgStart = `TRADINGVIEW - ChartLoader STARTED - ${new Date()}`;
  await bot.sendMessageToUsers(TUserType.OWNER, msgStart, {});
  logger.info(msgStart);

  const res = await chart.process({ dateMatch: DateTime.now() });

  const msgEnd = `TRADINGVIEW - ChartLoader FINISHED: ${JSON.stringify(
    res,
  )} - ${new Date()}`;
  await bot.sendMessageToUsers(TUserType.OWNER, msgEnd, {});
  logger.info(msgEnd);

  // process.stdin.emit('SIGINT');
  process.kill(process.pid, 'SIGINT');
  process.exit(0);
})();
