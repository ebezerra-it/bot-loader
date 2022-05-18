/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import TelegramBot from '../../bot/telegramBot';
import { QueryFactory } from '../../db/queryFactory';

abstract class Query {
  bot: TelegramBot;

  queryFactory: QueryFactory;

  constructor(bot: TelegramBot) {
    this.bot = bot;
    this.queryFactory = bot.queryFactory;
  }

  abstract process(params: any): Promise<any>;
}

export default Query;
