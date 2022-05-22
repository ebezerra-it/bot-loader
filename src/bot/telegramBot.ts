/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import Telegram, { Message, SendMessageOptions } from 'node-telegram-bot-api';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { DateTime } from 'luxon';
import path from 'path';
import ejs from 'ejs';
import { Logger } from 'tslog';
import { QueryFactory } from '../db/queryFactory';
import ServiceAdmBotCommands from './commands/serviceAdmBotCommands';
import QueryCommands from './commands/queryCommands';

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

const TELEGRAM_MSG_SIZE = 4000;
const TELEGRAM_MSG_CROP_HEAD = '[PAGE $1/$2]:\n';
const EMAIL_TOKEN_SUBJECT = 'My Oraculum bot token';

class TelegramBot extends Telegram {
  public queryFactory: QueryFactory;

  public logger: Logger;

  constructor(
    telegramToken: string,
    queryFactory: QueryFactory,
    logger?: Logger,
  ) {
    super(telegramToken, {
      polling: {
        autoStart: true,
        interval: parseInt(process.env.TELEGRAM_BOT_POLLING_INTERVAL || '1000'),
        params: { offset: Number.MAX_SAFE_INTEGER },
      },
    });
    this.queryFactory = queryFactory;

    this.sendMessage = this.sendPagedMessage;

    if (logger) {
      this.logger = logger;
      this.on('message', (msg: Message) => {
        this.logger.silly(`[BOT TELEGRAM MESSAGE] - ${JSON.stringify(msg)}`);
      });
    }

    this.on('new_chat_members', async (msg: Message) => {
      let { authType, user } = await this.getUser({
        // @ts-ignore
        username: msg.new_chat_member?.username,
      });
      if (
        authType !== TUserReturnAuthType.AUTH ||
        !user ||
        user.type < TUserType.ADMINISTRATOR
      ) {
        if (
          // @ts-ignore
          String(msg.new_chat_member?.username) ===
          String(process.env.TELEGRAM_BOT_USERNAME)
        ) {
          await this.leaveChat(msg.chat.id);
        } else {
          // @ts-ignore
          await this.banChatMember(msg.chat.id, msg.new_chat_member.id);
        }

        ({ authType, user } = await this.getUser({
          username: msg.from?.username,
        }));
        if (!user) return;

        const bannedUntil = DateTime.now().plus({
          hours: parseInt(process.env.USER_BAN_HOURS || '8'),
        });
        await queryFactory.runQuery(
          `UPDATE "users" SET "banned-until"=$2 WHERE id=$1`,
          { id: user?.id, bannedUntil: bannedUntil.toJSDate() },
        );

        if (user && user.chatId) {
          const html = await ejs.renderFile(
            `${path.resolve(`${__dirname}/templates`)}/userban.ejs`,
            {
              user: user?.name,
              username: user?.username,
              bannedUntil: bannedUntil.toFormat('dd/MM/yyyy HH:mm:ss'),
            },
          );
          await this.sendMessage(user.chatId, html, {
            parse_mode: 'HTML',
          });
        }

        const html = await ejs.renderFile(
          `${path.resolve(`${__dirname}/templates`)}/securitywarn.ejs`,
          {
            user: msg.from?.username,
            // @ts-ignore
            newuser: msg.new_chat_member?.username,
            bannedUntil: bannedUntil.toFormat('dd/MM/yyyy HH:mm:ss'),
          },
        );
        await this.sendMessageToUsers(TUserType.OWNER, html, {
          parse_mode: 'HTML',
        });
      }
    });

    new ServiceAdmBotCommands(this).loadCommands();
    new QueryCommands(this).loadCommands();
  }

