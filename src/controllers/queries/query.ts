/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import BaseBot from '../../bot/baseBot';
import { QueryFactory } from '../../db/queryFactory';

abstract class Query {
  bot: BaseBot;

  queryFactory: QueryFactory;

  constructor(bot: BaseBot) {
    this.bot = bot;
    this.queryFactory = bot.queryFactory;
  }

  abstract process(params: any): Promise<any>;
}

export default Query;
