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

  public blockRemoteCall = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const remoteIP = req.ip.match(/\d*\.\d*\.\d*\.\d*/)![0];
    if (
      remoteIP === '127.0.0.1' ||
      remoteIP === 'localhost' ||
      (remoteIP === process.env.DOCKER_NETWORK_GATEWAY && !!remoteIP)
    )
      next();
    else {
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      this.logger.silly(
        `[SECURITY WARN] BOT route blocked remote call from IP: ${req.ip} to route: ${url}`,
      );
      this.bot.sendMessageToUsers(
        TUserType.OWNER,
        `[SECURITY WARN] BOT route blocked remote call from IP: ${req.ip} to route: ${url}`,
        {},
      );
      res.end();
    }
  };

  public blockUnauthCall = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const remoteIP = req.ip.match(/\d*\.\d*\.\d*\.\d*/)![0];
    if (
      ((remoteIP === '127.0.0.1' || remoteIP === 'localhost') &&
        process.env.NODE_ENV === 'DEV') ||
      (remoteIP === process.env.DOCKER_NETWORK_GATEWAY && !!remoteIP) ||
      (remoteIP === process.env.LIVELOAD_ALLOWED_IP && !!remoteIP)
    )
      next();
    else {
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      this.logger.silly(
        `[SECURITY WARN] BOT route blocked remote call from IP: ${req.ip} to route: ${url}`,
      );
      this.bot.sendMessageToUsers(
        TUserType.OWNER,
        `[SECURITY WARN] BOT route blocked remote call from IP: ${req.ip} to route: ${url}`,
        {},
      );
      res.end();
    }
  };
}