  public async sendMessageToUsers(
    userType: TUserType,
    message: string,
    msgOptions?: SendMessageOptions | undefined,
    tracelog = false,
    header = '',
  ): Promise<void> {
    const qUsers = await this.queryFactory.runQuery(
      `SELECT username, type, active, "chat-id" as chatid, tracelog, 
      "banned-until" as banneduntil FROM users WHERE type>=$1 AND 
      "chat-id"<>0 AND active=TRUE`,
      { type: userType },
    );

    for await (const user of qUsers) {
      if (
        (DateTime.fromJSDate(user.banneduntil).toMillis() <
          DateTime.now().toMillis() ||
          !user.banneduntil) &&
        user.active &&
        (user.tracelog || !tracelog)
      ) {
        await this.sendPagedMessage(user.chatid, message, msgOptions, header);
      }
    }
  }

  public async sendPagedMessage(
    chatId: number,
    message: string,
    options: SendMessageOptions | undefined,
    header = '',
  ): Promise<Telegram.Message> {
    const rawMessage =
      options && options.parse_mode === 'HTML'
        ? `${header}\n${message.replace(/<\/?(\w*)>/gi, (match, token) => {
            if (!['a', 'b', 'strong', 'i', 'em', 'code', 'pre'].includes(token))
              return '&lt;'.concat(token).concat('&gt;');
            return match;
          })}`
        : `${header}\n${message}`;

    if (rawMessage.length <= TELEGRAM_MSG_SIZE)
      return this.retrySendMessage(chatId, rawMessage, options);

    const qteMsgs =
      Math.floor(rawMessage.length / TELEGRAM_MSG_SIZE) +
      (rawMessage.length % TELEGRAM_MSG_SIZE > 0 ? 1 : 0);

    let msg = rawMessage;
    let sliceMsg = msg.substr(
      0,
      TELEGRAM_MSG_SIZE - TELEGRAM_MSG_CROP_HEAD.length,
    );
    let retMsg: Message;
    let i = 0;
    while (msg !== '') {
      sliceMsg = TELEGRAM_MSG_CROP_HEAD.replace('$1', String(++i))
        .replace('$2', String(qteMsgs))
        .concat(sliceMsg);
      retMsg = await this.retrySendMessage(chatId, sliceMsg, options);
      msg = msg.substr(TELEGRAM_MSG_SIZE - TELEGRAM_MSG_CROP_HEAD.length);
      sliceMsg = msg.substr(
        0,
        TELEGRAM_MSG_SIZE - TELEGRAM_MSG_CROP_HEAD.length,
      );
    }

    return retMsg!;
  }

  public async retrySendMessage(
    chatId: number,
    message: string,
    options: SendMessageOptions | undefined,
  ): Promise<Telegram.Message> {
    let tries = 0;

    for (;;) {
      try {
        const result = await super.sendMessage(chatId, message, options);
        return result;
      } catch (error) {
        if (
          ++tries > parseInt(process.env.TELEGRAM_SENDMESSAGE_RETRIES || '0') &&
          parseInt(process.env.TELEGRAM_SENDMESSAGE_RETRIES || '0') >= 0
        ) {
          throw error;
        }
        await new Promise(r =>
          setTimeout(
            r,
            1000 *
              parseInt(process.env.TELEGRAM_SENDMESSAGE_RETRY_INTERVAL || '10'),
          ),
        );
      }
    }
  }

  public async sendUserTokenEmail(user: IUser, token: string): Promise<any> {
    const pathTemplatesDir = path.resolve(`${__dirname}/templates`);
    const html = await ejs.renderFile(`${pathTemplatesDir}/emailtoken.ejs`, {
      name: user.name,
      token,
    });
    try {
      await this.sendEmail({
        sendTo: user.email,
        subject: EMAIL_TOKEN_SUBJECT,
        html,
      });
      return undefined;
    } catch (e) {
      return { code: e.code, message: e.message };
    }
  }

  private async sendEmail(email: {
    sendTo: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const createTransporter = async () => {
      const { OAuth2 } = google.auth;
      const oauth2Client = new OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_SECRET_KEY,
        'https://developers.google.com/oauthplayground',
      );

      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      });

      const accessToken = await new Promise((resolve, reject) => {
        oauth2Client.getAccessToken((err, token) => {
          if (err) {
            reject(
              new Error(
                `Google - Failed to create access token: ${err.code}-${err.message}\nClient-ID: ${process.env.GOOGLE_CLIENT_ID}\nSecret-Key: ${process.env.GOOGLE_SECRET_KEY}\nRefresh-Token: ${process.env.GOOGLE_REFRESH_TOKEN}`,
              ),
            );
          }
          resolve(token);
        });
      });

