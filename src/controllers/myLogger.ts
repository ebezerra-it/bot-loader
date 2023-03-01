import { Logger, ILogObject, TLogLevelName, TLogLevelId } from 'tslog';
import fs, { appendFileSync } from 'fs';
import axios, { AxiosInstance } from 'axios';
import https from 'https';
import path from 'path';
import { DateTime } from 'luxon';

class MyLogger extends Logger {
  apiBot: AxiosInstance;

  constructor(botLogger = true) {
    super({
      dateTimeTimezone: process.env.TZ || 'America/Sao_Paulo',
      dateTimePattern: 'day-month-year hour:minute:second.millisecond',
    });
    this.attachTransport(
      {
        silly: botLogger
          ? this.loggerEvent.bind(this)
          : this.logToFile.bind(this),
        debug: botLogger
          ? this.loggerEvent.bind(this)
          : this.logToFile.bind(this),
        trace: botLogger
          ? this.loggerEvent.bind(this)
          : this.logToFile.bind(this),
        info: botLogger
          ? this.loggerEvent.bind(this)
          : this.logToFile.bind(this),
        warn: botLogger
          ? this.loggerEvent.bind(this)
          : this.logToFile.bind(this),
        error: botLogger
          ? this.loggerEvent.bind(this)
          : this.logToFile.bind(this),
        fatal: botLogger
          ? this.loggerEvent.bind(this)
          : this.logToFile.bind(this),
      },
      'silly',
    );
    this.apiBot = axios.create();
    this.apiBot.defaults.httpsAgent = new https.Agent({
      requestCert: true,
      ca: fs.readFileSync(path.join(__dirname, '../../cert/web/cert.pem')),
      rejectUnauthorized: true,
      keepAlive: false,
    });
    this.apiBot.defaults.headers = {
      'Content-Type': 'application/json',
      crossDomain: false,
    };
  }

  public async botlogEvent(logObject: ILogObject): Promise<undefined | string> {
    try {
      const res = await this.apiBot.post(
        `https://localhost:${process.env.TELEGRAM_API_PORT || '443'}/tracelog`,
        {
          m: logObject.argumentsArray.join('\n'),
        },
      );

      if (res.status !== 200) {
        const msg = `[BOT-LOGEVENT] Can't log event due to return status code: ${res.status} - ${res.statusText}`;
        // eslint-disable-next-line no-console
        console.error(msg);
        return msg;
      }
      return undefined;
    } catch (err) {
      const msg = `[BOT-LOGEVENT] Can't log event due to error: ${err.message}`;
      // eslint-disable-next-line no-console
      console.error(msg);
      return msg;
    }
  }

  public logToFile(logObject: ILogObject): void {
    const filename = path.resolve(
      `${__dirname}/../../${process.env.LOG_FILES_DIRECTORY || 'log'}/${
        process.env.LOG_FILES_PREFIX || ''
      }${DateTime.now().toFormat('yyyyMMdd')}.log`,
    );

    try {
      appendFileSync(filename, `${JSON.stringify(logObject)}\n`);
      return;
    } catch (err) {
      const errMsg = `[SERVICE STOPED] LOGEVENT ERROR - Could not write to log file ${filename} due to error: ${err.message}`;
      // eslint-disable-next-line no-console
      console.error(errMsg);
      logObject.argumentsArray.push(errMsg);
      this.botlogEvent(logObject);

      process.stdin.emit('SIGTERM', errMsg);
    }
  }

  async loggerEvent(logObject: ILogObject): Promise<void> {
    this.logToFile(logObject);

    const tsLogLevels: TLogLevelName[] = [
      'silly',
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ];

    let idMinLevelBotLog: TLogLevelId;
    try {
      idMinLevelBotLog = <TLogLevelId>(
        tsLogLevels.indexOf(
          <TLogLevelName>(process.env.BOT_TRACELOG_MIN_LOG_LEVEL || 'error'),
        )
      );

      // MIN_LOG_LEVEL = 'info'
      if (
        idMinLevelBotLog <
        <TLogLevelId>tsLogLevels.indexOf(<TLogLevelName>'info')
      )
        idMinLevelBotLog = <TLogLevelId>(
          tsLogLevels.indexOf(<TLogLevelName>'info')
        );
    } catch (err) {
      const msg = `[BOT-LOGEVENT] Parameter BOT_TRACELOG_MIN_LOG_LEVEL with invalid content was adjusted to 'error': ${err.message}`;
      logObject.argumentsArray.push(msg);
      this.logToFile(logObject);
      this.botlogEvent(logObject);
      idMinLevelBotLog = <TLogLevelId>(
        tsLogLevels.indexOf(<TLogLevelName>'error')
      );
      process.env.BOT_TRACELOG_MIN_LOG_LEVEL = 'error';
    }

    if (logObject.logLevelId >= idMinLevelBotLog) {
      const errMsg = await this.botlogEvent(logObject);

      if (errMsg) {
        logObject.argumentsArray.push(errMsg);
        this.logToFile(logObject);
      }
    }
  }
}

export default MyLogger;
