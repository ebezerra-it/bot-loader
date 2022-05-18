import { Router, Request, Response, NextFunction } from 'express';
import { Logger } from 'tslog';
import { QueryFactory } from '../db/queryFactory';
import TelegramBot, { TUserType } from '../bot/telegramBot';

export default abstract class BaseRoutes {
  queryfactory: QueryFactory;

  logger: Logger;

  bot: TelegramBot;

  constructor(queryfactory: QueryFactory, logger?: Logger, bot?: TelegramBot) {
    this.queryfactory = queryfactory;
    if (logger) this.logger = logger;
    if (bot) this.bot = bot;
  }

  public abstract getRouter(): Promise<Router>;

  blockRemoteCall(req: Request, res: Response, next: NextFunction): void {
    const remoteIP = req.ip.match(/\d*\.\d*\.\d*\.\d*/)![0];
    if (remoteIP === '127.0.0.1' || remoteIP === 'localhost') next();
    else {
      this.logger.warn(
        `[SECURITY WARN] BOT route blocked remote call from IP: ${req.ip} to route: ${req.originalUrl}`,
      );
      this.bot.sendMessageToUsers(
        TUserType.OWNER,
        `[SECURITY WARN] BOT route blocked remote call from IP: ${req.ip} to route: ${req.originalUrl}`,
        {},
      );
    }
  }

  blockUnauthCall(req: Request, res: Response, next: NextFunction): void {
    const remoteIP = req.ip.match(/\d*\.\d*\.\d*\.\d*/)![0];
    if (
      ((remoteIP === '127.0.0.1' ||
        remoteIP === 'localhost' ||
        remoteIP === '172.18.0.1') &&
        process.env.NODE_ENV === 'DEV') ||
      (remoteIP === process.env.LIVELOAD_ALLOWED_IP && !remoteIP)
    )
      next();
    else {
      this.logger.warn(
        `[SECURITY WARN] BOT route blocked remote call from IP: ${req.ip} to route: ${req.originalUrl}`,
      );
      this.bot.sendMessageToUsers(
        TUserType.OWNER,
        `[SECURITY WARN] BOT route blocked remote call from IP: ${req.ip} to route: ${req.originalUrl}`,
        {},
      );
    }
  }
}
