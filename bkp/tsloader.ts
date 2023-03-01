/* eslint-disable import/newline-after-import */
/* eslint-disable import/first */
/* import dotenv from 'dotenv';
import { Logger } from 'tslog';
import { DateTime } from 'luxon';
dotenv.config();
import TelegramBot from './bot/telegramBot';
import { TUserType } from './bot/baseBot';
import queryFactory from './db/queryFactory';
import TimesAndSalesB3 from './controllers/loaders/timesAndSalesB3';
import GlobalParameters from './controllers/loaders/globalParameters';
import { TExchange } from './controllers/tcountry';

(async () => {
  await queryFactory.initialize(true);
  await GlobalParameters.init(queryFactory, true);
  const logger = new Logger();
  const bot = new TelegramBot(queryFactory, logger, {
    BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || '',
    MAX_MESSAGE_SIZE: process.env.TELEGRAM_MAX_MESSAGE_SIZE
      ? Number(process.env.TELEGRAM_MAX_MESSAGE_SIZE)
      : undefined,
  });

  process.env.B3_TIMESNSALES_ASSETS_REGEX = '';
  const ts = new TimesAndSalesB3(
    'TimesNSalesB3',
    logger,
    queryFactory,
    TExchange.B3,
  );

  const dates = [
    DateTime.fromFormat('12/05/2022', 'dd/MM/yyyy'),
    DateTime.fromFormat('13/05/2022', 'dd/MM/yyyy'),
    DateTime.fromFormat('16/05/2022', 'dd/MM/yyyy'),
    DateTime.fromFormat('17/05/2022', 'dd/MM/yyyy'),
    DateTime.fromFormat('18/05/2022', 'dd/MM/yyyy'),
  ];

  // eslint-disable-next-line no-restricted-syntax
  for await (const dt of dates) {
    const msgStart = `B3 - ${dt.toFormat(
      'dd/MM/yyyy',
    )} TIMES AND SALES STARTED - ${new Date()}`;
    await bot.sendMessageToUsers(TUserType.OWNER, msgStart);
    logger.info(msgStart);

    const res = await ts.process({ dateRef: dt });

    const msgEnd = `B3 - ${dt.toFormat(
      'dd/MM/yyyy',
    )} TIMES AND SALES FINISHED: ${JSON.stringify(res)} - ${new Date()}`;
    await bot.sendMessageToUsers(TUserType.OWNER, msgEnd);
    logger.info(msgEnd);
  }
  // process.stdin.emit('SIGINT');
  process.kill(process.pid, 'SIGINT');
  process.exit(0);
})();
 */
