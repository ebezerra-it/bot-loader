/* eslint-disable camelcase */
/* eslint-disable no-restricted-syntax */
import path from 'path';
import fs from 'fs';
import jsonminify from 'jsonminify';
import { DateTime } from 'luxon';
import ReportLoader, { ILoadResult } from '../reportLoader';
import { QueryFactory } from '../../db/queryFactory';
import TelegramBot from '../../bot/telegramBot';
import { IUser } from '../../bot/baseBot';

interface IGlobalParameter {
  key: string;
  value: string;
  lastupdate_user: string;
  lastupdate_date: DateTime;
}

class GlobalParameters extends ReportLoader {
  performQuery(): Promise<any> {
    throw new Error('Method not implemented.');
  }

  async process(params: { dateMatch: DateTime }): Promise<ILoadResult> {
    this.logger.silly(
      `[${
        this.processName
      }] - Process started - DateMatch: ${params.dateMatch.toFormat(
        'dd/MM/yyyy HH:mm:ssZ',
      )}`,
    );

    return this.load();
  }

  public async init(reset = false): Promise<ILoadResult> {
    return GlobalParameters.init(this.queryFactory, reset);
  }

  public static async init(
    queryFactory: QueryFactory,
    reset = false,
  ): Promise<ILoadResult> {
    const globalparamsFilePath = path.join(
      __dirname,
      '../../../config/',
      'globalparameters.jsonc',
    );

    const jsonString = jsonminify(
      fs.readFileSync(globalparamsFilePath).toString(),
    );

    let envConfig: any;
    try {
      envConfig = JSON.parse(jsonString.toString());
    } catch (e) {
      throw new Error(
        `Exception thrown on parsing JSON global parameters file: ${globalparamsFilePath}`,
      );
    }

    let deleted = '0';
    if (reset) {
      [, deleted] = await queryFactory.runQuery(
        `DELETE FROM "global-parameters"`,
        {},
      );
    }
    let inserted = 0;

    for await (const key of Object.keys(envConfig)) {
      await queryFactory.runQuery(
        `INSERT INTO "global-parameters" 
          (key, value, "lastupdate-user", "lastupdate-ts") 
          VALUES ($1, $2, $3, $4) ON CONFLICT(key) DO 
          ${
            reset
              ? 'UPDATE SET value=$2, "lastupdate-user"=$3, "lastupdate-ts"=$4'
              : 'NOTHING'
          }`,
        {
          key,
          value: String(envConfig[key]),
          user: process.env.TELEGRAM_BOT_USER_ID || '0',
          ts: DateTime.now().toJSDate(),
        },
      );
      inserted++;
    }

    // Forces service to start on init()
    await queryFactory.runQuery(
      `UPDATE "global-parameters" SET value=$2, "lastupdate-user"=$3, "lastupdate-ts"=$4 WHERE key=$1`,
      {
        key: 'RUN_SERVICE',
        value: 'TRUE',
        user: process.env.TELEGRAM_BOT_USER_ID || '0',
        ts: DateTime.now().toJSDate(),
      },
    );

    await GlobalParameters.load(queryFactory);

    return { inserted, deleted: parseInt(deleted) };
  }

  private async load(): Promise<ILoadResult> {
    const inserted = await GlobalParameters.load(this.queryFactory);

    return { inserted, deleted: 0 };
  }

  public static async load(queryFactory: QueryFactory): Promise<number> {
    const qParams: IGlobalParameter[] = await queryFactory.runQuery(
      `SELECT * FROM "global-parameters" ORDER BY key ASC`,
      {},
    );
    qParams.forEach(param => {
      process.env[param.key] = param.value;
    });

    return qParams.length;
  }

  public static async updateParameter(
    key: string,
    value: string,
    user: IUser,
    queryfactory: QueryFactory,
  ): Promise<boolean> {
    if (!key) return false;
    try {
      const [, updated] = await queryfactory.runQuery(
        `UPDATE "global-parameters" SET value=$1, "lastupdate-user"=$2, "lastupdate-ts"=$3 WHERE key=$4`,
        {
          value,
          user: user.id,
          ts: DateTime.now().toJSDate(),
          key,
        },
      );
      if (parseInt(updated) === 0) return false;
    } catch (e) {
      return false;
    } finally {
      process.env[key] = value;
    }
    return true;
  }

  public static async getParameters(
    queryfactory: QueryFactory,
  ): Promise<IGlobalParameter[]> {
    const globalParameters: IGlobalParameter[] = [];

    const qParams = await queryfactory.runQuery(
      `SELECT key, value, "lastupdate-user" as lastupdateuser, 
      "lastupdate-ts" as lastupdatets FROM "global-parameters" ORDER BY key ASC`,
      {},
    );

    if (qParams && qParams.length > 0) {
      for await (const p of qParams) {
        const { user } = await TelegramBot.getBotUser(queryfactory, {
          id: p.lastupdateuser,
        });

        globalParameters.push({
          key: p.key,
          value: p.value,
          lastupdate_date: p.lastupdatets,
          lastupdate_user: user
            ? user.username
            : `UNKNOWN ID: ${p.lastupdateuser}`,
        });
      }
    }

    return globalParameters;
  }
}

export default GlobalParameters;
export { IGlobalParameter };
