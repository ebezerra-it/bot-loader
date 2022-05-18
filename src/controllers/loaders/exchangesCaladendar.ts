/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable global-require */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
import { DateTime } from 'luxon';
import axios from 'axios';
import FormData from 'form-data';
import { parse as parseHTML } from 'node-html-parser';
import { isNumber } from '../utils';
import { ILoadResult } from '../reportLoader';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import {
  TCountryCode,
  TCurrencyCode,
  ICountry,
  getCountries,
} from '../tcountry';
import { QueryFactory } from '../../db/queryFactory';

interface IHoliday {
  date: DateTime;
  countryCode: TCountryCode;
  currencyCode: TCurrencyCode;
  event: string;
}

interface ICalendarEventValue {
  value: number;
  unit: string | undefined;
}

interface ICalendarEvent {
  date: DateTime;
  time: DateTime | undefined; // undefined = all day event
  country: ICountry;
  importance: number;
  event: string;
  previous:
    | {
        publicated: ICalendarEventValue | undefined;
        revised: ICalendarEventValue | undefined;
      }
    | ICalendarEventValue
    | undefined;
  actual: ICalendarEventValue | undefined;
  forecast: ICalendarEventValue | undefined;
}

class ExchangesCalendarLoader extends ReportLoaderCalendar {
  async performQuery(params: {
    url: string;
    data: any;
    type: string;
  }): Promise<any> {
    if (params.type === 'INVESTING.COM') {
      // ATTENTION: investing.com => to avoid post axios bug, provide 'www' subdomain, when missing and provide a rightmost forwardslash '/'
      // https://mydomain.com/api => https://www.mydomain.com/api/
      const data = new FormData();
      Object.keys(params.data).forEach(key => {
        data.append(key, params.data[key]);
      });

      return (
        await axios.post(params.url, data, {
          headers: {
            ...data.getHeaders(),
            'x-requested-with': 'XMLHttpRequest',
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
          },
        })
      ).data;
    }

    throw new Error(`Missing TYPE parameter in PerformQuery function`);
  }

  async process(params: { dateRef: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );
    const loadResults: ILoadResult[] = [];

    const resCal = await this.processUpdateHolidayCalendar(params.dateRef);
    this.logger.info(
      `[${
        this.processName
      }] HolidayCalendar - DateRef: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )} - Calendar update: ${JSON.stringify(resCal)}`,
    );
    loadResults.push(resCal);

    const resEcoCal = await this.processEconomicCalendarLoad(params.dateRef);
    this.logger.info(
      `[${
        this.processName
      }] EconomicCalendar - DateRef: ${params.dateRef.toFormat(
        'dd/MM/yyyy',
      )} - Calendar update: ${JSON.stringify(resEcoCal)}`,
    );
    loadResults.push(resEcoCal);

    return loadResults.length > 0
      ? loadResults.reduce((total, result) => {
          return {
            inserted: total.inserted + result.inserted,
            deleted: total.deleted + result.deleted,
          };
        })
      : { inserted: 0, deleted: 0 };
  }

  public async processUpdateHolidayCalendar(
    dateRef: DateTime,
  ): Promise<ILoadResult> {
    const yearFrom = dateRef.year;
    const yearTo = dateRef.plus({ weeks: 1 }).year; // Looks for 1 week forward

    const dtFrom = DateTime.fromFormat(`01/01/${yearFrom}`, 'dd/MM/yyyy');
    const dtTo = DateTime.fromFormat(`31/12/${yearTo}`, 'dd/MM/yyyy');

    const countries: ICountry[] = getCountries();
    const loadResults: ILoadResult[] = [];

    for (let i = 0; i < countries.length; i++) {
      if (countries[i].code === TCountryCode.EU) continue; // EURO ZONE doesn't have holidays
      if (i > 0) {
        await this.sleep(parseInt(process.env.QUERY_INTERVAL || '2'));
      }

      const res = await this.updateHolidayCalendar(countries[i], dtFrom, dtTo);
      loadResults.push(res);

      this.logger.silly(
        `[${this.processName}] - HolidayCalendar - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Date from: [${dtFrom.toFormat(
          'dd/MM/yyyy',
        )}] - Date to: [${dtTo.toFormat('dd/MM/yyyy')}] - Country: ${
          countries[i].code
        }: ${JSON.stringify(res)}`,
      );
    }

    return loadResults.length > 0
      ? loadResults.reduce((total, result) => {
          return {
            inserted: total.inserted + result.inserted,
            deleted: total.deleted + result.deleted,
          };
        })
      : { inserted: 0, deleted: 0 };
  }

