/* eslint-disable no-console */
/* eslint-disable camelcase */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { ReadStream } from 'fs';
import { getConnectionManager, Connection } from 'typeorm';
import createConnection from '.';

class QueryFactory {
  private manager: Connection;

  private tries: number;

  constructor() {
    this.tries = 0;
  }

  public async initialize(connect = false): Promise<void> {
    try {
      if (connect) await createConnection();
      this.manager = getConnectionManager().get();
    } catch (e) {
      if (
        ++this.tries > parseInt(process.env.DB_CONNECT_RETRIES || '0') &&
        parseInt(process.env.DB_CONNECT_RETRIES || '0') > 0
      )
        throw new Error(
          `[DB CONNECTION] Can't connect to database after ${this.tries} retries: ${e}`,
        );

      console.warn(
        `[DB CONNECTION] Can't connect to database. New attempt in ${
          (this.tries + 1) *
          parseInt(process.env.DB_CONNECT_RETRY_INTERVAL || '10')
        }s : ${e}`,
      );
      new Promise(r =>
        setTimeout(
          r,
          1000 *
            ++this.tries *
            parseInt(process.env.DB_CONNECT_RETRY_INTERVAL || '10'),
        ),
      ).then(async () => {
        await this.initialize(true);
      });
    } finally {
      this.tries = 0;
    }
  }

  public async runQuery(sql: string, params: any): Promise<any> {
    if (sql) {
      if (!this.manager) await this.initialize();

      const rawData = await this.manager.query(
        sql,
        Object.keys(params).map(key => params[key]),
      );
      return rawData;
    }
    throw new Error(`Empty query is not allowed.`);
  }

  public async streamQuery(sql: string, params: any): Promise<ReadStream> {
    if (sql) {
      if (!this.manager) await this.initialize();

      const qRunner = this.manager.createQueryRunner();
      const readStream = await qRunner.stream(
        sql,
        params,
        () => {
          qRunner.release();
        },
        () => {
          qRunner.release();
        },
      );
      return readStream;
    }
    throw new Error(`Empty query is not allowed.`);
  }
}

export default new QueryFactory();
export { QueryFactory };
