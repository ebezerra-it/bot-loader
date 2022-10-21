/* eslint-disable no-nested-ternary */
import path from 'path';
import ejs from 'ejs';
import { DateTime, Duration } from 'luxon';
import { isNumber } from '../../controllers/utils';
import BaseCommands from './baseBotCommands';
import TelegramBot, { Message, TUserType } from '../telegramBot';
import ReportLoaderCalendar from '../../controllers/reportLoaderCalendar';
import { TCountryCode } from '../../controllers/tcountry';
import QueryPTAX, {
  IQueryPTAX,
  IPTAX,
} from '../../controllers/queries/queryPTAX';
import QuerySPOT, {
  ISpotSettleDate,
} from '../../controllers/queries/querySPOT';
import QueryPlayers, {
  IPosPlayersBalance,
} from '../../controllers/queries/queryPlayers';
import QueryOI from '../../controllers/queries/queryOI';
import QueryOptions, {
  TFRPCalculationType,
} from '../../controllers/queries/queryOptions';
import QueryVolatility, {
  TAssetType,
} from '../../controllers/queries/queryVolatility';
import QueryFRP0, { TContractType } from '../../controllers/queries/queryFRP0';
import QueryBrokersBalance, {
  IAsset,
} from '../../controllers/queries/queryBrokersBalance';

const MSG_INVALID_DATE = `Invalid reference date or date is weekend/holiday: $1`;
const MSG_INVALID_DATES_ORDER = `Invalid dates: date from can't be after date to.`;
const MSG_INVALID_PTAX_PRIORDAYS = `Invalid PTAX prior days. Maximum allowed: $1`;
const MSG_INVALID_DATES_RANGE = `Maximum dates range exceeded.`;
const MSG_INVALID_SAMPLE_SIZE = `Invalid sample size.`;

class QueryCommands extends BaseCommands {
  constructor(bot: TelegramBot) {
    super(bot);

    this.botCommands.push({
      name: 'queryPtax',
      regEx: new RegExp(
        /^\/query\sPTAX(\s\d\d\/\d\d\/\d\d\d\d)?(\s[0-9]+)?$/gi,
      ),
      procedure: this.queryPtax,
    });

    this.botCommands.push({
      name: 'queryPtaxD1',
      regEx: new RegExp(
        /^\/query\sPTAXD1(\s\d\d\/\d\d\/\d\d\d\d)?(\s\d+)?(\s\d+\.?\d*)?$/gi,
      ),
      procedure: this.queryPtaxD1,
    });

    this.botCommands.push({
      name: 'queryFRP0',
      regEx: new RegExp(
        /^\/query\sFRP0(\sCURRENT|\sNEXT)?(\s\d\d\/\d\d\/\d\d\d\d)?(\s\d\d\/\d\d\/\d\d\d\d)?$/gi,
      ),
      procedure: this.queryFRP0,
    });

    this.botCommands.push({
      name: 'queryOptions',
      regEx: new RegExp(/^\/query\sOPTIONS(\s\d\d\/\d\d\/\d\d\d\d)?$/gi),
      procedure: this.queryOptions,
    });

    this.botCommands.push({
      name: 'queryVolatility',
      regEx: new RegExp(
        /^\/query\sVOLATILITY(\s\d\d\/\d\d\/\d\d\d\d)?(\s[0-9]+)\s(DAY|WEEK|MONTH)$/gi,
      ),
      procedure: this.queryVolatility,
    });

    this.botCommands.push({
      name: 'querySpot',
      regEx: new RegExp(
        /^\/query\sSPOT(\s\d\d\/\d\d\/\d\d\d\d)?(\s(\d+))?(\s(\d+\.?\d*))?$/gi,
      ),
      procedure: this.querySpot,
    });

    this.botCommands.push({
      name: 'queryPlayers',
      regEx: new RegExp(
        /^\/query\sPLAYERS\s(DOL|IND)(\s\d\d\/\d\d\/\d\d\d\d)?(\s\d\d\/\d\d\/\d\d\d\d)?$/gi,
      ),
      procedure: this.queryPlayers,
    });

    this.botCommands.push({
      name: 'queryOI',
      regEx: new RegExp(
        /^\/query\sOI\s(DOL|IND)\s([FGHJKMNQUVXZ][0-9]{2})(\s\d\d\/\d\d\/\d\d\d\d)?(\s\d\d\/\d\d\/\d\d\d\d)?$/gi,
      ),
      procedure: this.queryOI,
    });

    this.botCommands.push({
      name: 'queryBrokersBalance',
      regEx: new RegExp(
        /^\/query\sBROKERSBAL\s(DOL|IND|[A-Z0-9]+)(\s[FGHJKMNQUVXZ][0-9]{2})?\s([A-Z0-9-_]+)\s(\d\d\/\d\d\/\d\d\d\d)\s(\d\d:\d\d)(:\d\d)?$/gi,
      ),
      procedure: this.queryBrokersBal,
    });

    this.botCommands.push({
      name: 'profitPtax',
      regEx: new RegExp(
        /^\/profit\sPTAX\s(\d\d\/\d\d\/\d\d\d\d)(\s\d\d\/\d\d\/\d\d\d\d)?(\s[0-9]+)?/gi,
      ),
      procedure: this.profitPtax,
    });

    this.botCommands.push({
      name: 'profitPtaxD1',
      regEx: new RegExp(
        /^\/profit\sPTAXD1\s(\d\d\/\d\d\/\d\d\d\d)(\s\d\d\/\d\d\/\d\d\d\d)?/gi,
      ),
      procedure: this.profitPtaxD1,
    });

    this.botCommands.push({
      name: 'profitSpot',
      regEx: new RegExp(
        /^\/profit\sSPOT\s(\d\d\/\d\d\/\d\d\d\d)(\s\d\d\/\d\d\/\d\d\d\d)?$/gi,
      ),
      procedure: this.profitSpot,
    });

    this.botCommands.push({
      name: 'profitPlayers',
      regEx: new RegExp(
        /^\/profit\sPLAYERS\s(DOL|IND)\s(\d\d\/\d\d\/\d\d\d\d)(\s\d\d\/\d\d\/\d\d\d\d)?$/gi,
      ),
      procedure: this.profitPlayers,
    });

    this.botCommands.push({
      name: 'profitOI',
      regEx: new RegExp(
        /^\/profit\sOI\s(DOL|IND)\s([FGHJKMNQUVXZ][0-9]{2})(\s\d\d\/\d\d\/\d\d\d\d)?(\s\d\d\/\d\d\/\d\d\d\d)?$/gi,
      ),
      procedure: this.profitOI,
    });
  }