  public async updateHolidayCalendar(
    country: ICountry,
    dtFrom: DateTime,
    dtTo: DateTime,
  ): Promise<ILoadResult> {
    const url =
      'https://www.investing.com/holiday-calendar/Service/getCalendarFilteredData/';

    const data = {
      country: country.investingId,
      dateFrom: dtFrom.toFormat('yyyy-MM-dd'),
      dateTo: dtTo.toFormat('yyyy-MM-dd'),
    };

    const htmlPTAX = await this.retry({
      url,
      data,
      type: 'INVESTING.COM',
    });

    const root = parseHTML(
      htmlPTAX.data.replace(/\\n\s*/g, '').replace(/\\n\t*/g, ''),
    );

    const res: IHoliday[] = [];
    const trs = root.querySelectorAll('tr');
    trs.every(tr => {
      if (!tr) {
        throw new Error(`Can´t understand layout: TR`);
      } else {
        const tds = tr.querySelectorAll('td');
        if (!tds) {
          throw new Error(`Can´t understand layout: NO TD`);
        } else if (tds.length < 4) {
          throw new Error(
            `Can´t understand layout: INSUFICIENT TDS - ${tds.length}`,
          );
        } else {
          const date = DateTime.fromFormat(tds[0].text.trim(), 'MMM dd, yyyy');
          const event = tds[3].text.trim().replace(/\s{2,}/g, ' ');

          if (!date.isValid || event === '') {
            this.logger.silly(
              `[${this.processName}] - Country: ${country.code} - Date: ${tds[0].text} - Event: ${event} - Invalid holiday date.`,
            );
          } else {
            res.push({
              date,
              countryCode: country.code,
              currencyCode: country.currencyCode,
              event,
            });
          }
        }
      }
      return true;
    });

    let inserted = 0;
    let deleted;
    if (res.length > 0) {
      res.sort((a, b) => {
        if (a.date > b.date) return 1;
        if (a.date < b.date) return -1;
        return 0;
      });
      const aDtFrom = res[0].date;
      const aDtTo = res[res.length - 1].date;

      [, deleted] = await this.queryFactory.runQuery(
        `DELETE FROM "holiday-calendar" 
        WHERE "country-code"=$1 AND date::DATE>=$2::DATE AND date::DATE<=$3::DATE`,
        {
          countryCode: country.code,
          aDtFrom: aDtFrom.toJSON(),
          aDtTo: aDtTo.toJSON(),
        },
      );

      const sql = `INSERT INTO "holiday-calendar" 
      ("country-code", date, "currency-code", event, "updated-at") 
      VALUES ($1, $2::DATE, $3, $4, $5)`;

      for (let i = 0; i < res.length; i++) {
        await this.queryFactory.runQuery(sql, {
          countryCode: res[i].countryCode,
          date: res[i].date.toJSON(),
          currencyCode: res[i].currencyCode,
          event: res[i].event,
          updatedAt: new Date(),
        });

        inserted++;
      }
    }
    return { inserted, deleted: parseInt(deleted) || 0 };
  }

  private async processEconomicCalendarLoad(
    dateRef: DateTime,
  ): Promise<ILoadResult> {
    const loadResults: ILoadResult[] = [];
    const countries = getCountries().filter(c =>
      String(process.env.BOT_EVENT_ECONOMIC_CALENDAR_CURRENCIES_LIST)
        .split(',')
        .find(cc => cc.trim().toUpperCase() === c.currencyCode),
    );

    for (let i = 0; i < countries.length; i++) {
      if (i > 0) await this.sleep(Number(process.env.QUERY_INTERVAL || '2'));

      const country = countries[i];
      const res = await this.economicCalendarLoad(dateRef, country);
      this.logger.silly(
        `[${this.processName}] EconomicCalendar - Date: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Country: ${country.code}: ${JSON.stringify(res)}`,
      );
      loadResults.push(res);
    }

    return loadResults.length > 0
      ? loadResults.reduce((total, result) => {
          return {
            inserted: total.inserted + result.inserted,
            deleted: total.deleted + result.deleted,
          };
        })
      : { inserted: 0, deleted: 0 };
  }

