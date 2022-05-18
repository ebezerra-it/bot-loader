import { Logger } from 'tslog';
import { DateTime } from 'luxon';
import ReportLoader from './reportLoader';
import { QueryFactory } from '../db/queryFactory';
import {
  TTimezone,
  TCountryCode,
  TExchange,
  IExchange,
  getExchange,
} from './tcountry';

abstract class ReportLoaderCalendar extends ReportLoader {
  exchange: IExchange;

  constructor(
    processName: string,
    logger: Logger,
    queryFactory: QueryFactory,
    exchange: TExchange,
  ) {
    super(processName, logger, queryFactory);
    this.exchange = getExchange(exchange)!;
  }

  public async isHoliday(date: DateTime): Promise<boolean> {
    return ReportLoaderCalendar.isHoliday(
      this.queryFactory,
      date,
      this.exchange.country.code,
    );
  }

  public static async addTradeDays(
    queryfactory: QueryFactory,
    dateRef: DateTime,
    daysToAdd: number,
    countryCode: TCountryCode,
  ): Promise<DateTime> {
    let date: DateTime = dateRef;
    for (let i = 0; i < daysToAdd; i++) {
      date = date.plus({ days: 1 });
      while (
        !(await ReportLoaderCalendar.isTradeDay(
          queryfactory,
          date,
          countryCode,
        ))
      ) {
        date = date.plus({ days: 1 });
      }
    }
    return date;
  }

  public static async subTradeDays(
    queryfactory: QueryFactory,
    dateRef: DateTime,
    daysToSub: number,
    countryCode: TCountryCode,
  ): Promise<DateTime> {
    let date: DateTime = dateRef;
    for (let i = 0; i < daysToSub; i++) {
      date = date.minus({ days: 1 });
      while (
        !(await ReportLoaderCalendar.isTradeDay(
          queryfactory,
          date,
          countryCode,
        ))
      ) {
        date = date.minus({ days: 1 });
      }
    }
    return date;
  }

  public static async isTradeDay(
    queryfactory: QueryFactory,
    dateRef: DateTime,
    countryCode: TCountryCode,
  ): Promise<boolean> {
    if (
      !dateRef.isValid ||
      dateRef.weekday === 6 || // Saturday
      dateRef.weekday === 7 || // Sunday
      (await ReportLoaderCalendar.isHoliday(queryfactory, dateRef, countryCode))
    )
      return false;
    return true;
  }

  public async isTradeDay(
    dateRef: DateTime,
    countryCode: TCountryCode,
  ): Promise<boolean> {
    return ReportLoaderCalendar.isTradeDay(
      this.queryFactory,
      dateRef,
      countryCode,
    );
  }

  public async addTradeDays(
    dateRef: DateTime,
    daysToAdd: number,
    countryCode: TCountryCode,
  ): Promise<DateTime> {
    return ReportLoaderCalendar.addTradeDays(
      this.queryFactory,
      dateRef,
      daysToAdd,
      countryCode,
    );
  }

  public async subTradeDays(
    dateRef: DateTime,
    daysToSub: number,
    countryCode: TCountryCode,
  ): Promise<DateTime> {
    return ReportLoaderCalendar.subTradeDays(
      this.queryFactory,
      dateRef,
      daysToSub,
      countryCode,
    );
  }

  public static async differenceInTradeDays(
    queryFactory: QueryFactory,
    date1: DateTime,
    date2: DateTime,
    countryCode: TCountryCode,
  ): Promise<number> {
    let countTradeDays = 0;
    const diffDays = date1
      .startOf('day')
      .diff(date2.startOf('day'), 'days').days;
    const increment = diffDays / Math.abs(diffDays);
    for (let i = 1; i !== diffDays; i += increment) {
      const d = date1.plus({ days: i * increment });
      if (await this.isTradeDay(queryFactory, d, countryCode)) countTradeDays++;
    }

    return countTradeDays;
  }

  public async differenceInTradeDays(
    date1: DateTime,
    date2: DateTime,
    countryCode: TCountryCode,
  ): Promise<number> {
    return ReportLoaderCalendar.differenceInTradeDays(
      this.queryFactory,
      date1,
      date2,
      countryCode,
    );
  }

  public futuresContractConvert2DigitsYear(
    contract: string,
    dateRef: DateTime,
  ): string | undefined {
    const symbol = contract.match(/^(F|G|H|J|K|M|N|Q|U|V|X|Z)(\d)$/);
    if (!symbol) return undefined;

    let date: DateTime;
    if (!dateRef || !dateRef.isValid) date = DateTime.now();
    else date = dateRef;

    const decadeRef = Number(String(date.year).substr(2, 1));
    const yearUnitRef = Number(String(date.year).substr(3, 1));

    let year;

    if (yearUnitRef <= Number(symbol[2])) year = `${decadeRef}${symbol[2]}`;
    else year = `${decadeRef + 1}${symbol[2]}`;

    return `${symbol[1]}${year}`;
  }
}

export default ReportLoaderCalendar;
export { TTimezone };
