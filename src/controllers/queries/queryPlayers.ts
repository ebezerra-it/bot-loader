/* eslint-disable no-return-assign */
/* eslint-disable no-param-reassign */
import { DateTime } from 'luxon';
import Query from './query';
import TelegramBot, { TUserType } from '../../bot/telegramBot';

interface IAssetWeight {
  asset: string;
  weight: number;
}

interface IPosPlayers {
  date: DateTime;
  foreignBuy: number;
  foreignSell: number;
  foreignBal: number;
  nationalBuy: number;
  nationalSell: number;
  nationalBal: number;
  bankBuy: number;
  bankSell: number;
  bankBal: number;
}

interface IPosPlayersBalance {
  posPlayers: IPosPlayers[];
  balance: {
    date: DateTime;
    foreignBal: number;
    nationalBal: number;
    bankBal: number;
  };
}

class QueryPlayers extends Query {
  public async process(params: {
    assets: IAssetWeight[];
    dateFrom: DateTime;
    dateTo: DateTime;
    chatId?: number;
    messageId?: number;
  }): Promise<boolean> {
    const resPlayers = await this.getPlayersBalance(
      params.dateFrom,
      params.assets,
    );

    const msgHeader = `Players Balance - Date: ${params.dateFrom.toFormat(
      'dd/MM/yyyy',
    )}\n`;
    let botResponse;

    if (resPlayers) botResponse = TelegramBot.printJSON(resPlayers);
    else botResponse = 'Not enought data.';

    if (params.chatId) {
      this.bot.sendMessage(
        params.chatId,
        `${msgHeader}${botResponse}`,
        params.messageId
          ? { reply_to_message_id: params.messageId }
          : undefined,
      );
    } else {
      this.bot.sendMessageToUsers(
        TUserType.DEFAULT,
        botResponse,
        {},
        false,
        msgHeader,
      );
    }
    return !!resPlayers;
  }

  public async getPlayersBalance(
    dateRef: DateTime,
    assets: IAssetWeight[],
  ): Promise<IPosPlayersBalance | undefined> {
    if (assets.length === 0) throw new Error(`Empty assets list.`);

    const aSQL: string[] = [];
    assets.forEach(a => {
      aSQL.push(`(SELECT date::DATE as date, asset, 
        ${a.weight}::NUMERIC as weight, 1 as qtty, 
        "for_inv_res2689_buy" as foreignbuy, 
        "for_inv_res2689_sell" as foreignsell, 
        "inst_inv_national_investor_buy" as nationalbuy, 
        "inst_inv_national_investor_sell" as nationalsell, 
        "fin_corp_banks_buy" as bankbuy, 
        "fin_corp_banks_sell" as banksell
        FROM "b3-openposplayers" 
        WHERE asset = '${a.asset}' and "asset-type"='FUTURES' AND date::DATE<=$1 
        ORDER BY date DESC 
        LIMIT 2)`);
    });

    const sql = `select date, sum(qtty) as qtty,
    sum(foreignbuy * weight) as foreignbuy, sum(foreignsell * weight) as foreignsell,
    sum(nationalbuy * weight) as nationalbuy, sum(nationalsell * weight) as nationalsell,
    sum(bankbuy * weight) as bankbuy, sum(banksell * weight) as banksell
    from 
    (${aSQL.join(' union all ')}) q
    group by date order by date desc`;

    const qPlayers = await this.queryFactory.runQuery(sql, {
      date: dateRef.toJSDate(),
    });

    const aPlayers: IPosPlayers[] | undefined = qPlayers.map(
      (p: any): IPosPlayers => {
        return {
          date: DateTime.fromJSDate(p.date),
          foreignBuy: +Number(p.foreignbuy).toFixed(2),
          foreignSell: +Number(p.foreignsell).toFixed(2),
          foreignBal: +Number(p.foreignbuy - p.foreignsell).toFixed(2),
          nationalBuy: +Number(p.nationalbuy).toFixed(2),
          nationalSell: +Number(p.nationalsell).toFixed(2),
          nationalBal: +Number(p.nationalbuy - p.nationalsell).toFixed(2),
          bankBuy: +Number(p.bankbuy).toFixed(2),
          bankSell: +Number(p.banksell).toFixed(2),
          bankBal: +Number(p.bankbuy - p.banksell).toFixed(2),
        };
      },
    );
    if (
      !aPlayers ||
      aPlayers.length < 2 ||
      qPlayers
        .map((p: any) => Number(p.qtty))
        .reduce(
          (accumulator: number, qtty: number) => (accumulator += qtty),
          0,
        ) < 4 ||
      dateRef.startOf('day').toMillis() !==
        aPlayers[0].date.startOf('day').toMillis()
    )
      return undefined;

    const res: IPosPlayersBalance = {
      posPlayers: aPlayers,
      balance: {
        date: dateRef,
        foreignBal: +Number(
          aPlayers[0].foreignBal - aPlayers[1].foreignBal,
        ).toFixed(2),
        nationalBal: +Number(
          aPlayers[0].nationalBal - aPlayers[1].nationalBal,
        ).toFixed(2),
        bankBal: +Number(aPlayers[0].bankBal - aPlayers[1].bankBal).toFixed(2),
      },
    };

    return res;
  }
}

export default QueryPlayers;
export { IAssetWeight, IPosPlayers, IPosPlayersBalance };
