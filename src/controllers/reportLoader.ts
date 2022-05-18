/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Logger } from 'tslog';
import axios from 'axios';
import { DateTime } from 'luxon';
import { QueryFactory } from '../db/queryFactory';
import { TCountryCode, getExchanges } from './tcountry';

async function sleep(seconds: number): Promise<void> {
  if (seconds > 0) {
    await new Promise(r => setTimeout(r, 1000 * seconds));
  }
}

interface ILoadResult {
  deleted: number;
  inserted: number;
}

abstract class ReportLoader {
  processName: string;

  logger: Logger;

  queryFactory: QueryFactory;

  constructor(processName: string, logger: Logger, queryFactory: QueryFactory) {
    this.processName = processName;
    this.logger = logger;
    this.queryFactory = queryFactory;
  }

  abstract performQuery(params: any): Promise<any>;

  async sleep(seconds: number): Promise<void> {
    if (seconds > 0) {
      await new Promise(r => setTimeout(r, 1000 * seconds));
    }
  }

  abstract process(params: any): Promise<any>;

  async retry(queryParams: any, botevent = false): Promise<any> {
    let tries = 0;
    let result;

    for (;;) {
      try {
        if (botevent) result = await this.performQueryEvent(queryParams);
        else result = await this.performQuery({ ...queryParams, tries });
        break;
      } catch (e) {
        if (
          ++tries >= parseInt(process.env.QUERY_RETRIES || '-1') &&
          parseInt(process.env.QUERY_RETRIES || '-1') >= 0
        ) {
          this.logger.error(
            `[${this.processName}] Query failed. Maximum retries reached.`,
          );
          throw e;
        }

        let retryInterval = parseInt(process.env.QUERY_RETRY_INTERVAL || '5');
        if (process.env.QUERY_RETRY_EXPONENTIAL === 'TRUE')
          retryInterval =
            parseInt(process.env.QUERY_RETRY_INTERVAL || '5') ** tries;
        retryInterval =
          retryInterval >
          parseInt(process.env.QUERY_RETRY_EXPONENTIAL_MAX || '3600')
            ? parseInt(process.env.QUERY_RETRY_EXPONENTIAL_MAX || '3600')
            : retryInterval;

        this.logger.info(
          `[${this.processName}] Query failed. New retry attempt in ${retryInterval}s: ${e.message}`,
        );

        await this.sleep(retryInterval);
      }
    }

    return result;
  }

  async throwBotEvent(event: string, params: any): Promise<boolean> {
    try {
      const res = await this.retry(
        {
          url: `http://localhost:${
            process.env.TELEGRAM_API_PORT || '8001'
          }/event`,
          postData: {
            e: event,
            p: params,
          },
        },
        true,
      );

      if (res.status !== 200)
        throw new Error(
          `Message: ${res.msg} - Status: ${res.status} ${res.statusText}`,
        );
    } catch (err) {
      this.logger.error(
        `[${this.processName}] - Params: ${JSON.stringify(
          params,
        )} - Bot event error - Event: ${event} - Error: ${err.message}`,
      );
    }
    return true;
  }

  async performQueryEvent(queryParams: any): Promise<any> {
    return axios({
      method: 'post',
      url: queryParams.url,
      data: queryParams.postData,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /* async loadJSONFile(pathFileName: string): Promise<any | undefined> {
    return ReportLoader.loadJSONFile(pathFileName);
  }

  public static async loadJSONFile(
    pathFileName: string,
  ): Promise<any | undefined> {
    return JSON.parse(fs.readFileSync(pathFileName, 'utf-8'));
  } */

  public static async isHoliday(
    queryfactory: QueryFactory,
    date: DateTime,
    countryCode: TCountryCode,
  ): Promise<boolean> {
    const qCalendar = await queryfactory.runQuery(
      `SELECT event from "holiday-calendar" WHERE "country-code"=$1 AND date=$2`,
      {
        country: countryCode,
        date: date.toJSDate(),
      },
    );

    return !!(qCalendar && qCalendar.length > 0);
  }

  public async allExchangesHoliday(dateRef: DateTime): Promise<boolean> {
    const exchanges = getExchanges();
    let allHoliday = false;
    for await (const exchange of exchanges) {
      if (
        await ReportLoader.isHoliday(
          this.queryFactory,
          dateRef,
          exchange.country.code,
        )
      )
        allHoliday = true;
      break;
    }

    return allHoliday;
  }
}

export default ReportLoader;
export { ILoadResult, sleep };
