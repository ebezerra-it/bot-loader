/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-restricted-syntax */
import { randomUUID } from 'crypto';
import path from 'path';
import ejs from 'ejs';
import { DateTime } from 'luxon';
import validate from 'deep-email-validator';
import { parseExpression } from 'cron-parser';
import { isNumber } from '../../controllers/utils';
import BaseBotCommands, { IBotCommandMessage } from './baseBotCommands';
import BaseBot, { TUserType, TUserReturnAuthType } from '../baseBot';
import GlobalParameters, {
  IGlobalParameter,
} from '../../controllers/loaders/globalParameters';
import { TLoadStatus } from '../../controllers/task';
import CloudFileManager from '../../controllers/cloudFileManager';

export default class ServiceAdmBotCommands extends BaseBotCommands {
  messages: any;

  constructor(bot: BaseBot) {
    super(bot);

    this.botCommands.push({
      name: 'help',
      regEx: new RegExp(/^\/help(\s.*)?/gi),
      procedure: this.help.bind(this),
    });
    this.botCommands.push({
      name: 'start',
      regEx: new RegExp(/^\/start(.*)$/g),
      procedure: this.start.bind(this),
    });
    this.botCommands.push({
      name: 'tracelog',
      regEx: new RegExp(/^\/tracelog(\sON|\sOFF)?$/gi),
      procedure: this.tracelog.bind(this),
    });
    this.botCommands.push({
      name: 'loadstatus',
      regEx: new RegExp(/^\/loadstatus(\sLAST|\s\d\d\/\d\d\/\d\d\d\d)?/gi),
      procedure: this.loadstatus.bind(this),
    });
    this.botCommands.push({
      name: 'schedule',
      regEx: new RegExp(
        /\/schedule (SHOW$|ON|OFF|MAXINSTANCES=([0-9])\s([A-Za-z0-9_-]+$))[\s|$]?([A-Za-z0-9_-]+$)?/gi,
      ),
      procedure: this.schedule.bind(this),
    });
    this.botCommands.push({
      name: 'user',
      regEx: new RegExp(/\/user(.*)/gi),
      procedure: this.user.bind(this),
    });
    this.botCommands.push({
      name: 'reprocess',
      regEx: new RegExp(
        /^\/reprocess "(.*)" (\d\d\/\d\d\/\d\d\d\d)(\s\d\d\/\d\d\/\d\d\d\d)?$/i,
      ),
      procedure: this.reprocess.bind(this),
    });
    this.botCommands.push({
      name: 'globalparam',
      regEx: new RegExp(
        /^\/globalparam(\sSHOW$|\s(UPDT)\s([A-Za-z0-9_-]+)=(.+))?$/gi,
      ),
      procedure: this.globalparam.bind(this),
    });
    this.botCommands.push({
      name: 'restoredbbkp',
      regEx: new RegExp(
        //        /^\/restoredbbkp\s([A-Za-z0-9_-]+)\s(\d\d\/\d\d\/\d\d\d\d)\s(.*)$/gi,
        /^\/restoredbbkp\s([A-Za-z0-9_-]+)\s(\d\d\/\d\d\/\d\d\d\d)$/gi,
      ),
      procedure: this.restoredbbkp.bind(this),
    });

    this.readCommandMessages('serviceAdm');
  }

  private async help(msg: IBotCommandMessage): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    let help;
    if (user.type === TUserType.OWNER) help = 'help_owner';
    else if (user.type === TUserType.ADMINISTRATOR) help = 'help_adm';
    else help = 'help_default';

