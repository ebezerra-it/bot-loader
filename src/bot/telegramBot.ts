/* eslint-disable no-restricted-syntax */
import { Telegraf, Input } from 'telegraf';
import { InputFile } from 'telegraf/typings/core/types/typegram';
import { DateTime } from 'luxon';
import { Logger } from 'tslog';
import fs from 'fs';
import { createHash, createHmac } from 'crypto';
import { QueryFactory } from '../db/queryFactory';
import BaseBot, {
  IBotMessageParams,
  TUserType,
  IUser,
  TUserReturnAuthType,
} from './baseBot';
import BaseBotCommands, {
  IBotCommandMessage,
} from './commands/baseBotCommands';

export default class TelegramBot extends BaseBot {
  private telegraf: Telegraf;

  constructor(
    queryFactory: QueryFactory,
    logger: Logger,
    options: {
      BOT_USERNAME: string;
      MAX_MESSAGE_SIZE?: number;
      BOT_API_PORT: number;
    },
  ) {
    super(queryFactory, logger, options);

    this.telegraf = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');
    this.telegraf.use(async (ctx, next) => {
      if (!ctx.message) return;
      if (!ctx.message.chat || ctx.message.chat.type !== 'private') return;
      if (!('text' in ctx.message)) return;

      this.logger.silly(
        `[BOT TELEGRAM MESSAGE] User: ${JSON.stringify({
          chatId: ctx.message.chat.id,
          chatType: ctx.message.chat.type,
          firstname: ctx.from ? ctx.from!.first_name : '',
          lastname: ctx.from ? ctx.from!.last_name : '',
          username: ctx.from ? ctx.from!.username : '',
          isBot: ctx.from ? ctx.from!.is_bot : '',
          language: ctx.from ? ctx.from!.language_code : '',
        })} - Message: "${ctx.message.text}"`,
      );

      next();
    });
  }

  public async start(): Promise<void> {
    await super.start();
    this.telegraf.launch({ dropPendingUpdates: true });
  }

  public stopPooling(): void {
    this.telegraf.stop();
  }

  public _loadCommands(baseBotCommands: BaseBotCommands): void {
    baseBotCommands.botCommands.forEach(cmd => {
      this.telegraf.hears(cmd.regEx, async ctx => {
        const { match } = ctx;
        const msg: IBotCommandMessage = {
          chatId: ctx.chat.id,
          username: ctx.from.username!,
          replyToMessageId: ctx.message.message_id,
        };
        try {
          await cmd.procedure(msg, match);
        } catch (err) {
          const errorMsg =
            baseBotCommands.getCommandMessage('MSG_COMMAND_ERROR');
          this.sendMessage(
            errorMsg
              .replace(/\$1/g, `\\${cmd.name}`)
              .replace(/\$2/g, `${err.message}`),
            {
              chatId: msg.chatId,
              replyToMessageId: msg.replyToMessageId,
            },
          );
          this.logger.error(
            errorMsg
              .replace(/\$1/g, `\\${cmd.name}`)
              .replace(/\$2/g, `${JSON.stringify(err)}`),
          );
        }
      });
    });
  }

  async _sendMessage(message: string, params: IBotMessageParams): Promise<any> {
    return this.telegraf.telegram.sendMessage(
      params.chatId,
      this._parseMessage(message, params.parseMode),
      {
        reply_to_message_id: params.replyToMessageId,
        parse_mode: params.parseMode ? params.parseMode : undefined,
        ...params.extraOptions,
      },
    );
  }

  public async sendMessageToUsers(
    userType: TUserType,
    message: string,
    params?: IBotMessageParams,
    tracelog?: boolean,
    header?: string,
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
        await this.sendMessage(
          message,
          {
            chatId: user.chatid,
            parseMode:
              params && params.parseMode ? params.parseMode : undefined,
            extraOptions:
              params && params.extraOptions ? params.extraOptions : undefined,
          },
          header,
        );
      }
    }
  }

  public _parseMessage(message: string, parseMode: string | undefined): string {
    if (parseMode && parseMode === 'HTML') {
      return message.replace(/<\/?(\w*)>/gi, (match, token) => {
        if (!['a', 'b', 'strong', 'i', 'em', 'code', 'pre'].includes(token))
          return '&lt;'.concat(token).concat('&gt;');
        return match;
      });
    }
    return message;
  }

  public async sendDocument(
    document: string | Buffer,
    params: IBotMessageParams,
  ): Promise<any> {
    let documentToSend: InputFile;
    if (typeof document === 'string') {
      if (!fs.existsSync(document))
        throw new Error(`File ${document} does not exist.`);

      documentToSend = Input.fromLocalFile(document);
    } else {
      if (!params.extraOptions && !params.extraOptions.filename)
        throw new Error(`Missing <filename> parameter to bot send document.`);

      documentToSend = Input.fromBuffer(document, params.extraOptions.filename);
    }

    return this.telegraf.telegram.sendDocument(params.chatId, documentToSend, {
      reply_to_message_id: params.replyToMessageId,
      ...params.extraOptions,
    });
  }

  public async sendWebApps(params: IBotMessageParams): Promise<any> {
    const webapps = [];
    webapps.push({
      text: 'BRL-USD Pannel',
      url: `https://${
        process.env.NODE_ENV === 'PROD'
          ? 'myoraculumb3.ml'
          : process.env.BOT_HOST
      }/webapps/quotes`,
    });

    return this.telegraf.telegram.sendMessage(
      params.chatId,
      'Available Webapps:',
      {
        reply_to_message_id: params.replyToMessageId,
        reply_markup: {
          inline_keyboard: [webapps],
        },
      },
    );
  }

  public async getBotUser(params: {
    id?: number;
    username?: string;
  }): Promise<{ user: IUser | undefined; authType: TUserReturnAuthType }> {
    return TelegramBot.getBotUser(this.queryFactory, params);
  }

  public static async getBotUser(
    queryFactory: QueryFactory,
    params: {
      id?: number;
      username?: string;
    },
  ): Promise<{ user: IUser | undefined; authType: TUserReturnAuthType }> {
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

  public cryptdata(data: string): string {
    const secretkey = process.env.TELEGRAM_BOT_TOKEN || '';
    const algorithm = 'sha256';

    const hashsecretkey = createHash('sha256').update(secretkey).digest();

    const hmac = createHmac(algorithm, hashsecretkey);
    return hmac.update(Buffer.from(data, 'utf8')).digest('hex');
  }
}