  private async queryPtax(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : a));
    args.splice(0, 1);

    const dateRef = args[0]
      ? DateTime.fromFormat(args[0], 'dd/MM/yyyy')
      : DateTime.now();
    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateRef,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateRef.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    if (
      !isNumber(args[1]) ||
      Number(args[1]) === 0 ||
      Number(args[1]) > Number(process.env.BOT_QUERY_PTAX_MAX_PRIOR_DAYS || '5')
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_PTAX_PRIORDAYS.replace(
          '$1',
          process.env.BOT_QUERY_PTAX_MAX_PRIOR_DAYS || '5',
        ),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    const priorDays = args[1] ? Number(args[1]) : 2;

    await new QueryPTAX(this.bot).process({
      dateRef,
      priorDays,
      chatId: user.chatId,
      messageId: msg.message_id,
    });
  }

  private async queryPtaxD1(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    // ^\/query\sPTAXD1(\s\d\d\/\d\d\/\d\d\d\d)?(\s\d+)?(\s\d+\.?\d*)?$
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : a));
    args.splice(0, 1);

    const dateRef = args[0]
      ? DateTime.fromFormat(args[0], 'dd/MM/yyyy')
      : DateTime.now();
    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateRef,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateRef.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    if (args[1] && (Number(args[1]) <= 0 || Number(args[1]) > 20)) {
      await this.bot.sendMessage(
        msg.chat.id,
        `Projections quantity must be between 1 and 20.`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    const projectionsQtty = !args[1] ? 6 : Number(args[1]);

    if (args[2] && (Number(args[2]) < 0.1 || Number(args[2]) > 5)) {
      await this.bot.sendMessage(
        msg.chat.id,
        `Projections multiplier must be between 0.1 and 5.0`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    const projectionsMultiplier = !args[2] ? 1.0 : Number(args[2]);

    await new QueryPTAX(this.bot).process({
      dateRef,
      projectionsQtty,
      projectionsMultiplier,
      chatId: user.chatId,
      messageId: msg.message_id,
    });
  }

  private async queryOptions(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : undefined));
    args.splice(0, 1);

    const dateRef = args[0]
      ? DateTime.fromFormat(args[0], 'dd/MM/yyyy')
      : DateTime.now();

    if (dateRef.weekday === 6 || dateRef.weekday === 7) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateRef.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    await new QueryOptions(this.bot).process({
      dateRef,
      frpCalculationType: TFRPCalculationType.SETTLE_D1,
      chatId: user.chatId,
      messageId: msg.message_id,
    });
  }

  private async queryVolatility(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : undefined));
    args.splice(0, 1);

    const dateRef = args[0]
      ? DateTime.fromFormat(args[0], 'dd/MM/yyyy')
      : DateTime.now();

    if (dateRef.weekday === 6 || dateRef.weekday === 7) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateRef.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const sampleQtty =
      args[1] && Number(args[1]) > 0 ? Number(args[1]) : undefined;

    if (!sampleQtty) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_SAMPLE_SIZE, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    const sampleSize =
      args[2]!.toUpperCase() === 'DAY'
        ? Duration.fromObject({ days: sampleQtty })
        : args[2]!.toUpperCase() === 'WEEK'
        ? Duration.fromObject({ weeks: sampleQtty })
        : args[2]!.toUpperCase() === 'MONTH'
        ? Duration.fromObject({ months: sampleQtty })
        : Duration.fromObject({ days: sampleQtty });

    await new QueryVolatility(this.bot).process({
      dateRef,
      sampleSize,
      assetType: TAssetType.FUTURE,
      assets: [
        { asset: 'DOL', weight: 1 },
        { asset: 'WDO', weight: 0.2 },
      ],
      chatId: user.chatId,
      messageId: msg.message_id,
    });
  }

  private async queryFRP0(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    // /query\sFRP0(\sCURRENT|\sNEXT)?(\s\d\d\/\d\d\/\d\d\d\d)?(\s\d\d\/\d\d\/\d\d\d\d)?$/gi
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : undefined));
    args.splice(0, 1);

    const contractType =
      !args[0] || args[0] === TContractType.CURRENT
        ? TContractType.CURRENT
        : TContractType.NEXT;

    const dateFrom = args[1]
      ? DateTime.fromFormat(args[1], 'dd/MM/yyyy')
      : DateTime.now();

    if (dateFrom.weekday === 6 || dateFrom.weekday === 7) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateFrom.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const dateTo = args[2]
      ? DateTime.fromFormat(args[2], 'dd/MM/yyyy')
      : dateFrom;

    if (dateFrom.startOf('day').toMillis() > dateTo.startOf('day').toMillis()) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_ORDER, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    await new QueryFRP0(this.bot).process({
      dateFrom,
      dateTo,
      contractType,
      prefD1FRP1: true,
      chatId: user.chatId,
      messageId: msg.message_id,
    });
  }

  private async querySpot(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : undefined));
    args.splice(0, 1);

    const dateRef = args[0]
      ? DateTime.fromFormat(args[0], 'dd/MM/yyyy')
      : DateTime.now();

    // Treatment for trading days holidays
    const qSPOT = await this.bot.queryFactory.runQuery(
      `SELECT COUNT(*) qte FROM "b3-spotexchange" 
      WHERE "avgrate-d1-settledate" = $1 OR "avgrate-d2-settledate" = $1`,
      {
        dateRef: dateRef.toJSDate(),
      },
    );

    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateRef,
        TCountryCode.BR,
      )) &&
      Number(qSPOT[0].qte) === 0
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateRef.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    if (args[1] && (Number(args[1]) <= 0 || Number(args[1]) > 20)) {
      await this.bot.sendMessage(
        msg.chat.id,
        `Spot projections must be between 1 and 20.`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    const spotProjectionsQtty = !args[1] ? 6 : Number(args[1]);

    if (args[3] && (Number(args[3]) < 0.1 || Number(args[3]) > 5)) {
      await this.bot.sendMessage(
        msg.chat.id,
        `Spot projections must be between 0.1 and 5.0`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    const spotProjectionsMultiplier = !args[3] ? 1.0 : Number(args[3]);

    await new QuerySPOT(this.bot).process({
      dateRef,
      dateRefFRP: true,
      spotProjectionsQtty,
      spotProjectionsMultiplier,
      chatId: user.chatId,
      messageId: msg.message_id,
    });
  }

  private async queryPlayers(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : a));
    args.splice(0, 1);

    let assets;
    switch (args[0]) {
      case 'DOL':
        assets = [
          { asset: 'DOL', weight: 1 },
          { asset: 'WDO', weight: 0.2 },
        ];
        break;
      case 'IND':
        assets = [
          { asset: 'IND', weight: 1 },
          { asset: 'WIN', weight: 0.2 },
        ];
        break;
      default:
        assets = [{ asset: args[0], weight: 1 }];
    }

    const dateFrom = args[1]
      ? DateTime.fromFormat(args[1], 'dd/MM/yyyy')
      : DateTime.now();

    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateFrom,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateFrom.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const dateTo = args[2]
      ? DateTime.fromFormat(args[2], 'dd/MM/yyyy')
      : undefined;

    if (dateTo) {
      if (
        !(await ReportLoaderCalendar.isTradeDay(
          this.bot.queryFactory,
          dateTo,
          TCountryCode.BR,
        ))
      ) {
        await this.bot.sendMessage(
          msg.chat.id,
          MSG_INVALID_DATE.replace(/\$1/g, dateTo.toFormat('dd/MM/yyyy')),
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }

      if (dateFrom.startOf('day') >= dateTo.startOf('day')) {
        await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_ORDER, {
          reply_to_message_id: msg.message_id,
        });
        return;
      }
    }

    await new QueryPlayers(this.bot).process({
      dateFrom: dateTo ? dateFrom : undefined,
      dateTo: dateTo || dateFrom,
      assets,
      chatId: user.chatId,
      messageId: msg.message_id,
    });
  }

  private async queryOI(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : a));
    args.splice(0, 1);

    let assets;
    switch (args[0]) {
      case 'DOL':
        assets = [
          { asset: 'DOL', weight: 1 },
          { asset: 'WDO', weight: 0.2 },
        ];
        break;
      case 'IND':
        assets = [
          { asset: 'IND', weight: 1 },
          { asset: 'WIN', weight: 0.2 },
        ];
        break;
      default:
        assets = [{ asset: args[0], weight: 1 }];
    }

    const contract = args[1];

    const dateFrom = args[2]
      ? DateTime.fromFormat(args[2], 'dd/MM/yyyy')
      : undefined;

    if (
      dateFrom &&
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateFrom,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateFrom.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const dateTo = args[3]
      ? DateTime.fromFormat(args[3], 'dd/MM/yyyy')
      : undefined;

    if (
      dateTo &&
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateTo,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateTo.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    if (dateFrom && dateTo && dateFrom.startOf('day') > dateTo.startOf('day')) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_ORDER, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    await new QueryOI(this.bot).process({
      contract,
      assets,
      dateFrom,
      dateTo,
      chatId: user.chatId,
      messageId: msg.message_id,
    });
  }

  private async queryBrokersBal(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : a));
    args.splice(0, 1);

    const contract = args[1];
    let assets: IAsset[];
    switch (args[0]) {
      case 'DOL':
        assets = [
          { name: `DOL${contract}`, weight: 1 },
          { name: `WDO${contract}`, weight: 0.2 },
        ];
        break;
      case 'IND':
        assets = [
          { name: `IND${contract}`, weight: 1 },
          { name: `WIN${contract}`, weight: 0.2 },
        ];
        break;
      default:
        assets = [{ name: String(args[0]), weight: 1 }];
    }

    const visionName = args[2];

    let dateRef: DateTime;

    if (args[5]) {
      dateRef = DateTime.fromFormat(
        `${args[3]} ${args[4]}`,
        'dd/MM/yyyy HH:mm',
      );
    } else {
      dateRef = DateTime.fromFormat(
        `${args[3]} ${args[4]}${args[5]}`,
        'dd/MM/yyyy HH:mm:ss',
      );
    }

    if (
      !dateRef.isValid ||
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateRef,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(
          /\$1/g,
          dateRef.isValid
            ? dateRef.toFormat('dd/MM/yyyy HH:mm:ss')
            : `${args[3]} ${args[4]}${args[5]}`,
        ),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    await new QueryBrokersBalance(this.bot).process({
      assets,
      datetime: dateRef,
      visionName,
      chatId: user.chatId,
      messageId: msg.message_id,
    });
  }

  private async profitPtax(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : a));
    args.splice(0, 1);

    const dateFrom = DateTime.fromFormat(args[0], 'dd/MM/yyyy');
    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateFrom,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateFrom.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const dateTo = args[1]
      ? DateTime.fromFormat(args[1], 'dd/MM/yyyy')
      : DateTime.now();

    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateTo,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateTo.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    if (dateFrom.startOf('day') > dateTo.startOf('day')) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_ORDER, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    if (
      (await ReportLoaderCalendar.differenceInTradeDays(
        this.bot.queryFactory,
        dateFrom,
        dateTo,
        TCountryCode.BR,
      )) > parseInt(process.env.BOT_QUERY_MAXIMUM_DATES_RANGE || '260')
    ) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_RANGE, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    if (
      (args[2] && !isNumber(args[2])) ||
      Number(args[2]) === 0 ||
      Number(args[2]) > Number(process.env.BOT_QUERY_PTAX_MAX_PRIOR_DAYS || '5')
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_PTAX_PRIORDAYS.replace(
          '$1',
          process.env.BOT_QUERY_PTAX_MAX_PRIOR_DAYS || '5',
        ),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }
    const priorDays = args[2] ? Number(args[2]) : 2;

    let dateRef = dateFrom;
    while (dateRef <= dateTo) {
      dateRef = dateRef.plus({ days: 1 });

      const aPTAX: IQueryPTAX[] = [];
      const qPTAX: IQueryPTAX | undefined = await new QueryPTAX(
        this.bot,
      ).calculateAverage(dateRef, Number(priorDays));
      if (qPTAX) aPTAX.push(qPTAX);

      while (
        !(await ReportLoaderCalendar.isTradeDay(
          this.bot.queryFactory,
          dateRef,
          TCountryCode.BR,
        ))
      ) {
        dateRef = dateRef.plus({ days: 1 });
      }

      const msgHeader = `PROFIT PTAX - Date From: ${dateFrom.toFormat(
        'dd/MM/yyyy',
      )} - Date To: ${dateTo.toFormat('dd/MM/yyyy')}\n`;
      if (aPTAX.length === 0) {
        this.bot.sendMessage(
          msg.chat.id,
          `${msgHeader}Not enought data.`,

          { reply_to_message_id: msg.message_id },
        );
      }

      const profit = await ejs.renderFile(
        `${path.resolve(`${__dirname}/../templates`)}/profitPTAX.ejs`,
        {
          qte: aPTAX.length,
          ptax: aPTAX.map(p => {
            return {
              date: `1${p.mergedPTAX.date.toFormat('yyMMdd')}`,
              fut_vwap: p.mergedPTAX.ptax_future_vwap,
              spot_vwap: p.mergedPTAX.ptax_spot_vwap,
              fut_avg: p.mergedPTAX.ptax_future_avg,
              spot_avg: p.mergedPTAX.ptax_spot_avg,
            };
          }),
        },
      );

      const filename = `profitPTAX_${
        msg.from?.username
      }_${DateTime.now().toFormat('yyyyMMddHHmmss')}.pas`;
      const stream = Buffer.from(profit, 'utf-8');
      await this.bot.sendDocument(
        msg.chat.id,
        stream,
        {
          caption: msgHeader,
          reply_to_message_id: msg.message_id,
        },
        {
          filename,
          contentType: 'text/plain',
        },
      );
    }
  }

  private async profitPtaxD1(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : a));
    args.splice(0, 1);

    const dateFrom = DateTime.fromFormat(args[0], 'dd/MM/yyyy');
    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateFrom,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateFrom.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const dateTo = args[1]
      ? DateTime.fromFormat(args[1], 'dd/MM/yyyy')
      : DateTime.now();

    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateTo,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateTo.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    if (dateFrom.startOf('day') > dateTo.startOf('day')) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_ORDER, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    if (
      (await ReportLoaderCalendar.differenceInTradeDays(
        this.bot.queryFactory,
        dateFrom,
        dateTo,
        TCountryCode.BR,
      )) > parseInt(process.env.BOT_QUERY_MAXIMUM_DATES_RANGE || '260')
    ) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_RANGE, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    let dateRef = dateFrom;
    const aPTAX: any[] = [];
    while (dateRef <= dateTo) {
      const qPTAX: IPTAX | undefined = await new QueryPTAX(this.bot).getD1PTAX(
        dateRef,
      );

      if (qPTAX) {
        const qHighLow = await this.bot.queryFactory.runQuery(
          `SELECT MAX(high) AS high, MIN(low) AS low FROM "b3-ts-summary" WHERE asset = ANY($1) AND "timestamp-open"::DATE=$2`,
          {
            asset: [
              `DOL${qPTAX.frp0.contract.code}`,
              `WDO${qPTAX.frp0.contract.code}`,
            ],
            dateref: qPTAX.date.toJSDate(),
          },
        );
        aPTAX.push({
          ...qPTAX,
          high:
            qHighLow && qHighLow.length > 0
              ? qHighLow.map((q: any) => +Number(q.high).toFixed(2))
              : 0,
          low:
            qHighLow && qHighLow.length > 0
              ? qHighLow.map((q: any) => +Number(q.low).toFixed(2))
              : 0,
        });
      }

      dateRef = dateRef.plus({ days: 1 });
      while (
        dateRef.weekday === 6 ||
        dateRef.weekday === 7 ||
        !(await ReportLoaderCalendar.isTradeDay(
          this.bot.queryFactory,
          dateRef,
          TCountryCode.BR,
        ))
      ) {
        dateRef = dateRef.plus({ days: 1 });
      }
    }

    const msgHeader = `PROFIT PTAX - Date From: ${dateFrom.toFormat(
      'dd/MM/yyyy',
    )} - Date To: ${dateTo.toFormat('dd/MM/yyyy')}\n`;
    if (aPTAX.length === 0) {
      this.bot.sendMessage(
        msg.chat.id,
        `${msgHeader}Not enought data.`,

        { reply_to_message_id: msg.message_id },
      );
    }

    const profit = await ejs.renderFile(
      `${path.resolve(`${__dirname}/../templates`)}/profitPTAXD1.ejs`,
      {
        qte: aPTAX.length,
        ptax: aPTAX.map(p => {
          return {
            date: `1${p.date.toFormat('yyMMdd')}`,
            ptax: p.ptax,
            band1: p.frp0.traded
              ? p.frp0.traded.vwap
              : p.frp0.calculated.close_d1 && p.frp0.calculated.close_d1 > 0
              ? p.frp0.calculated.close_d1
              : p.frp0.calculated.settle_d1 && p.frp0.calculated.settle_d1 > 0
              ? p.frp0.calculated.settle_d1
              : 0,
            band2:
              p.frp0Next && p.frp0Next.calculated
                ? p.frp0Next.calculated.close_d1 &&
                  p.frp0Next.calculated.close_d1 > 0
                  ? p.frp0Next.calculated.close_d1
                  : p.frp0Next.calculated.settle_d1 &&
                    p.frp0Next.calculated.settle_d1 > 0
                  ? p.frp0Next.calculated.settle_d1
                  : 0
                : 0,
            high: p.high,
            low: p.low,
          };
        }),
      },
    );

    const filename = `profitPTAXD1_${
      msg.from?.username
    }_${DateTime.now().toFormat('yyyyMMddHHmmss')}.pas`;
    const stream = Buffer.from(profit, 'utf-8');
    await this.bot.sendDocument(
      msg.chat.id,
      stream,
      {
        caption: msgHeader,
        reply_to_message_id: msg.message_id,
      },
      {
        filename,
        contentType: 'text/plain',
      },
    );
  }

  private async profitSpot(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : a));
    args.splice(0, 1);

    const dateFrom = DateTime.fromFormat(args[0], 'dd/MM/yyyy');
    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateFrom,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateFrom.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const dateTo = args[1]
      ? DateTime.fromFormat(args[1], 'dd/MM/yyyy')
      : DateTime.now();

    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateTo,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateTo.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    if (dateFrom.startOf('day') > dateTo.startOf('day')) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_ORDER, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    if (
      (await ReportLoaderCalendar.differenceInTradeDays(
        this.bot.queryFactory,
        dateFrom,
        dateTo,
        TCountryCode.BR,
      )) > parseInt(process.env.BOT_QUERY_MAXIMUM_DATES_RANGE || '260')
    ) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_RANGE, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    let dateRef = dateFrom;
    const aSPOT: any[] = [];
    const dateRefFRP = true;

    while (dateRef <= dateTo) {
      const qSPOT: ISpotSettleDate | undefined = await new QuerySPOT(
        this.bot,
      ).calculateSpotForSettleDate(dateRef, dateRefFRP);
      if (qSPOT)
        aSPOT.push({
          date: qSPOT.today.date,
          vwap_d2: qSPOT.priorDays[0].vwap,
          vwap_d1: qSPOT.priorDays[1].vwap,
          vwap_d0: qSPOT.today.vwap,
          high_d2: qSPOT.priorDays[0].high,
          high_d1: qSPOT.priorDays[1].high,
          high_d0: qSPOT.today.high,
          low_d2: qSPOT.priorDays[0].low,
          low_d1: qSPOT.priorDays[1].low,
          low_d0: qSPOT.today.low,
          close_d2: qSPOT.priorDays[0].close,
          close_d1: qSPOT.priorDays[1].close,
          close_d0: qSPOT.today.close,
          band_d2: qSPOT.priorDays[0].frp0.today,
          band_d1: qSPOT.priorDays[1].frp0.today,
          band_d0: qSPOT.today.frp0.today,
          vol_d2: Math.trunc(qSPOT.priorDays[0].volume),
          vol_d1: Math.trunc(qSPOT.priorDays[1].volume),
          vol_d0: Math.trunc(qSPOT.today.volume),
        });

      dateRef = dateRef.plus({ days: 1 });
      while (
        !(await ReportLoaderCalendar.isTradeDay(
          this.bot.queryFactory,
          dateRef,
          TCountryCode.BR,
        ))
      ) {
        dateRef = dateRef.plus({ days: 1 });
      }
    }

    const msgHeader = `PROFIT SPOT - Date From: ${dateFrom.toFormat(
      'dd/MM/yyyy',
    )} - Date To: ${dateTo.toFormat('dd/MM/yyyy')}\n`;
    if (aSPOT.length === 0) {
      this.bot.sendMessage(
        msg.chat.id,
        `${msgHeader}Not enought data.`,

        { reply_to_message_id: msg.message_id },
      );
    }

    const profit = await ejs.renderFile(
      `${path.resolve(`${__dirname}/../templates`)}/profitSPOT.ejs`,
      {
        qte: aSPOT.length,
        spot: aSPOT.map(p => {
          return {
            date: `1${p.date.toFormat('yyMMdd')}`,
            vwap_d2: p.vwap_d2,
            vwap_d1: p.vwap_d1,
            vwap_d0: p.vwap_d0,

            high_d2: p.high_d2,
            high_d1: p.high_d1,
            high_d0: p.high_d0,

            low_d2: p.low_d2,
            low_d1: p.low_d1,
            low_d0: p.low_d0,

            close_d2: p.close_d2,
            close_d1: p.close_d1,
            close_d0: p.close_d0,

            band_d2: p.band_d2,
            band_d1: p.band_d1,
            band_d0: p.band_d0,

            vol_d2: p.vol_d2,
            vol_d1: p.vol_d1,
            vol_d0: p.vol_d0,
          };
        }),
      },
    );

    const filename = `profitSPOT_${
      msg.from?.username
    }_${DateTime.now().toFormat('yyyyMMddHHmmss')}.pas`;
    const stream = Buffer.from(profit, 'utf-8');
    await this.bot.sendDocument(
      msg.chat.id,
      stream,
      {
        caption: msgHeader,
        reply_to_message_id: msg.message_id,
      },
      {
        filename,
        contentType: 'text/plain',
      },
    );
  }

  private async profitPlayers(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : a));
    args.splice(0, 1);

    let assets;
    switch (args[0]) {
      case 'DOL':
        assets = [
          { asset: 'DOL', weight: 1 },
          { asset: 'WDO', weight: 0.2 },
        ];
        break;
      case 'IND':
        assets = [
          { asset: 'IND', weight: 1 },
          { asset: 'WIN', weight: 0.2 },
        ];
        break;
      default:
        assets = [{ asset: args[0], weight: 1 }];
    }

    const dateFrom = DateTime.fromFormat(args[1], 'dd/MM/yyyy');
    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateFrom,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateFrom.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const dateTo = args[2]
      ? DateTime.fromFormat(args[2], 'dd/MM/yyyy')
      : DateTime.now();

    if (
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateTo,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateTo.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    if (dateFrom.startOf('day') > dateTo.startOf('day')) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_ORDER, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    if (
      (await ReportLoaderCalendar.differenceInTradeDays(
        this.bot.queryFactory,
        dateFrom,
        dateTo,
        TCountryCode.BR,
      )) > parseInt(process.env.BOT_QUERY_MAXIMUM_DATES_RANGE || '260')
    ) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_RANGE, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    let dateRef = dateFrom;
    while (dateRef <= dateTo) {
      dateRef = dateRef.plus({ days: 1 });

      const aPlayers: any[] = [];
      const qPlayers: IPosPlayersBalance | undefined = await new QueryPlayers(
        this.bot,
      ).getPlayersBalance(dateRef, assets);
      if (qPlayers) aPlayers.push(qPlayers.balance);

      while (
        !(await ReportLoaderCalendar.isTradeDay(
          this.bot.queryFactory,
          dateRef,
          TCountryCode.BR,
        ))
      ) {
        dateRef = dateRef.plus({ days: 1 });
      }

      const msgHeader = `PROFIT PLAYERS - Date From: ${dateFrom.toFormat(
        'dd/MM/yyyy',
      )} - Date To: ${dateTo.toFormat('dd/MM/yyyy')}\n`;
      if (aPlayers.length === 0) {
        this.bot.sendMessage(
          msg.chat.id,
          `${msgHeader}Not enought data.`,

          { reply_to_message_id: msg.message_id },
        );
      }

      const profit = await ejs.renderFile(
        `${path.resolve(`${__dirname}/../templates`)}/profitPlayers.ejs`,
        {
          qte: aPlayers.length,
          players: aPlayers.map(p => {
            return {
              date: `1${p.date.toFormat('yyMMdd')}`,
              foreignBal: p.foreignBal,
              nationalBal: p.nationalBal,
              bankBal: p.bankBal,
            };
          }),
        },
      );

      const filename = `profitPLAYERS_${
        msg.from?.username
      }_${DateTime.now().toFormat('yyyyMMddHHmmss')}.pas`;
      const stream = Buffer.from(profit, 'utf-8');
      await this.bot.sendDocument(
        msg.chat.id,
        stream,
        {
          caption: msgHeader,
          reply_to_message_id: msg.message_id,
        },
        {
          filename,
          contentType: 'text/plain',
        },
      );
    }
  }

  private async profitOI(
    msg: Message,
    match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.checkAuth(
      msg,
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const args = match!.map(a => (a ? a.trim().toUpperCase() : a));
    args.splice(0, 1);

    let assets;
    switch (args[0]) {
      case 'DOL':
        assets = [
          { asset: 'DOL', weight: 1 },
          { asset: 'WDO', weight: 0.2 },
        ];
        break;
      case 'IND':
        assets = [
          { asset: 'IND', weight: 1 },
          { asset: 'WIN', weight: 0.2 },
        ];
        break;
      default:
        assets = [{ asset: args[0], weight: 1 }];
    }

    const contract = args[1];

    const dateFrom = args[2]
      ? DateTime.fromFormat(args[2], 'dd/MM/yyyy')
      : undefined;

    if (
      dateFrom &&
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateFrom,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateFrom.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const dateTo = args[3]
      ? DateTime.fromFormat(args[3], 'dd/MM/yyyy')
      : DateTime.now();

    if (
      dateTo &&
      !(await ReportLoaderCalendar.isTradeDay(
        this.bot.queryFactory,
        dateTo,
        TCountryCode.BR,
      ))
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        MSG_INVALID_DATE.replace(/\$1/g, dateTo.toFormat('dd/MM/yyyy')),
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    if (dateFrom && dateTo && dateFrom.startOf('day') > dateTo.startOf('day')) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_ORDER, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    const { resOI, firstDate, lastDate } = await new QueryOI(
      this.bot,
    ).calculate(contract, assets, dateTo, dateFrom);

    const msgHeader = `PROFIT OI - Date From: ${
      firstDate ? firstDate.toFormat('dd/MM/yyyy') : 'First contract date'
    } - Date To: ${
      lastDate ? lastDate.toFormat('dd/MM/yyyy') : 'Last contract date'
    }\n`;
    if (!resOI || resOI.OIDates.length === 0) {
      this.bot.sendMessage(
        msg.chat.id,
        `${msgHeader}Not enought data.`,

        { reply_to_message_id: msg.message_id },
      );
      return;
    }

    const profit = await ejs.renderFile(
      `${path.resolve(`${__dirname}/../templates`)}/profitOI.ejs`,
      {
        qte: resOI.OIDates.length,
        oi: resOI.OIDates.map(p => {
          return {
            date: `1${p.date.date.toFormat('yyMMdd')}`,
            vwap: p.updatedOIPoint?.level,
            highSD: p.updatedOIPoint?.highSD,
            lowSD: p.updatedOIPoint?.lowSD,
            volume: p.updatedOIPoint?.volume,
          };
        }),
      },
    );

    const filename = `profitOI_${assets
      .map(a => a.asset)
      .join('_')}_${contract}_${msg.from?.username}_${DateTime.now().toFormat(
      'yyyyMMddHHmmss',
    )}.pas`;
    const stream = Buffer.from(profit, 'utf-8');
    await this.bot.sendDocument(
      msg.chat.id,
      stream,
      {
        caption: msgHeader,
        reply_to_message_id: msg.message_id,
      },
      {
        filename,
        contentType: 'text/plain',
      },
    );
  }
}

export default QueryCommands;