      const transporter = nodemailer.createTransport({
        // @ts-ignore
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          type: 'OAuth2',
          user: process.env.GOOGLE_EMAIL,
          accessToken,
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_SECRET_KEY,
          refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
        },
      });

      return transporter;
    };

    const sendEmail = async (emailOptions: any) => {
      const emailTransporter = await createTransporter();
      await emailTransporter.sendMail(emailOptions);
    };

    await sendEmail({
      from: `"MyOraculum" ${process.env.GOOGLE_EMAIL}`,
      to: email.sendTo,
      subject: email.subject,
      html: email.html,
    });
  }

  public async getUser(params: {
    id?: number | undefined;
    username?: string | undefined;
  }): Promise<{ authType: TUserReturnAuthType; user: IUser | undefined }> {
    return TelegramBot.getUser(params, this.queryFactory);
  }

  public static async getUser(
    params: {
      id?: number | undefined;
      username?: string | undefined;
    },
    queryFactory: QueryFactory,
  ): Promise<{ authType: TUserReturnAuthType; user: IUser | undefined }> {
    const { id, username } = params;
    if ((!username && !id) || process.env.RESTOREDB === 'TRUE')
      return { authType: TUserReturnAuthType.NOTREGITERED, user: undefined };

    let qUser;
    if (!username) {
      qUser = await queryFactory.runQuery(
        `SELECT users.id, users.name, users.username, users.email, 
        users."chat-id" as chatid, users.type, users.tracelog, users.active, 
        users."banned-until" as banneduntil, 
        COALESCE("users-tokens".expires, '1900-01-01') as expires,
        COALESCE("users-tokens"."email-trials", 0) as emailtrials,
        "users-tokens".token FROM users LEFT JOIN "users-tokens" 
        ON (users.id="users-tokens"."user-id") 
        WHERE users.id=$1 ORDER BY "users-tokens".expires DESC LIMIT 1`,
        { userId: id },
      );
    } else {
      qUser = await queryFactory.runQuery(
        `SELECT users.id, users.name, users.username, users.email, 
      users."chat-id" as chatid, users.type, users.tracelog, users.active, 
      users."banned-until" as banneduntil, 
      COALESCE("users-tokens".expires, '1900-01-01') as expires, 
      COALESCE("users-tokens"."email-trials", 0) as emailtrials,
      "users-tokens".token FROM users LEFT JOIN "users-tokens" 
      ON (users.id="users-tokens"."user-id") 
      WHERE LOWER(users.username)=$1 ORDER BY "users-tokens".expires DESC LIMIT 1`,
        { username: username.toLowerCase() },
      );
    }

    if (!qUser || qUser.length === 0)
      return { authType: TUserReturnAuthType.NOTREGITERED, user: undefined };

    const user: IUser = {
      id: qUser[0].id,
      name: qUser[0].name,
      username: qUser[0].username,
      email: qUser[0].email,
      chatId: qUser[0].chatid,
      type: parseInt(qUser[0].type),
      traceLog: qUser[0].tracelog,
    };

    if (!qUser[0].active)
      return { authType: TUserReturnAuthType.INATIVE, user };

    if (
      qUser[0].banneduntil &&
      DateTime.fromJSDate(qUser[0].banneduntil).toMillis() >=
        DateTime.now().toMillis()
    )
      return { authType: TUserReturnAuthType.BANNED, user };

    if (
      DateTime.fromJSDate(qUser[0].expires).toMillis() >
        DateTime.now().toMillis() &&
      qUser[0].chatid
    )
      return { authType: TUserReturnAuthType.AUTH, user };

    return {
      authType: TUserReturnAuthType.EXPIREDTOKEN,
      user,
    };
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

      let formattedData;
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
}

export default TelegramBot;
export { TUserType, IUser, TUserReturnAuthType, Message };