    const html = await ejs.renderFile(
      `${path.resolve(`${__dirname}/../templates`)}/${help}.ejs`,
      {},
    );
    await this.bot.sendMessage(html, {
      chatId: user.chatId,
      replyToMessageId: msg.replyToMessageId,
      parseMode: 'HTML',
    });
  }

  private async start(
    msg: IBotCommandMessage,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, authType, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match![0]
      .trim()
      .split(' ')
      .filter(a => a !== '');
    if (args[0].toUpperCase() !== '/START') return; // token can't be uppercased
    args.splice(0, 1);

    const qToken = await this.bot.queryFactory.runQuery(
      `SELECT token, expires, COALESCE("email-trials", 0) as emailtrials 
        FROM "users-tokens" WHERE "user-id"=$1 AND expires IS NULL LIMIT 1`,
      { id: user.id },
    );

    if (!args || args.length === 0) {
      // Update ChatId
      if (msg.chatId !== user.chatId && msg.chatId) {
        user.chatId = msg.chatId;
        await this.bot.queryFactory.runQuery(
          `UPDATE users SET "chat-id"=$2 WHERE id=$1`,
          { id: user.id, chatId: user.chatId },
        );
      }

      if (authType === TUserReturnAuthType.EXPIREDTOKEN) {
        if (qToken && qToken.length > 0) {
          if (
            qToken[0].emailtrials <
            parseInt(process.env.BOT_USER_TOKEN_MAX_EMAIL_TRIALS || '1')
          ) {
            const errToken = await this.bot.sendUserTokenEmail(
              user,
              qToken[0].token,
            );
            if (errToken) {
              await this.bot.sendMessage(
                `${this.getCommandMessage('MSG_TOKEN_ERROR')} ${
                  errToken.message
                }`,
                {
                  chatId: user.chatId,
                  replyToMessageId: msg.replyToMessageId,
                },
              );
              return;
            }
            const emailtrials = qToken[0].emailtrials + 1;
            await this.bot.queryFactory.runQuery(
              `UPDATE "users-tokens" SET "email-trials"=$3 WHERE "user-id"=$1 AND token=$2`,
              { userid: user.id, token: qToken[0].token, emailtrials },
            );
            await this.bot.sendMessage(
              this.getCommandMessage('MSG_TOKEN_SENT'),
              {
                chatId: user.chatId,
                replyToMessageId: msg.replyToMessageId,
              },
            );
          } else {
            await this.bot.sendMessage(
              this.getCommandMessage('MSG_TOKEN_MAX_SEND_TRIALS'),
              {
                chatId: msg.chatId,
                replyToMessageId: msg.replyToMessageId,
              },
            );
          }
        } else {
          const token = randomUUID();
          await this.bot.queryFactory.runQuery(
            `INSERT INTO "users-tokens" ("user-id", token) VALUES ($1, $2)`,
            { userid: user.id, token },
          );
          await this.bot.sendUserTokenEmail(user, token);
          await this.bot.sendMessage(this.getCommandMessage('MSG_TOKEN_SENT'), {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          });
        }
      } else {
        await this.bot.sendMessage(this.getCommandMessage('MSG_TOKEN_VALID'), {
          chatId: msg.chatId,
          replyToMessageId: msg.replyToMessageId,
        });
      }
    } else if (
      !(
        !!qToken &&
        qToken.length > 0 &&
        String(qToken[0].token) === String(args[0])
      )
    ) {
      await this.bot.sendMessage(this.getCommandMessage('MSG_TOKEN_INVALID'), {
        chatId: msg.chatId,
        replyToMessageId: msg.replyToMessageId,
      });
    } else {
      const expires = DateTime.now().plus({
        hours: parseInt(process.env.BOT_USER_TOKEN_EXPIRING_HOURS || '8'),
      });

      await this.bot.queryFactory.runQuery(
        `UPDATE "users-tokens" SET expires=$3 WHERE "user-id"=$1 AND token=$2`,
        { userid: user.id, token: qToken[0].token, expires },
      );
      await this.bot.sendMessage(
        this.getCommandMessage('MSG_TOKEN_VALIDATED'),
        {
          chatId: msg.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );

      const html = await ejs.renderFile(
        `${path.resolve(`${__dirname}/../templates`)}/welcome.ejs`,
        { user: user.name },
      );
      await this.bot.sendMessage(html, {
        chatId: user.chatId,
        parseMode: 'HTML',
      });
    }
  }

  private async tracelog(
    msg: IBotCommandMessage,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.ADMINISTRATOR,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match![0]
      .trim()
      .split(' ')
      .filter(a => a !== '')
      .map(a => a.trim().toUpperCase());
    args.splice(0, 1);

    let updated;
    if (args && args.length > 0) {
      let tracelog: boolean;

      if (args[0] === 'ON') tracelog = true;
      else if (args[0] === 'OFF') tracelog = false;
      else {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
          {
            chatId: msg.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      [, updated] = await this.bot.queryFactory.runQuery(
        `UPDATE users SET tracelog=$2 WHERE id=$1`,
        { id: user.id, tracelog },
      );
    } else {
      [, updated] = await this.bot.queryFactory.runQuery(
        `UPDATE users SET tracelog=(NOT tracelog) WHERE id=$1`,
        { id: user.id },
      );
    }
    if (!updated || parseInt(updated) === 0) {
      await this.bot.sendMessage(
        this.getCommandMessage('MSG_COMMAND_EMPTY_DATA'),
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
    } else {
      await this.bot.sendMessage(
        this.getCommandMessage('MSG_COMMAND_SUCCESS'),
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
    }
  }

  private async loadstatus(
    msg: IBotCommandMessage,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match![0]
      .trim()
      .split(' ')
      .filter(a => a !== '')
      .map(a => a.trim().toUpperCase());
    args.splice(0, 1);

    let dtRef: DateTime;
    if (!args || args.length === 0 || args[0] === 'LAST') {
      const qLoad = await this.bot.queryFactory.runQuery(
        `SELECT "date-ref" as dtref 
      FROM "loadcontrol" ORDER BY "date-ref" DESC limit 1`,
        {},
      );
      if (qLoad) dtRef = DateTime.fromJSDate(qLoad[0].dtref);
      else {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_EMPTY_DATA'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }
    } else {
      dtRef = DateTime.fromFormat(args[0], 'dd/MM/yyyy');
      if (!dtRef.isValid) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_DATE'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }
    }

    const sql = `select distinct on ("date-ref"::DATE, process) 
    "date-match"::DATE as datematch, "date-ref"::DATE as dateref,
    "started-at"::DATE as startedat, "finished-at" as finishedat, 
    "reprocessed-at" as reprocessedat, result::TEXT, process, status  
    from loadcontrol l where "date-ref"::DATE=$1 
    order by "date-ref"::DATE desc, process asc`;
    const qLoad = await this.bot.queryFactory.runQuery(sql, {
      date: dtRef.toJSDate(),
    });

    if (!qLoad || qLoad.length < 1) {
      await this.bot.sendMessage(
        this.getCommandMessage('MSG_COMMAND_EMPTY_DATA'),
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    await this.bot.sendMessage(
      `${this.getCommandMessage('MSG_COMMAND_LOADSTATUS')} ${dtRef.toFormat(
        'dd/MM/yyyy',
      )}: \n${BaseBot.printJSON(qLoad)}`,
      {
        chatId: user.chatId,
        replyToMessageId: msg.replyToMessageId,
      },
    );
  }

  private async schedule(
    msg: IBotCommandMessage,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.ADMINISTRATOR,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!
      .filter(e => e && e.trim() !== '')
      .map(e => e.trim().toUpperCase());
    if (args) args.splice(0, 1);

    if (args[0] === 'SHOW') {
      const qLoad = await this.bot.queryFactory.runQuery(
        `SELECT name, cron, "date-ref-adjust" as dateadj, 
        "max-instances" as maxinstances, active 
        FROM "loadcontrol-schedule" ORDER BY name`,
        {},
      );

      if (!qLoad || qLoad.length < 1) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_EMPTY_DATA'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      const res = qLoad.map((s: any) => {
        return {
          process: s.name,
          schedule: s.cron,
          dateAdjust: s.dateadj,
          maxInstances: s.maxinstances,
          active: s.active,
        };
      });

      await this.bot.sendMessage(
        `${this.getCommandMessage(
          'MSG_COMMAND_SCHEDULE_SHOW',
        )}\n${BaseBot.printJSON(res)}`,
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    if (args[0] === 'ON') {
      let updated;
      if (args.length > 1) {
        [, updated] = await this.bot.queryFactory.runQuery(
          `UPDATE "loadcontrol-schedule" SET active=TRUE WHERE UPPER(name)=$1`,
          { name: args[1].toUpperCase() },
        );
      } else {
        [, updated] = await this.bot.queryFactory.runQuery(
          `UPDATE "loadcontrol-schedule" SET active=TRUE`,
          {},
        );
      }

      if (!updated || parseInt(updated) === 0) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_EMPTY_DATA'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      await this.bot.sendMessage(
        this.getCommandMessage('MSG_COMMAND_SCHEDULE_ON').replace(
          '$1',
          updated,
        ),
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    if (args[0] === 'OFF') {
      let updated;
      if (args.length > 1) {
        [, updated] = await this.bot.queryFactory.runQuery(
          `UPDATE "loadcontrol-schedule" SET active=FALSE WHERE UPPER(name)=$1`,
          { name: args[1].toUpperCase() },
        );
      } else {
        [, updated] = await this.bot.queryFactory.runQuery(
          `UPDATE "loadcontrol-schedule" SET active=FALSE`,
          {},
        );
      }

      if (!updated || parseInt(updated) === 0) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_EMPTY_DATA'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      await this.bot.sendMessage(
        this.getCommandMessage('MSG_COMMAND_SCHEDULE_OFF').replace(
          '$1',
          updated,
        ),
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    if (args[0].match(/MAXINSTANCES=[0-9]\s[A-Za-z0-9_-]+$/gi)) {
      if (user.type < TUserType.OWNER) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_ACCESS_DENIED'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }
      let updated;
      if (args.length === 3 || !isNumber(args[1])) {
        [, updated] = await this.bot.queryFactory.runQuery(
          `UPDATE "loadcontrol-schedule" SET "max-instances"=$2 WHERE UPPER(name)=$1`,
          { name: args[2], max: parseInt(args[1]) },
        );
      } else {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      if (!updated || parseInt(updated) === 0) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_EMPTY_DATA'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      await this.bot.sendMessage(
        this.getCommandMessage('MSG_COMMAND_SCHEDULE_MAXINSTANCES'),
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
    } else {
      await this.bot.sendMessage(
        this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
    }
  }

  private async user(
    msg: IBotCommandMessage,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.OWNER,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match![0]
      .trim()
      .split(' ')
      .filter(a => a !== '')
      .map(a => a.toUpperCase());
    if (args[0] !== '/USER') return;
    args.splice(0, 1);

    if (!args || args.length === 0 || args[0].toUpperCase() === 'SHOW') {
      const qLoad = await this.bot.queryFactory.runQuery(
        `SELECT name, username, email, type, active, tracelog, 
        "banned-until" as banneduntil FROM "users" ORDER BY name ASC`,
        {},
      );

      if (!qLoad || qLoad.length < 1) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_EMPTY_DATA'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      const res = qLoad.map((s: any) => {
        return {
          name: s.name,
          username: s.username,
          email: s.email,
          type: TUserType[s.type],
          active: s.active,
          bannedUntil: s.banneduntil,
        };
      });

      await this.bot.sendMessage(
        `${this.getCommandMessage(
          'MSG_COMMAND_USER_SHOW',
        )}\n${BaseBot.printJSON(res)}`,
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }
    if (args[0].toUpperCase() === 'NEW') {
      const regex = new RegExp(/^NEW "(.*)"\s(.*)\s(.*@.*)$/gi);
      const argsNew = regex.exec(match![1].trim());

      if (
        !argsNew ||
        argsNew.length < 4 ||
        !(
          await validate({
            email: argsNew[3],
            validateDisposable: true,
            validateMx: true,
            validateRegex: true,
            validateTypo: true,
            validateSMTP: false,
          })
        ).valid
      ) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      const qUsers = await this.bot.queryFactory.runQuery(
        `SELECT id FROM "users" WHERE LOWER(username)=$1 OR LOWER(email)=$2`,
        {
          username: argsNew[2].toLowerCase(),
          email: argsNew[3].toLowerCase(),
        },
      );
      if (qUsers && qUsers.length > 0) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      await this.bot.queryFactory.runQuery(
        `INSERT INTO "users" (name, username, type, email) 
        VALUES ($1, $2, $3, $4)`,
        {
          name: argsNew[1],
          username: argsNew[2],
          type: TUserType.DEFAULT,
          email: argsNew[3],
        },
      );
      // TO DO: Send email to user

      await this.bot.sendMessage(
        this.getCommandMessage('MSG_COMMAND_USER_CREATED'),
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    if (args[0].toUpperCase() === 'ON' || args[0].toUpperCase() === 'OFF') {
      if (args.length < 2) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }
      const upUser = (await this.bot.getBotUser({ username: args[1] })).user;
      if (!upUser || upUser.type === TUserType.OWNER) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      const active = args[0].toUpperCase() === 'ON';
      await this.bot.queryFactory.runQuery(
        `UPDATE "users" SET active=$1 WHERE LOWER(username)=$2`,
        {
          active,
          username: args[1].toLowerCase(),
        },
      );
      // TO DO: Send email to user

      const MSG =
        args[0].toUpperCase() === 'ON'
          ? this.getCommandMessage('MSG_COMMAND_USER_ON')
          : this.getCommandMessage('MSG_COMMAND_USER_OFF');

      await this.bot.sendMessage(MSG, {
        chatId: user.chatId,
        replyToMessageId: msg.replyToMessageId,
      });
      return;
    }

    if (args[0].toUpperCase() === 'BAN' || args[0].toUpperCase() === 'UNBAN') {
      if (
        (args.length < 3 &&
          args[0].toUpperCase() === 'BAN' &&
          !DateTime.fromFormat(args[2], 'dd/MM/yyyy').isValid &&
          !DateTime.fromFormat(args[2], 'dd/MM/yyyy HH:mm').isValid) ||
        (args[0].toUpperCase() === 'UNBAN' && args.length < 2)
      ) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }
      let banneduntil: DateTime | null;
      if (args[0].toUpperCase() === 'BAN') {
        const regex = new RegExp(
          /^BAN (.*)\s(\d\d\/\d\d\/\d\d\d\d)(\s\d\d:\d\d)?$/gi,
        );
        const argsNew = regex
          .exec(match![1].trim())
          ?.filter(e => e && e.trim() !== '');

        if (argsNew?.length === 4) {
          banneduntil = DateTime.fromFormat(
            `${argsNew[2]}${argsNew[3]}`,
            'dd/MM/yyyy HH:mm',
          );
        } else if (argsNew?.length === 3) {
          banneduntil = DateTime.fromFormat(
            `${argsNew[2]} 23:59:59`,
            'dd/MM/yyyy HH:mm:ss',
          );
        } else {
          banneduntil = null;
        }

        if (
          !banneduntil ||
          !banneduntil.isValid ||
          banneduntil.toMillis() < DateTime.now().toMillis()
        ) {
          await this.bot.sendMessage(
            this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
            {
              chatId: user.chatId,
              replyToMessageId: msg.replyToMessageId,
            },
          );
          return;
        }
      } else {
        banneduntil = null;
      }
      const upUser = (await this.bot.getBotUser({ username: args[1] })).user;
      if (!upUser || upUser.type === TUserType.OWNER) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }
      const [, updated] = await this.bot.queryFactory.runQuery(
        `UPDATE "users" SET "banned-until"=$1 WHERE LOWER(username)=$2`,
        {
          banneduntil: banneduntil ? banneduntil.toJSDate() : null,
          username: args[1].toLowerCase(),
        },
      );

      if (!updated || parseInt(updated) === 0) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_EMPTY_DATA'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      // TO DO: Send email to user

      const MSG =
        args[0].toUpperCase() === 'BAN'
          ? this.getCommandMessage('MSG_COMMAND_USER_BAN')
          : this.getCommandMessage('MSG_COMMAND_USER_UNBAN');

      await this.bot.sendMessage(MSG, {
        chatId: user.chatId,
        replyToMessageId: msg.replyToMessageId,
      });
      return;
    }

    if (
      args[0].toUpperCase() === 'PROMOTE' ||
      args[0].toUpperCase() === 'DEMOTE'
    ) {
      if (args.length < 2) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }
      const upUser = (await this.bot.getBotUser({ username: args[1] })).user;
      if (!upUser || upUser.type === TUserType.OWNER) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      let type: TUserType;
      let MSG_USER: string;
      let MSG_ADM: string;
      if (args[0].toUpperCase() === 'PROMOTE') {
        type = TUserType.ADMINISTRATOR;
        MSG_USER = this.getCommandMessage('MSG_COMMAND_USER_PROMOTED');
        MSG_ADM = this.getCommandMessage('MSG_COMMAND_ADM_PROMOTED')
          .replace('$1', user.username)
          .replace('$2', args[1]);
      } else {
        type = TUserType.DEFAULT;
        MSG_USER = this.getCommandMessage('MSG_COMMAND_USER_DEMOTED');
        MSG_ADM = this.getCommandMessage('MSG_COMMAND_ADM_DEMOTED')
          .replace('$1', user.username)
          .replace('$2', args[1]);
      }

      const [, updated] = await this.bot.queryFactory.runQuery(
        `UPDATE "users" SET type=$1 WHERE LOWER(username)=$2`,
        {
          type,
          username: args[1].toLowerCase(),
        },
      );

      if (!updated || parseInt(updated) === 0) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_EMPTY_DATA'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      // TO DO: Send email to user

      await this.bot.sendMessage(MSG_USER, {
        chatId: user.chatId,
        replyToMessageId: msg.replyToMessageId,
      });

      // Inform administrators
      await this.bot.sendMessageToUsers(TUserType.OWNER, MSG_ADM);
    }
  }

  private async reprocess(
    msg: IBotCommandMessage,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.ADMINISTRATOR,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!
      .filter(e => e && e.trim() !== '')
      .map(e => e.trim().toUpperCase());
    if (args) args.splice(0, 1);

    const dtRefFrom = DateTime.fromFormat(args[1], 'dd/MM/yyyy');
    const dtRefTo =
      args.length === 2
        ? undefined
        : DateTime.fromFormat(args[2], 'dd/MM/yyyy');

    if (args && (args.length === 2 || args.length === 3)) {
      if (
        !dtRefFrom.isValid ||
        dtRefFrom.toMillis() >= DateTime.now().startOf('day').toMillis() ||
        (args.length === 3 &&
          (!dtRefTo || !dtRefTo.isValid || dtRefFrom > dtRefTo))
      ) {
        await this.bot.sendMessage(
          this.getCommandMessage('MSG_COMMAND_INVALID_DATE'),
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      const procs = args[0].split(',').map(p => p.trim().toUpperCase());
      const qSchedules = await this.bot.queryFactory.runQuery(
        `SELECT * FROM "loadcontrol-schedule" WHERE UPPER(name) = ANY($1) 
        AND active=TRUE ORDER BY name`,
        {
          name: procs,
        },
      );

      const invSch = procs.filter(
        p =>
          !qSchedules.map((q: any) => String(q.name).toUpperCase()).includes(p),
      );
      if (invSch && invSch.length > 0) {
        await this.bot.sendMessage(
          `${this.getCommandMessage(
            'MSG_REPROCESS_INVALID_SCHEDULES',
          )} ${invSch.join(', ')}.`,
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }

      const sql = `INSERT INTO "loadcontrol" 
      ("date-match", "date-ref", process, status, "started-at") VALUES 
      ($1::DATE, $2::DATE, $3, $4, $5) ON CONFLICT ("date-ref", process) DO 
      UPDATE SET "date-match"=$1::DATE, status=$4, "started-at"=$5, result=NULL, 
      "reprocessed-at"=NULL`;

      let inserted = 0;
      for await (const sch of qSchedules) {
        let cronSch;
        try {
          cronSch = parseExpression(sch.cron, {
            currentDate: dtRefFrom.toJSDate(),
          });
        } catch (err) {
          await this.bot.sendMessage(
            this.getCommandMessage('MSG_COMMAND_INVALID_CRON_SCHEDULE'),
            {
              chatId: user.chatId,
              replyToMessageId: msg.replyToMessageId,
            },
          );
          return;
        }
        let dtRef = DateTime.fromJSDate(cronSch.next().toDate());

        if (
          (args.length === 2 &&
            dtRef.startOf('day').toMillis() ===
              dtRefFrom.startOf('day').toMillis()) ||
          (args.length === 3 && dtRef.toMillis() <= dtRefTo!.toMillis())
        ) {
          await this.bot.queryFactory.runQuery(sql, {
            dateMatch: dtRef.toJSDate(),
            dateRef: dtRef.toJSDate(),
            process: sch.name,
            status: TLoadStatus.STARTED,
            startedAt: dtRef.toJSDate(),
          });
          inserted++;
        }

        if (dtRefTo) {
          let dtRefAnt: DateTime = dtRef;
          dtRef = DateTime.fromJSDate(cronSch.next().toDate());

          while (
            dtRef.toMillis() <= dtRefTo.toMillis() ||
            dtRef.startOf('day').toMillis() ===
              dtRefTo.startOf('day').toMillis()
          ) {
            if (dtRef.toMillis() > DateTime.now().toMillis()) break;

            if (
              dtRef.startOf('day').toMillis() !==
              dtRefAnt.startOf('day').toMillis()
            ) {
              await this.bot.queryFactory.runQuery(sql, {
                dateMatch: dtRef.toJSDate(),
                dateRef: dtRef.toJSDate(),
                process: sch.name,
                status: TLoadStatus.STARTED,
                startedAt: dtRef.toJSDate(),
              });
              inserted++;
            }
            dtRefAnt = dtRef;
            dtRef = DateTime.fromJSDate(cronSch.next().toDate());
          }
        }
      }
      await this.bot.sendMessage(
        `${this.getCommandMessage('MSG_REPROCESS_CREATED')} ${inserted}.`,
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }
    await this.bot.sendMessage(
      this.getCommandMessage('MSG_COMMAND_INVALID_SINTAX'),
      {
        chatId: user.chatId,
        replyToMessageId: msg.replyToMessageId,
      },
    );
  }

  private async globalparam(
    msg: IBotCommandMessage,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      msg,
      TUserType.OWNER,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!
      .filter(e => e && e.trim() !== '')
      .map(e => e.trim().toUpperCase());
    if (args) args.splice(0, 1);

    if (args.length === 0 || args[0] === 'SHOW') {
      const params: IGlobalParameter[] = await GlobalParameters.getParameters(
        this.bot.queryFactory,
      );

      await this.bot.sendMessage(
        `${this.getCommandMessage('MSG_GLOBALVAR_SHOW')}\n${BaseBot.printJSON(
          params,
        )}`,
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    if (
      await GlobalParameters.updateParameter(
        args[2],
        args[3],
        user,
        this.bot.queryFactory,
      )
    ) {
      await this.bot.sendMessage(
        `${this.getCommandMessage('MSG_GLOBALVAR_UPDATED')}: ${args[2]}=${
          args[3]
        }`,
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
    } else {
      await this.bot.sendMessage(
        `${this.getCommandMessage('MSG_GLOBALVAR_NOT_UPDATED')}: ${args[2]}=${
          args[3]
        }`,
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
    }
  }

  private async restoredbbkp(
    msg: IBotCommandMessage,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      msg,
      TUserType.OWNER,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!
      .filter(e => e && e.trim() !== '')
      .map(e => e.trim().toUpperCase());
    if (args) args.splice(0, 1);

    const restoreTable = args[0].trim().toLowerCase();
    const dateRef = DateTime.fromFormat(args[1], 'dd/MM/yyyy');
    // const token = args[2].trim();

    if (!dateRef.isValid) {
      await this.bot.sendMessage(
        `${this.getCommandMessage('MSG_COMMAND_INVALID_DATE')}: ${args[1]}`,
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }
    const bkpfilename = `${
      process.env.BACKUP_FILE_PREFIX || ''
    }${dateRef.toFormat('yyyyMMdd')}.zip`;
    if (
      !(await CloudFileManager.fileExistsInCloudPool(
        bkpfilename,
        process.env.BACKUP_DB_CLOUD_FOLDER || '',
      ))
    ) {
      await this.bot.sendMessage(
        `${this.getCommandMessage('MSG_RETOREBKPDB_FILE_NOTFOUND')}: ${
          args[1]
        }`,
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    if (restoreTable !== 'all') {
      const qTables = await this.bot.queryFactory.runQuery(
        `SELECT LOWER(table_name) table 
      FROM information_schema.tables 
      WHERE table_schema='public' AND table_type='BASE TABLE'`,
        {},
      );

      if (!qTables || !qTables.find((t: any) => t.table === restoreTable)) {
        await this.bot.sendMessage(
          `${this.getCommandMessage('MSG_RETOREBKPDB_TABLE_NOTFOUND')}: ${
            args[0]
          }`,
          {
            chatId: user.chatId,
            replyToMessageId: msg.replyToMessageId,
          },
        );
        return;
      }
    }

    const qSchedule = await this.bot.queryFactory.runQuery(
      `SELECT COUNT(*) as active 
      FROM "loadcontrol-schedule" 
      WHERE LOWER(name)=LOWER($1) AND active=TRUE`,
      {
        name: 'BackupRestoreDB',
      },
    );

    if (
      !qSchedule ||
      qSchedule.length === 0 ||
      Number(qSchedule[0].active) === 0
    ) {
      await this.bot.sendMessage(
        `${this.getCommandMessage('MSG_RETOREBKPDB_SCHEDULE_NOTACTIVE')}`,
        {
          chatId: user.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    await this.bot.queryFactory.runQuery(
      `INSERT INTO "loadcontrol" ("date-match", "date-ref", process, status, 
    "started-at", result) VALUES ($1::DATE, $2::DATE, $3, $4, $5, $6) 
    ON CONFLICT("date-ref", process) DO 
    UPDATE SET "date-match"=$1::DATE, status=$4, "started-at"=$5, result=$6, 
    "finished-at"=NULL, "reprocessed-at"=NULL`,
      {
        dateMatch: dateRef.toJSDate(),
        dateRef: dateRef.toJSDate(),
        process: 'BackupRestoreDB',
        status: TLoadStatus.STARTED,
        startedAt: dateRef.toJSDate(), // DateTime.now().toJSDate(),
        result: { restoreTable },
      },
    );

    await this.bot.sendMessage(
      `${this.getCommandMessage('MSG_RETOREBKPDB_SCHEDULED')}: ${args[0]}`,
      {
        chatId: user.chatId,
        replyToMessageId: msg.replyToMessageId,
      },
    );
  }
}
