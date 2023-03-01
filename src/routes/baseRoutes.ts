import { Router, Request, Response, NextFunction } from 'express';
import { Logger } from 'tslog';
import { QueryFactory } from '../db/queryFactory';
import BaseBot, { TUserType } from '../bot/baseBot';

export default abstract class BaseRoutes {
  queryfactory: QueryFactory;

  logger: Logger;

  bot: BaseBot;

  constructor(queryfactory: QueryFactory, logger?: Logger, bot?: BaseBot) {
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
      process.env.NODE_ENV === 'DEV' ||
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
      );
      res.end();
    }
  };

  public logRemoteCall = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const ipmatch = req.ip.match(/\d*\.\d*\.\d*\.\d*/);
    const remoteIP = ipmatch && ipmatch.length > 0 ? ipmatch[0] : undefined;
    if (
      process.env.NODE_ENV !== 'DEV' &&
      remoteIP !== '127.0.0.1' &&
      remoteIP !== 'localhost' &&
      remoteIP !== process.env.DOCKER_NETWORK_GATEWAY &&
      !!remoteIP
    ) {
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      this.logger.silly(
        `[SECURITY INFO] Remote access from IP: ${remoteIP} to route: ${url}`,
      );
    }

    next();
  };
}
