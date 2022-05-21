/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-restricted-syntax */
import { randomUUID } from 'crypto';
import path from 'path';
import ejs from 'ejs';
import { DateTime } from 'luxon';
import validate from 'deep-email-validator';
import { parseExpression } from 'cron-parser';
import { isNumber, loadJSONFile } from '../../controllers/utils';
import BaseBotCommands from './baseBotCommands';
import TelegramBot, {
  TUserType,
  TUserReturnAuthType,
  Message,
} from '../telegramBot';
import GlobalParameters, {
  IGlobalParameter,
} from '../../controllers/loaders/globalParameters';
import { TLoadStatus } from '../../controllers/task';
import CloudFileManager from '../../controllers/cloudFileManager';

export default class ServiceAdmBotCommands extends BaseBotCommands {
  messages: any;

  constructor(bot: TelegramBot) {
    super(bot);

    this.botCommands.push({
      name: 'help',
      regEx: new RegExp(/^\/help(\s.*)?/gi),
      procedure: this.help,
    });
    this.botCommands.push({
      name: 'start',
      regEx: new RegExp(/^\/start(.*)$/g),
      procedure: this.start,
    });
    this.botCommands.push({
      name: 'tracelog',
      regEx: new RegExp(/^\/tracelog(\sON|\sOFF)?$/gi),
      procedure: this.tracelog,
    });
    this.botCommands.push({
      name: 'loadstatus',
      regEx: new RegExp(/^\/loadstatus(\sLAST|\s\d\d\/\d\d\/\d\d\d\d)?/gi),
      procedure: this.loadstatus,
    });
    this.botCommands.push({
      name: 'schedule',
      regEx: new RegExp(
        /\/schedule (SHOW$|ON|OFF|MAXINSTANCES=([0-9])\s([A-Za-z0-9_-]+$))[\s|$]?([A-Za-z0-9_-]+$)?/gi,
      ),
      procedure: this.schedule,
    });
    this.botCommands.push({
      name: 'user',
      regEx: new RegExp(/\/user(.*)/gi),
      procedure: this.user,
    });
    this.botCommands.push({
      name: 'reprocess',
      regEx: new RegExp(
        /^\/reprocess "(.*)" (\d\d\/\d\d\/\d\d\d\d)(\s\d\d\/\d\d\/\d\d\d\d)?$/i,
      ),
      procedure: this.reprocess,
    });
    this.botCommands.push({
      name: 'globalparam',
      regEx: new RegExp(
        /^\/globalparam(\sSHOW$|\s(UPDT)\s([A-Za-z0-9_-]+)=(.+))?$/gi,
      ),
      procedure: this.globalparam,
    });
    this.botCommands.push({
      name: 'restoredbbkp',
      regEx: new RegExp(
        //        /^\/restoredbbkp\s([A-Za-z0-9_-]+)\s(\d\d\/\d\d\/\d\d\d\d)\s(.*)$/gi,
        /^\/restoredbbkp\s([A-Za-z0-9_-]+)\s(\d\d\/\d\d\/\d\d\d\d)$/gi,
      ),
      procedure: this.restoredbbkp,
    });

    loadJSONFile(path.join(__dirname, '../../../', 'config/', 'messages.json'))
      .then(json => {
        this.messages = json;
        if (!this.messages || Object.keys(this.messages).length === 0)
          throw new Error(
            `[BOT-ServiceAdmCommands] Empty 'config/messages.json' file`,
          );
      })
      .catch(e => {
        throw new Error(
          `[BOT-ServiceAdmCommands] Error found in 'config/messages.json' file: ${e.message}`,
        );
      });
  }

