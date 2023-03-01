/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { DateTime } from 'luxon';
import path from 'path';
import fs from 'fs';
import ejs from 'ejs';
import { Logger } from 'tslog';
import express, { Express, Request, Response, NextFunction } from 'express';
import https, { Server } from 'https';
import bodyParser from 'body-parser';
import { QueryFactory } from '../db/queryFactory';
import MailSender from '../controllers/mailSender';
import BaseBotCommands from './commands/baseBotCommands';
import VmCommands from './commands/vmCommands';
import QueryCommands from './commands/queryCommands';
import ServiceAdmBotCommands from './commands/serviceAdmBotCommands';
import WebappCommands from './commands/webappCommands';
import BotRoutes from '../routes/botRoutes';
import WebAppRoutes from '../routes/webappRoutes';
import WSServerBase from './webapps/wsservers/wsserverBase';
import WSServerDOLFUT from './webapps/wsservers/wsserverDOLFUT';

enum TUserType {
  UNKNOWN = -1,
  DEFAULT = 0,
  ADMINISTRATOR = 1,
  OWNER = 99,
}

enum TUserReturnAuthType {
  NOTREGITERED = 'NOTREGITERED',
  BANNED = 'BANNED',
  INATIVE = 'INATIVE',
  EXPIREDTOKEN = 'EXPIREDTOKEN',
  AUTH = 'AUTH',
}

interface IUser {
  id: number;
  name: string;
  username: string;
  type: TUserType;
  chatId: number;
  email: string;
  traceLog: boolean;
}

interface IBotMessageParams {
  chatId: number;
  replyToMessageId?: number;
  parseMode?: string;
  extraOptions?: any;
}

const sleep = (seconds: number): Promise<void> | undefined => {
  return seconds > 0
    ? new Promise(resolve => setTimeout(resolve, seconds * 1000))
    : undefined;
};

const MESSSAGE_CROP_HEAD = '[PAGE $1/$2]:\n';

export default abstract class BaseBot {
  public queryFactory: QueryFactory;

  public logger: Logger;

  public BOT_USERNAME: string;

  private MAX_MESSAGE_SIZE: number;

  private BOT_API_PORT: number;

  private api: { app: Express; server: Server };

  private wsServers: WSServerBase[];

  constructor(
    queryFactory: QueryFactory,
    logger: Logger,
    options: {
      BOT_USERNAME: string;
      MAX_MESSAGE_SIZE?: number;
      BOT_API_PORT: number;
    },
  ) {
    this.queryFactory = queryFactory;
    this.logger = logger;
    this.MAX_MESSAGE_SIZE =
      options.MAX_MESSAGE_SIZE && options.MAX_MESSAGE_SIZE > 0
        ? options.MAX_MESSAGE_SIZE
        : Number.POSITIVE_INFINITY;
    this.BOT_USERNAME = options.BOT_USERNAME;
    this.BOT_API_PORT = options.BOT_API_PORT;
    this.wsServers = [];
  }

