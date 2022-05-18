/* eslint-disable import/newline-after-import */
/* eslint-disable import/first */
import dotenv from 'dotenv';
import { Logger } from 'tslog';
import { DateTime } from 'luxon';
dotenv.config();
import TelegramBot, { TUserType } from './bot/telegramBot';
import queryFactory from './db/queryFactory';
import TimesAndSalesB3 from './controllers/loaders/timesAndSalesB3';
import GlobalParameters from './controllers/loaders/globalParameters';
import { TExchange } from './controllers/tcountry';

(async () => {
  await queryFactory.initialize(true);
  await GlobalParameters.load(queryFactory);
  const logger = new Logger();
  const bot = new TelegramBot(
    process.env.TELEGRAM_BOT_TOKEN || '',
    queryFactory,
    logger,
  );

  process.env.B3_TIMESNSALES_ASSETS_REGEX = '';
  const ts = new TimesAndSalesB3(
    'TimesNSalesB3',
    logger,
    queryFactory,
    TExchange.B3,
  );

  const dates = [
    DateTime.fromFormat('26/04/2022', 'dd/MM/yyyy'),
    DateTime.fromFormat('27/04/2022', 'dd/MM/yyyy'),
    DateTime.fromFormat('28/04/2022', 'dd/MM/yyyy'),
    DateTime.fromFormat('29/04/2022', 'dd/MM/yyyy'),
  ];

  // eslint-disable-next-line no-restricted-syntax
  for await (const dt of dates) {
    const msgStart = `B3 - ${dt.toFormat(
      'dd/MM/yyyy',
    )} TIMES AND SALES STARTED - ${new Date()}`;
    await bot.sendMessageToUsers(TUserType.OWNER, msgStart, {});
    logger.info(msgStart);

    const res = await ts.process({ dateRef: dt });

    const msgEnd = `B3 - ${dt.toFormat(
      'dd/MM/yyyy',
    )} TIMES AND SALES FINISHED: ${JSON.stringify(res)} - ${new Date()}`;
    await bot.sendMessageToUsers(TUserType.OWNER, msgEnd, {});
    logger.info(msgEnd);
  }
  // process.stdin.emit('SIGINT');
  process.kill(process.pid, 'SIGINT');
  process.exit(0);
})();