  private async help(msg: Message): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
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
    await this.bot.sendMessage(user.chatId, html, {
      parse_mode: 'HTML',
    });
  }

  private async start(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, authType, user } = await this.checkAuth(
      msg,
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
      if (msg.chat.id !== user.chatId && msg.chat.id) {
        user.chatId = msg.chat.id;
        await this.bot.queryFactory.runQuery(
          `UPDATE users SET "chat-id"=$2 WHERE id=$1`,
          { id: user.id, chatId: user.chatId },
        );
      }

      if (authType === TUserReturnAuthType.EXPIREDTOKEN) {
        if (qToken && qToken.length > 0) {
          if (
            qToken[0].emailtrials <
            parseInt(process.env.USER_TOKEN_MAX_EMAIL_TRIALS || '1')
          ) {
            const errToken = await this.bot.sendUserTokenEmail(
              user,
              qToken[0].token,
            );
            if (errToken) {
              await this.bot.sendMessage(
                user.chatId,
                `${this.messages.MSG_TOKEN_ERROR} ${errToken.message}`,
                {
                  reply_to_message_id: msg.message_id,
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
              user.chatId,
              this.messages.MSG_TOKEN_SENT,
              {
                reply_to_message_id: msg.message_id,
              },
            );
          } else {
            await this.bot.sendMessage(
              msg.chat.id,
              this.messages.MSG_TOKEN_MAX_SEND_TRIALS,
              {
                reply_to_message_id: msg.message_id,
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
          await this.bot.sendMessage(
            user.chatId,
            this.messages.MSG_TOKEN_SENT,
            {
              reply_to_message_id: msg.message_id,
            },
          );
        }
      } else {
        await this.bot.sendMessage(msg.chat.id, this.messages.MSG_TOKEN_VALID, {
          reply_to_message_id: msg.message_id,
        });
      }
    } else if (
      !(
        !!qToken &&
        qToken.length > 0 &&
        String(qToken[0].token) === String(args[0])
      )
    ) {
      await this.bot.sendMessage(msg.chat.id, this.messages.MSG_TOKEN_INVALID, {
        reply_to_message_id: msg.message_id,
      });
    } else {
      const expires = DateTime.now().plus({
        hours: parseInt(process.env.USER_TOKEN_EXPIRING_HOURS || '8'),
      });

      await this.bot.queryFactory.runQuery(
        `UPDATE "users-tokens" SET expires=$3 WHERE "user-id"=$1 AND token=$2`,
        { userid: user.id, token: qToken[0].token, expires },
      );
      await this.bot.sendMessage(
        msg.chat.id,
        this.messages.MSG_TOKEN_VALIDATED,
        {
          reply_to_message_id: msg.message_id,
        },
      );

      const html = await ejs.renderFile(
        `${path.resolve(`${__dirname}/../templates`)}/welcome.ejs`,
        { user: user.name },
      );
      await this.bot.sendMessage(user.chatId, html, {
        parse_mode: 'HTML',
      });
    }
  }

  private async tracelog(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_SINTAX,
          {
            reply_to_message_id: msg.message_id,
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
        msg.chat.id,
        this.messages.MSG_COMMAND_EMPTY_DATA,
        {
          reply_to_message_id: msg.message_id,
        },
      );
    } else {
      await this.bot.sendMessage(
        msg.chat.id,
        this.messages.MSG_COMMAND_SUCCESS,
        {
          reply_to_message_id: msg.message_id,
        },
      );
    }
  }

  private async loadstatus(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_EMPTY_DATA,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }
    } else {
      dtRef = DateTime.fromFormat(args[0], 'dd/MM/yyyy');
      if (!dtRef.isValid) {
        await this.bot.sendMessage(
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_DATE,
          {
            reply_to_message_id: msg.message_id,
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
        msg.chat.id,
        this.messages.MSG_COMMAND_EMPTY_DATA,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    await this.bot.sendMessage(
      msg.chat.id,
      `${this.messages.MSG_COMMAND_LOADSTATUS} ${dtRef.toFormat(
        'dd/MM/yyyy',
      )}: \n${TelegramBot.printJSON(qLoad)}`,
      {
        reply_to_message_id: msg.message_id,
      },
    );
  }

  private async schedule(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_EMPTY_DATA,
          {
            reply_to_message_id: msg.message_id,
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
        msg.chat.id,
        `${this.messages.MSG_COMMAND_SCHEDULE_SHOW}\n${TelegramBot.printJSON(
          res,
        )}`,
        {
          reply_to_message_id: msg.message_id,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_EMPTY_DATA,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }

      await this.bot.sendMessage(
        msg.chat.id,
        this.messages.MSG_COMMAND_SCHEDULE_ON.replace('$1', updated),
        {
          reply_to_message_id: msg.message_id,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_EMPTY_DATA,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }

      await this.bot.sendMessage(
        msg.chat.id,
        this.messages.MSG_COMMAND_SCHEDULE_OFF.replace('$1', updated),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    if (args[0].match(/MAXINSTANCES=[0-9]\s[A-Za-z0-9_-]+$/gi)) {
      if (user.type < TUserType.OWNER) {
        await this.bot.sendMessage(
          msg.chat.id,
          this.messages.MSG_ACCESS_DENIED,
          {
            reply_to_message_id: msg.message_id,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_SINTAX,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }

      if (!updated || parseInt(updated) === 0) {
        await this.bot.sendMessage(
          msg.chat.id,
          this.messages.MSG_COMMAND_EMPTY_DATA,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }

      await this.bot.sendMessage(
        msg.chat.id,
        this.messages.MSG_COMMAND_SCHEDULE_MAXINSTANCES,
        {
          reply_to_message_id: msg.message_id,
        },
      );
    } else {
      await this.bot.sendMessage(
        msg.chat.id,
        this.messages.MSG_COMMAND_INVALID_SINTAX,
        {
          reply_to_message_id: msg.message_id,
        },
      );
    }
  }

  private async user(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_EMPTY_DATA,
          {
            reply_to_message_id: msg.message_id,
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
        msg.chat.id,
        `${this.messages.MSG_COMMAND_USER_SHOW}\n${TelegramBot.printJSON(res)}`,
        {
          reply_to_message_id: msg.message_id,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_SINTAX,
          {
            reply_to_message_id: msg.message_id,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_SINTAX,
          {
            reply_to_message_id: msg.message_id,
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
        msg.chat.id,
        this.messages.MSG_COMMAND_USER_CREATED,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    if (args[0].toUpperCase() === 'ON' || args[0].toUpperCase() === 'OFF') {
      if (args.length < 2) {
        await this.bot.sendMessage(
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_SINTAX,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }
      const upUser = (await this.bot.getUser({ username: args[1] })).user;
      if (!upUser || upUser.type === TUserType.OWNER) {
        await this.bot.sendMessage(
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_SINTAX,
          {
            reply_to_message_id: msg.message_id,
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
          ? this.messages.MSG_COMMAND_USER_ON
          : this.messages.MSG_COMMAND_USER_OFF;

      await this.bot.sendMessage(msg.chat.id, MSG, {
        reply_to_message_id: msg.message_id,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_SINTAX,
          {
            reply_to_message_id: msg.message_id,
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
            msg.chat.id,
            this.messages.MSG_COMMAND_INVALID_SINTAX,
            {
              reply_to_message_id: msg.message_id,
            },
          );
          return;
        }
      } else {
        banneduntil = null;
      }
      const upUser = (await this.bot.getUser({ username: args[1] })).user;
      if (!upUser || upUser.type === TUserType.OWNER) {
        await this.bot.sendMessage(
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_SINTAX,
          {
            reply_to_message_id: msg.message_id,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_EMPTY_DATA,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }

      // TO DO: Send email to user

      const MSG =
        args[0].toUpperCase() === 'BAN'
          ? this.messages.MSG_COMMAND_USER_BAN
          : this.messages.MSG_COMMAND_USER_UNBAN;

      await this.bot.sendMessage(msg.chat.id, MSG, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    if (
      args[0].toUpperCase() === 'PROMOTE' ||
      args[0].toUpperCase() === 'DEMOTE'
    ) {
      if (args.length < 2) {
        await this.bot.sendMessage(
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_SINTAX,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }
      const upUser = (await this.bot.getUser({ username: args[1] })).user;
      if (!upUser || upUser.type === TUserType.OWNER) {
        await this.bot.sendMessage(
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_SINTAX,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }

      let type;
      let MSG_USER;
      let MSG_ADM;
      if (args[0].toUpperCase() === 'PROMOTE') {
        type = TUserType.ADMINISTRATOR;
        MSG_USER = this.messages.MSG_COMMAND_USER_PROMOTED;
        MSG_ADM = this.messages.MSG_COMMAND_ADM_PROMOTED.replace(
          '$1',
          user.username,
        ).replace('$2', args[1]);
      } else {
        type = TUserType.DEFAULT;
        MSG_USER = this.messages.MSG_COMMAND_USER_DEMOTED;
        MSG_ADM = this.messages.MSG_COMMAND_ADM_DEMOTED.replace(
          '$1',
          user.username,
        ).replace('$2', args[1]);
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
          msg.chat.id,
          this.messages.MSG_COMMAND_EMPTY_DATA,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }

      // TO DO: Send email to user

      await this.bot.sendMessage(msg.chat.id, MSG_USER, {
        reply_to_message_id: msg.message_id,
      });

      // Inform administrators
      await this.bot.sendMessageToUsers(TUserType.OWNER, MSG_ADM, {});
    }
  }

  private async reprocess(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
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
          msg.chat.id,
          this.messages.MSG_COMMAND_INVALID_DATE,
          {
            reply_to_message_id: msg.message_id,
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
          msg.chat.id,
          `${this.messages.MSG_REPROCESS_INVALID_SCHEDULES} ${invSch.join(
            ', ',
          )}.`,
          {
            reply_to_message_id: msg.message_id,
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
            msg.chat.id,
            this.messages.MSG_COMMAND_INVALID_CRON_SCHEDULE,
            {
              reply_to_message_id: msg.message_id,
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
        msg.chat.id,
        `${this.messages.MSG_REPROCESS_CREATED} ${inserted}.`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    await this.bot.sendMessage(
      msg.chat.id,
      this.messages.MSG_COMMAND_INVALID_SINTAX,
      {
        reply_to_message_id: msg.message_id,
      },
    );
  }

  private async globalparam(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
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
        msg.chat.id,
        `${this.messages.MSG_GLOBALVAR_SHOW}\n${TelegramBot.printJSON(params)}`,
        {
          reply_to_message_id: msg.message_id,
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
        msg.chat.id,
        `${this.messages.MSG_GLOBALVAR_UPDATED}: ${args[2]}=${args[3]}`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
    } else {
      await this.bot.sendMessage(
        msg.chat.id,
        `${this.messages.MSG_GLOBALVAR_NOT_UPDATED}: ${args[2]}=${args[3]}`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
    }
  }

  private async restoredbbkp(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
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
        msg.chat.id,
        `${this.messages.MSG_COMMAND_INVALID_DATE}: ${args[1]}`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    const bkpfilename = `${
      process.env.BACKUP_FILE_PREFIX || ''
    }${dateRef.toFormat('yyyyMMdd')}.zip`;
    if (
      !(await CloudFileManager.fileExistsInCloud(
        CloudFileManager.getTsGoogleDrive(),
        bkpfilename,
        process.env.BACKUP_DB_CLOUD_FOLDER || '',
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        `${this.messages.MSG_RETOREBKPDB_FILE_NOTFOUND}: ${args[1]}`,
        {
          reply_to_message_id: msg.message_id,
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
          msg.chat.id,
          `${this.messages.MSG_RETOREBKPDB_TABLE_NOTFOUND}: ${args[0]}`,
          {
            reply_to_message_id: msg.message_id,
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
        msg.chat.id,
        `${this.messages.MSG_RETOREBKPDB_SCHEDULE_NOTACTIVE}`,
        {
          reply_to_message_id: msg.message_id,
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
      msg.chat.id,
      `${this.messages.MSG_RETOREBKPDB_SCHEDULED}: ${args[0]}`,
      {
        reply_to_message_id: msg.message_id,
      },
    );
  }
}
