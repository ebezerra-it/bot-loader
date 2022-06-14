/* eslint-disable no-case-declarations */
import { Router } from 'express';
import { DateTime } from 'luxon';
import { isNumber } from '../controllers/utils';
import TelegramBot, {
  TUserType,
  TUserReturnAuthType,
} from '../bot/telegramBot';
import QueryPTAX from '../controllers/queries/queryPTAX';
import QuerySPOT from '../controllers/queries/querySPOT';
import BaseRoutes from './baseRoutes';
import ExchangesCaladendar from '../controllers/loaders/exchangesCaladendar';

export default class BotRoutes extends BaseRoutes {
  public async getRouter(): Promise<Router> {
    const router: Router = Router();
    router.post('/tracelog', this.blockRemoteCall, async (req, res) => {
      const { m } = req.body;

      try {
        this.bot.sendMessageToUsers(
          TUserType.ADMINISTRATOR,
          m,
          {},
          true,
          process.env.TELEGRAM_TRACELOG_MESSAGE_CAPTION || '',
        );
      } catch (error) {
        this.logger.error(
          `[BOT-API] BOT route /tracelog exception: ${error.message}`,
        );
        res.status(500).send({ msg: `Exception thrown: ${error.message}` });
      }
      res.status(200).send({ msg: `Command executed successfully.` });
    });

    router.post('/sendmsg', this.blockRemoteCall, async (req, res) => {
      const { t, u, m } = req.body; // t - TUserType; u - userId; m - message
      try {
        if ((t === undefined && u === undefined) || m === undefined)
          throw new Error(`Missing parameters: t=${t}, u=${u}, m=${m}`);
        if (u !== undefined) {
          const { authType, user } = await this.bot.getUser({ id: u });
          if (authType !== TUserReturnAuthType.AUTH || !user) return;
          this.bot.sendMessage(user.chatId, m);
        } else {
          this.bot.sendMessageToUsers(t, m);
        }
      } catch (error) {
        this.logger.error(
          `[BOT-API] BOT route /sendmsg exception: ${error.message}`,
        );
        res.status(500).send({ msg: `Exception thrown: ${error.message}` });
      }
      res.status(200).send({ msg: `Command executed successfully.` });
    });

    router.post('/event', this.blockRemoteCall, async (req, res) => {
      const { e, p } = req.body;

      try {
        const dateRef = DateTime.fromJSDate(new Date(p.d));
        if (!dateRef.isValid)
          throw new Error(
            `Invalid date parameter - Params: ${JSON.stringify(p)}`,
          );

        switch (String(e).toUpperCase()) {
          default:
          case 'PTAX-USD':
            await new QueryPTAX(this.bot).process({
              dateRef,
              priorDays: p.q && isNumber(p.q) ? Number(p.q) : 2,
            });
            break;
          case 'SPOT-USD':
            await new QuerySPOT(this.bot).process(
              {
                dateRef,
              },
              true,
            );
            break;
          case 'ECONOMIC-CALENDAR':
            const resEvent = await ExchangesCaladendar.getEconomicCalendarEvent(
              this.queryfactory,
              dateRef,
              p.cc,
              p.e.event,
            );

            this.bot.sendMessageToUsers(
              TUserType.DEFAULT,
              `ECONOMIC CALENDAR EVENT:\n${TelegramBot.printJSON(resEvent)}`,
              {},
            );
            break;
        }
        return res.status(200).send({ msg: `Command executed successfully.` });
      } catch (error) {
        this.logger.error(
          `[BOT-API] BOT route /event exception: ${
            error.message
          } - Body: ${JSON.stringify(req.body)}`,
        );
        return res
          .status(500)
          .send({ msg: `Exception thrown: ${error.message}` });
      }
    });

    return router;
  }
}