  private async economicCalendarLoad(
    dateRef: DateTime,
    country: ICountry,
  ): Promise<ILoadResult> {
    const url =
      'https://www.investing.com/economic-calendar/Service/getCalendarFilteredData/';

    const data = {
      'country[]': country.investingId,
      dateFrom: dateRef.toFormat('yyyy-MM-dd'),
      dateTo: dateRef.toFormat('yyyy-MM-dd'),
      timeZone: Number(process.env.CALENDAR_INVESTINGCOM_TIMEZONE || '12'),
      timeFilter: 'timeOnly',
    };

    const html = await this.retry({
      url,
      data,
      type: 'INVESTING.COM',
    });
    const fixedHtml = html.data.replace(/<\\\//g, '</').replace(/\\"/g, '"');

    const root = parseHTML(fixedHtml);
    const trs = root.querySelectorAll('tr');

    if (!trs || trs.length === 0)
      throw new Error(
        `Unable to read economic calendar <no TR> - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Country: ${country.code}`,
      );

    const trDate = trs.splice(0, 1);
    const tdDate = trDate[0].querySelector('td');

    if (tdDate.text.trim().toUpperCase() === 'NO EVENTS SCHEDULED')
      return { inserted: 0, deleted: 0 };

    if (
      !tdDate ||
      !DateTime.fromFormat(tdDate.text.trim(), 'EEEE, MMMM d, yyyy').isValid ||
      !dateRef.hasSame(
        DateTime.fromFormat(tdDate.text.trim(), 'EEEE, MMMM d, yyyy'),
        'day',
      )
    ) {
      throw new Error(
        `Unable to read economic calendar <invalid TD-DATE> - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Country: ${country.code} - TD-DATE: ${tdDate.text.trim()}`,
      );
    }

    const aEvents: ICalendarEvent[] = [];
    trs.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (!tds || tds.length === 0 || (tds.length !== 4 && tds.length !== 8)) {
        this.logger.warn(
          `${
            this.processName
          } Economic Calendar - Invalid TD size for TR - TD_SIZE: ${
            tds ? tds.length : undefined
          } `,
        );
        return;
      }
      const eventText = tds[3].text.trim().replace(/\s{2,}/g, ' ');
      if (tds.length === 4) {
        aEvents.push({
          date: dateRef,
          time: undefined,
          country,
          importance: 0,
          event: eventText,
          previous: undefined,
          actual: undefined,
          forecast: undefined,
        });
      } else {
        const getValue = (
          value: string,
        ): { value: number; unit: string | undefined } | undefined => {
          let numValue;
          let unit;
          const match = value.trim().match(/([-]?[0-9]+)(\.[0-9]*)?([%A-Z]?)/);
          if (match && match.length > 0) {
            numValue = Number(`${match[1]}${match[2] || ''}`);
            unit = match[3] ? match[3] : undefined;
          } else return undefined;

          return !isNumber(numValue)
            ? undefined
            : {
                value: Number(numValue),
                unit,
              };
        };

        let importance = 0;
        if (tds[2].hasAttribute('data-img_key')) {
          const matchBulls = tds[2]
            .getAttribute('data-img_key')
            ?.trim()
            .toLowerCase()
            .match(/bull([1-3])/);
          if (matchBulls && matchBulls.length > 0)
            importance = Number(matchBulls[1]);
        }

        const previous = getValue(tds[6].text.trim());
        let prevRevised;
        const spanRevised = tds[6].querySelector('span');
        if (spanRevised && spanRevised.hasAttribute('title')) {
          const matchRevised = spanRevised
            .getAttribute('title')
            ?.trim()
            .toLowerCase()
            .match(/Revised From (.*)$/);

          if (matchRevised && matchRevised.length > 0)
            prevRevised = getValue(matchRevised[1].toString());
        }
        const actual = getValue(tds[4].text);
        const forecast = getValue(tds[5].text);
        const time = DateTime.fromFormat(
          `${dateRef.toFormat('dd/MM/yyyy')} ${tds[0].text.trim()}`,
          'dd/MM/yyyy HH:mm',
          { zone: this.exchange.timezone },
        );

        aEvents.push({
          date: dateRef,
          country,
          time: time.isValid ? time : undefined,
          importance,
          event: eventText,
          previous: prevRevised
            ? { publicated: previous, revised: prevRevised }
            : previous,
          actual,
          forecast,
        });
      }
    });

    if (aEvents.length === 0) return { inserted: 0, deleted: 0 };

