import path from 'path';
import ejs from 'ejs';
import { DateTime } from 'luxon';
import { isNumber } from '../../controllers/utils';
import BaseCommands from './baseBotCommands';
import TelegramBot, { Message, TUserType } from '../telegramBot';
import ReportLoaderCalendar from '../../controllers/reportLoaderCalendar';
import { TCountryCode } from '../../controllers/tcountry';
import QueryPTAX, { IQueryPTAX } from '../../controllers/queries/queryPTAX';
import QuerySPOT, {
  ISpotSettleDate,
} from '../../controllers/queries/querySPOT';
import QueryPlayers, {
  IPosPlayersBalance,
} from '../../controllers/queries/queryPlayers';
import QueryOI from '../../controllers/queries/queryOI';

const MSG_INVALID_DATE = `Invalid reference date or date is weekend/holiday: $1`;
const MSG_INVALID_DATES_ORDER = `Invalid dates: date from can't be after date to.`;
const MSG_INVALID_PTAX_PRIORDAYS = `Invalid PTAX prior days. Maximum allowed: $1`;
const MSG_INVALID_DATES_RANGE = `Maximum dates range exceeded.`;

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
      name: 'querySpot',
      regEx: new RegExp(/^\/query\sSPOT(\s\d\d\/\d\d\/\d\d\d\d)?$/gi),
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
      name: 'profitPtax',
      regEx: new RegExp(
        /^\/profit\sPTAX\s(\d\d\/\d\d\/\d\d\d\d)(\s\d\d\/\d\d\/\d\d\d\d)?(\s[0-9]+)?/gi,
      ),
      procedure: this.profitPtax,
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
    await new QuerySPOT(this.bot).process({
      dateRef,
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

    await new QueryPlayers(this.bot).process({
      dateFrom,
      dateTo,
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

    if (dateFrom && dateTo && dateFrom > dateTo) {
      await this.bot.sendMessage(msg.chat.id, MSG_INVALID_DATES_ORDER, {
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    await new QueryOI(this.bot).process({
      contract,
      assets,
      dateTo,
      dateFrom,
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

    if (dateFrom > dateTo) {
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
      ).calculate(dateRef, Number(priorDays));
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

    if (dateFrom > dateTo) {
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

      const aSPOT: any[] = [];
      const qSPOT: ISpotSettleDate | undefined = await new QuerySPOT(
        this.bot,
      ).calculateSpotForSettleDate(dateRef);
      if (qSPOT)
        aSPOT.push({
          date: qSPOT.today.date,
          spot_d2: qSPOT.priorDays[0].spot,
          spot_d1: qSPOT.priorDays[1].spot,
          spot_d0: qSPOT.today.spot,
          fut_d2: qSPOT.priorDays[0].future,
          fut_d1: qSPOT.priorDays[1].future,
          fut_d0: qSPOT.today.future,
        });

      while (
        !(await ReportLoaderCalendar.isTradeDay(
          this.bot.queryFactory,
          dateFrom,
          TCountryCode.BR,
        ))
      ) {
        dateRef = dateRef.plus({ days: 1 });
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
              spot_d2: p.spot_d2,
              spot_d1: p.spot_d1,
              spot_d0: p.spot_d0,
              fut_d2: p.fut_d2,
              fut_d1: p.fut_d1,
              fut_d0: p.fut_d0,
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

    if (dateFrom > dateTo) {
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

    if (dateFrom && dateTo && dateFrom > dateTo) {
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