  public async start(): Promise<void> {
    this._loadCommands(new ServiceAdmBotCommands(this));
    this._loadCommands(new QueryCommands(this));
    this._loadCommands(new VmCommands(this));
    this._loadCommands(new WebappCommands(this));

    const app = express();
    app.set('trust proxy', true);
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(bodyParser.json());
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      if (err) res.status(500).send(err.message);
      else next();
    });

    app.use(
      await new BotRoutes(this.queryFactory, this.logger, this).getRouter(),
    );
    app.use(
      await new WebAppRoutes(this.queryFactory, this.logger, this).getRouter(),
    );

    const privatekey = fs.readFileSync(
      path.join(__dirname, '../../', './cert/web', 'key.pem'),
    );
    const certificate = fs.readFileSync(
      path.join(__dirname, '../../', './cert/web', 'cert.pem'),
    );

    const httpsServer: Server = https.createServer(
      { key: privatekey, cert: certificate },
      app,
    );

    this.api = { app, server: httpsServer };
    this.startWSServers();

    app.use('/', express.static(path.join(__dirname, '/webapps/public/')));

    await new Promise((resolve, reject) => {
      this.api.server
        .listen(this.BOT_API_PORT, '0.0.0.0')
        .once('listening', resolve)
        .once('error', reject);
    });

    this.logger.warn(
      `[MYORACULUM] BOT service started and API is running on port ${parseInt(
        process.env.TELEGRAM_API_PORT || '8001',
      )}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public stop(): void {}

  public abstract _sendMessage(
    message: string,
    params: IBotMessageParams,
  ): Promise<any>;

  public abstract sendMessageToUsers(
    userType: TUserType,
    message: string,
    params?: IBotMessageParams,
    tracelog?: boolean,
    header?: string,
  ): Promise<void>;

  public abstract _parseMessage(message: string, parseMode: string): string;

  public abstract sendDocument(
    document: string | Buffer,
    params: IBotMessageParams,
  ): Promise<any>;

  public abstract sendWebApps(params: IBotMessageParams): Promise<any>;

  public abstract getBotUser(params: {
    id?: number | undefined;
    username?: string | undefined;
  }): Promise<{ user: IUser | undefined; authType: TUserReturnAuthType }>;

  public abstract _loadCommands(baseBotCommands: BaseBotCommands): void;

  public abstract cryptdata(data: string): string;

  public async checkBotUserAuth(
    userData: { id?: number; username?: string },
    commandUserType: TUserType,
    allowExpired = false,
  ): Promise<{
    cmdAllowed: boolean;
    user: IUser | undefined;
    authType: TUserReturnAuthType;
  }> {
    const { authType, user } = await this.getBotUser(userData);
    if (
      !user ||
      authType === TUserReturnAuthType.NOTREGITERED ||
      user.type < commandUserType
    )
      return { cmdAllowed: false, user, authType };
    if (
      authType !== TUserReturnAuthType.AUTH &&
      !(authType === TUserReturnAuthType.EXPIREDTOKEN && allowExpired)
    )
      return { cmdAllowed: false, user, authType };

    return { cmdAllowed: true, user, authType };
  }

  public async sendMessage(
    message: string,
    params: IBotMessageParams,
    header?: string,
  ): Promise<any> {
    let rawMessage;
    if (header)
      rawMessage =
        params && params.parseMode
          ? this._parseMessage(`${header}\n${message}`, params.parseMode)
          : `${header}\n${message}`;
    else
      rawMessage =
        params && params.parseMode
          ? this._parseMessage(`${message}`, params.parseMode)
          : `${message}`;

    if (rawMessage.length <= this.MAX_MESSAGE_SIZE)
      return this._retrySendMessage(rawMessage, params);

    const qteMsgs =
      Math.floor(rawMessage.length / this.MAX_MESSAGE_SIZE) +
      (rawMessage.length % this.MAX_MESSAGE_SIZE > 0 ? 1 : 0);

    let msg = rawMessage;
    let sliceMsg = msg.substr(
      0,
      this.MAX_MESSAGE_SIZE - MESSSAGE_CROP_HEAD.length,
    );
    let retMsg: any;
    let i = 0;
    while (msg !== '') {
      sliceMsg = MESSSAGE_CROP_HEAD.replace('$1', String(++i))
        .replace('$2', String(qteMsgs))
        .concat(sliceMsg);
      retMsg = await this._retrySendMessage(sliceMsg, params);
      msg = msg.substr(this.MAX_MESSAGE_SIZE - MESSSAGE_CROP_HEAD.length);
      sliceMsg = msg.substr(
        0,
        this.MAX_MESSAGE_SIZE - MESSSAGE_CROP_HEAD.length,
      );
    }

    return retMsg!;
  }

  private async _retrySendMessage(
    message: string,
    params: IBotMessageParams,
  ): Promise<any> {
    let tries = 0;

    for (;;) {
      try {
        const result = await this._sendMessage(message, params);
        return result;
      } catch (error) {
        if (
          ++tries > Number(process.env.BOT_SENDMESSAGE_RETRIES || '0') &&
          Number(process.env.BOT_SENDMESSAGE_RETRIES || '0') >= 0
        ) {
          throw error;
        }
        await sleep(
          Number(process.env.BOT_SENDMESSAGE_RETRY_INTERVAL || '10') * 1000,
        );
      }
    }
  }

  public async sendUserTokenEmail(user: IUser, token: string): Promise<any> {
    const html = await ejs.renderFile(
      path.join(__dirname, './templates', 'emailtoken.ejs'),
      {
        name: user.name,
        token,
      },
    );
    try {
      await MailSender.sendEmail({
        sendTo: user.email,
        subject: process.env.BOT_EMAIL_TOKEN_SUBJECT || '',
        html,
      });
      return undefined;
    } catch (e) {
      return { code: e.code, message: e.message };
    }
  }

  public static printJSON(jsondata: any): string {
    function formatJSON(data: any): any {
      function isJSON(anyType: any) {
        function hasMethods(obj: any) {
          for (const [key] of Object.entries(obj)) {
            if (typeof key === 'function') return true;
          }
          return false;
        }

        return (
          anyType.constructor === Object &&
          typeof anyType === 'object' &&
          !hasMethods(anyType)
        );
      }

      let formattedData: any;
      if (Array.isArray(data)) {
        formattedData = data.map(d => formatJSON(d));
      } else {
        const item = data;
        Object.entries(data).forEach(([key, value]) => {
          if (value instanceof DateTime) {
            if (value.startOf('day').toMillis() === value.toMillis()) {
              item[key] = value.toFormat('dd/MM/yyyy');
            } else {
              item[key] = value.toFormat('dd/MM/yyyy HH:mm:ss');
            }
          } else if (value instanceof Date) {
            const d1 = DateTime.fromJSDate(value).startOf('day');
            const d2 = DateTime.fromJSDate(value);

            const hasTime = d2.toJSDate().getTime() - d1.toJSDate().getTime();
            if (hasTime > 0) item[key] = d2.toFormat('dd/MM/yyyy HH:mm:ss');
            else item[key] = d2.toFormat('dd/MM/yyyy');
          } else if (typeof value === 'number') {
            item[key] = +Number(value).toFixed(2);
          } else if (!value) {
            item[key] = '';
          } else if (isJSON(value)) {
            item[key] = formatJSON(value);
          } else if (Array.isArray(value)) {
            item[key] = value.map(v => formatJSON(v));
          }
        });
        formattedData = item;
      }
      return formattedData;
    }
    return JSON.stringify(formatJSON(jsondata), null, 4);
  }

  public startWSServers(): void {
    const wsServerDOLFUT = new WSServerDOLFUT(
      this.api.server,
      this,
      this.logger,
    );

    this.wsServers.push(wsServerDOLFUT);
  }

  public async checkBotWebAppUser(
    user: any,
    userType: TUserType,
  ): Promise<
    | {
        cmdAllowed: boolean;
        user: IUser | undefined;
        authType: TUserReturnAuthType;
      }
    | undefined
  > {
    const _user = user;
    if (_user.hash && _user.id && _user.username) {
      const { hash } = _user;
      delete _user.hash;
      const userData = Object.keys(_user)
        .map(key => `${key}=${_user[key]}`)
        .sort((a, b) => a.localeCompare(b))
        .join(`\n`);

      const hashUserData = this.cryptdata(userData);
      if (hash.toString() === hashUserData) {
        const botUserAuth = await this.checkBotUserAuth(
          { username: user.username },
          userType > TUserType.UNKNOWN ? userType : TUserType.DEFAULT,
        );
        /* if (botUserAuth.cmdAllowed) {
          return botUserAuth.user;
        } */
        return botUserAuth;
      }
    }
    return undefined;
  }
}
export { IUser, IBotMessageParams, TUserType, TUserReturnAuthType };