    const sql = `INSERT INTO "economic-calendar" 
    (date, "country-code", "timestamp-event", event, importance, previous, actual, forecast, unit)
    VALUES ($1::DATE, $2, $3, $4, $5, $6, $7, $8, $9) 
    ON CONFLICT (date, "country-code", event) 
    DO UPDATE SET "timestamp-event"=$3, importance=$5, previous=$6, actual=$7, forecast=$8, unit=$9`;

    // delete removed events
    const [, deleted] = await this.queryFactory.runQuery(
      `DELETE FROM "economic-calendar" WHERE  date=$1 AND "country-code"=$2 AND NOT (("country-code"::TEXT || event) = ANY($3))`,
      {
        date: dateRef.toJSDate(),
        countryCode: country.code,
        events: aEvents.map(e => `${e.country.code}${e.event}`),
      },
    );

    let inserted = 0;
    for await (const event of aEvents) {
      const qEvent = await this.queryFactory.runQuery(
        `SELECT * FROM "economic-calendar" 
        WHERE date=$1 AND "country-code"=$2 AND event=$3`,
        {
          date: event.date.toJSDate(),
          countryCode: event.country.code,
          event: event.event,
        },
      );

      await this.queryFactory.runQuery(sql, {
        date: event.date.toJSDate(),
        countryCode: event.country.code,
        time: event.time?.toJSDate(),
        event: event.event,
        importance: event.importance,
        previous: !event.previous
          ? undefined
          : 'revised' in event.previous
          ? event.previous.revised?.value
          : event.previous.value,
        actual: event.actual ? event.actual.value : undefined,
        forecast: event.forecast ? event.forecast.value : undefined,
        unit: !event.previous
          ? undefined
          : 'revised' in event.previous
          ? event.previous.revised?.unit
          : event.previous.unit,
      });
      inserted++;

      if (qEvent && qEvent.length > 0 && !qEvent[0].actual) {
        if (
          dateRef.hasSame(DateTime.now(), 'day') &&
          event.time &&
          DateTime.now().diff(event.time, 'minutes').minutes <=
            parseInt(
              process.env.BOT_EVENT_ECONOMIC_CALENDAR_MAXIMUM_DELAY_MINUTES ||
                '10',
            ) &&
          event.actual &&
          event.actual.value
        ) {
          if (
            (process.env.BOT_EVENT_ECONOMIC_CALENDAR_CURRENCIES_LIST || '')
              .split(',')
              .find(
                c => String(c).trim().toUpperCase() === country.currencyCode,
              ) &&
            Number(
              process.env.BOT_EVENT_ECONOMIC_CALENDAR_MINIMUM_IMPORTANCE || '',
            ) >= event.importance
          ) {
            try {
              this.throwBotEvent('ECONOMIC-CALENDAR', {
                d: event.date.toJSDate(),
                cc: event.country.code,
                e: event,
              });
            } catch (err) {
              this.logger.warn(
                `[${
                  this.processName
                }] Economic Calendar - Date: ${dateRef.toFormat(
                  'dd/MM/yyyy',
                )} - Country: ${country.code} - Unable to send bot-event: ${
                  event.event
                }: ${err.message}`,
              );
            }
          }
        }
      }
    }

    return { inserted, deleted: parseInt(deleted) };
  }

  public static async getEconomicCalendarEvent(
    queryFactory: QueryFactory,
    date: DateTime,
    countryCode: TCountryCode,
    event: string,
  ): Promise<any | undefined> {
    const qEvent = await queryFactory.runQuery(
      `SELECT date, "country-code" country, "timestamp-event" time, event, 
      importance, previous, forecast, actual, unit 
      FROM "economic-calendar" 
      WHERE date::DATE=$1::DATE AND "country-code"=$2 AND event=$3`,
      {
        date: date.toJSON(),
        countryCode,
        event,
      },
    );

    if (qEvent && qEvent.length > 0)
      return {
        date: date.toFormat('dd/MM/yyyy'),
        country: getCountries().find(c => c.code === countryCode)!.name,
        time: DateTime.fromJSDate(qEvent[0].time).toFormat('HH:mm'),
        importance: qEvent[0].importance,
        event: qEvent[0].event,
        previous: qEvent[0].previous
          ? { value: qEvent[0].previous, unit: qEvent[0].unit }
          : undefined,
        forecast: qEvent[0].forecast
          ? { value: qEvent[0].forecast, unit: qEvent[0].unit }
          : undefined,
        actual: qEvent[0].actual
          ? { value: qEvent[0].actual, unit: qEvent[0].unit }
          : undefined,
      };

    return undefined;
  }
}

export default ExchangesCalendarLoader;
