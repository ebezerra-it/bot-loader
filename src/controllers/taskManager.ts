/* eslint-disable no-empty */
/* eslint-disable no-restricted-syntax */
import EventEmitter from 'events';
import { CronJob, CronTime } from 'cron';
import { Logger } from 'tslog';
import { DateTime } from 'luxon';
import { parseExpression } from 'cron-parser';
import Task, { TLoadStatus } from './task';
import { QueryFactory } from '../db/queryFactory';
import { TExchange } from './tcountry';
import ReportLoader from './reportLoader';
import ReportLoaderCalendar from './reportLoaderCalendar';
import GlobalParameters from './loaders/globalParameters';
import PtaxBCB from './loaders/ptaxBCB';
import SpotExchangeB3 from './loaders/spotExchangeB3';
import SpotExchangeIntradayB3 from './loaders/spotExchangeIntradayB3';
import SummaryB3 from './loaders/summaryB3';
import SummaryCME from './loaders/summaryCME';
import PlayersB3 from './loaders/oiPlayersB3';
import ContractsB3 from './loaders/oiContractsB3';
import ExchangesCalendar from './loaders/exchangesCaladendar';
// import BackupWorker from './loaders/backupWorker';
import BackupRestoreDB from './loaders/backupRestoreDB';
import TimesNSalesB3 from './loaders/timesAndSalesB3';
import ChartLoaderCME from './loaders/chartLoaderCME';
import AssetsExpiryCME from './loaders/assetsExpiryCME';
import AssetsExpiryB3 from './loaders/assetsExpiryB3';

interface ICronJob {
  name: string;
  cron: string;
  dtRefAdj: number;
  reportLoader: ReportLoader | ReportLoaderCalendar;
  job: CronJob;
  maxInstances: number;
  instancesRunning: number;
}

class TaskManager extends EventEmitter {
  queryfactory: QueryFactory;

  logger: Logger;

  mainJob: CronJob;

  reprocessJob: CronJob;

  loaderjobs: ICronJob[];

  constructor(queryfactory: QueryFactory, logger: Logger) {
    super();
    this.queryfactory = queryfactory;
    this.logger = logger;
    this.loaderjobs = [];

    this.mainJob = new CronJob(
      process.env.PROCESS_CRON || '*/5 * * * * *',
      async () => {
        if (process.env.RUN_SERVICE !== 'TRUE') this.stop('bot user command');
        else
          await this.checkSchedules().catch(err => {
            process.stdin.emit(
              'SIGTERM',
              `[SERVICE STOPED] TaskManager.checkSchedules error: ${err.message}`,
            );
          });
      },
      null,
      false,
      process.env.TZ || 'America/Sao_Paulo',
      this,
    );

    this.reprocessJob = new CronJob(
      process.env.REPROCESS_CRON || '0 */1 * * * *',
      async () => {
        await this.reprocessSchedules().catch(err => {
          process.stdin.emit(
            'SIGTERM',
            `[SERVICE STOPED] TaskManager.reprocessSchedules error: ${err.message}`,
          );
        });
      },
      null,
      false,
      process.env.TZ || 'America/Sao_Paulo',
      this,
    );
  }

  public async startScheduler(): Promise<void> {
    const schedules: any[] = [];

    schedules.push({
      name: 'GlobalParameters',
      class: new GlobalParameters(
        'GlobalParameters',
        this.logger.getChildLogger({ name: 'GlobalParameters' }),
        this.queryfactory,
      ),
      cron: process.env.PROCESS_CRON || '*/5 * * * * *',
      dtRefAdj: 0,
    });

    schedules.push({
      name: 'PtaxBCB',
      class: new PtaxBCB(
        'PtaxBCB',
        this.logger.getChildLogger({ name: 'PtaxBCB' }),
        this.queryfactory,
        TExchange.B3,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'SpotExchangeB3',
      class: new SpotExchangeB3(
        'SpotExchangeB3',
        this.logger.getChildLogger({ name: 'SpotExchangeB3' }),
        this.queryfactory,
        TExchange.B3,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'SpotExchangeIntradayB3',
      class: new SpotExchangeIntradayB3(
        'SpotExchangeIntradayB3',
        this.logger.getChildLogger({ name: 'SpotExchangeIntradayB3' }),
        this.queryfactory,
        TExchange.B3,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'SummaryB3',
      class: new SummaryB3(
        'SummaryB3',
        this.logger.getChildLogger({ name: 'SummaryB3' }),
        this.queryfactory,
        TExchange.B3,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'SummaryCME',
      class: new SummaryCME(
        'SummaryCME',
        this.logger.getChildLogger({ name: 'SummaryCME' }),
        this.queryfactory,
        TExchange.CME,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'PlayersB3',
      class: new PlayersB3(
        'PlayersB3',
        this.logger.getChildLogger({ name: 'PlayersB3' }),
        this.queryfactory,
        TExchange.B3,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'ContractsB3',
      class: new ContractsB3(
        'ContractsB3',
        this.logger.getChildLogger({ name: 'ContractsB3' }),
        this.queryfactory,
        TExchange.B3,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'ExchangesCalendar',
      class: new ExchangesCalendar(
        'ExchangesCalendar',
        this.logger.getChildLogger({ name: 'ExchangesCalendar' }),
        this.queryfactory,
        TExchange.B3,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'BackupRestoreDB',
      class: new BackupRestoreDB(
        'BackupRestoreDB',
        this.logger.getChildLogger({ name: 'BackupRestoreDB' }),
        this.queryfactory,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'TimesNSalesB3',
      class: new TimesNSalesB3(
        'TimesNSalesB3',
        this.logger.getChildLogger({ name: 'TimesNSalesB3' }),
        this.queryfactory,
        TExchange.B3,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'ChartLoaderCME',
      class: new ChartLoaderCME(
        'ChartLoaderCME',
        this.logger.getChildLogger({ name: 'ChartLoaderCME' }),
        this.queryfactory,
        TExchange.CME,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'AssetsExpiryCME',
      class: new AssetsExpiryCME(
        'AssetsExpiryCME',
        this.logger.getChildLogger({ name: 'AssetsExpiryCME' }),
        this.queryfactory,
        TExchange.CME,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    schedules.push({
      name: 'AssetsExpiryB3',
      class: new AssetsExpiryB3(
        'AssetsExpiryB3',
        this.logger.getChildLogger({ name: 'AssetsExpiryB3' }),
        this.queryfactory,
        TExchange.B3,
      ),
      cron: process.env.DEFAULT_SCHEDULE_CRON || '0 0 0 31 2 *',
      dtRefAdj: parseInt(process.env.DEFAULT_SCHEDULE_ADJUST || '0'),
    });

    for await (const schedule of schedules) {
      const qSchedule = await this.queryfactory.runQuery(
        `INSERT INTO "loadcontrol-schedule" ("name", cron, "date-ref-adjust", 
            "max-instances", active) VALUES ($1, $2, $3, $4, false) 
            ON CONFLICT ("name") DO UPDATE SET active=false RETURNING 
            "name", cron, "date-ref-adjust" as dtrefadj, 
            "max-instances" as maxinstances, active`,
        {
          name: schedule.name,
          cron: schedule.cron,
          dtRefAdj: schedule.dtRefAdj,
          maxInstances: parseInt(
            process.env.DEFAULT_SCHEDULE_MAXINSTANCES || '1',
          ),
        },
      );

      const job: CronJob = new CronJob(
        qSchedule[0].cron,
        async () => {
          await this.processSchedule(qSchedule[0].name);
        },
        null,
        false,
        process.env.TZ || 'America/Sao_Paulo',
        this,
      );

      this.loaderjobs.push({
        name: qSchedule[0].name,
        cron: qSchedule[0].cron,
        dtRefAdj: qSchedule[0].dtrefadj,
        reportLoader: schedule.class,
        job,
        maxInstances: qSchedule[0].maxinstances,
        instancesRunning: 0,
      });
    }
  }

  public start(): void {
    if (this.mainJob) this.mainJob.start();
    if (this.reprocessJob) this.reprocessJob.start();

    this.logger.info(
      `[LOADER] - Service started: ${DateTime.now().toFormat('dd/MM/yyyy')}`,
    );
  }

  public stop(msg: string): void {
    this.loaderjobs.forEach(ijob => ijob.job.stop());
    if (this.mainJob) this.mainJob.stop();
    if (this.reprocessJob) this.reprocessJob.stop();

    this.logger.fatal(`[LOADER] - Service stoped due to: ${msg}`);

    const jobsStatus = this.loaderjobs.map(j => {
      return {
        ts: DateTime.now(),
        name: j.name,
        cron: j.cron,
        dtRefAdj: j.dtRefAdj,
        maxInstances: j.maxInstances,
        jobNextDate: DateTime.fromJSDate(j.job.nextDate().toDate()).toFormat(
          'dd/MM/yyyy HH:mm:ss',
        ),
        instancesRunning: j.instancesRunning,
        isRunning: j.job.running === true,
      };
    });
    this.logger.fatal(
      `[LOADER] - Jobs status:\n${JSON.stringify(jobsStatus, null, 4)}`,
    );
    this.emit('stoped', msg);
  }

  private async checkSchedules(): Promise<void> {
    const qSchedules = await this.queryfactory.runQuery(
      `SELECT name, cron, "date-ref-adjust" as dtrefadj, active, 
      "max-instances" as maxinstances FROM "loadcontrol-schedule" ORDER BY name`,
      {},
    );

    for await (const sch of qSchedules) {
      const loaderjob = this.loaderjobs.find(
        cronJob => cronJob.name === sch.name,
      );
      if (loaderjob) {
        if (sch.dtRefAdj !== loaderjob.dtRefAdj)
          loaderjob.dtRefAdj = sch.dtrefadj;

        if (sch.maxinstances !== loaderjob.maxInstances)
          loaderjob.maxInstances = sch.maxinstances;

        if (sch.cron !== loaderjob.cron) {
          loaderjob.cron = sch.cron;
          loaderjob.job.setTime(new CronTime(loaderjob.cron));
          if (sch.active) loaderjob.job.start();
        }

        if (sch.active && !loaderjob.job.running) loaderjob.job.start();
        else if (!sch.active && loaderjob.job.running) loaderjob.job.stop();
      }
    }
  }

  private async reprocessSchedules(): Promise<void> {
    for await (const loaderjob of this.loaderjobs) {
      if (loaderjob.job.running) {
        const qReprocess = await this.queryfactory.runQuery(
          `SELECT "date-ref" as dateref, "date-match" as datematch, result 
          FROM "loadcontrol" WHERE process=$1 AND status=$2 AND 
          EXTRACT(epoch FROM $3 - "started-at") > $4::INT 
          ORDER BY "date-ref" ASC`,
          {
            process: loaderjob.name,
            status: TLoadStatus.STARTED,
            now: DateTime.now().toJSDate(),
            reprocessInterval: parseInt(
              process.env.REPROCESS_FINISHED_INTERVAL || '1800',
            ),
          },
        );

        if (qReprocess) {
          for await (const proc of qReprocess) {
            if (loaderjob.instancesRunning >= loaderjob.maxInstances) break;

            const dateRef = DateTime.fromJSDate(proc.dateref);
            let restoreTable;
            const stopedSchedules: string[] = [];
            if (
              loaderjob.reportLoader instanceof BackupRestoreDB &&
              proc.result
            ) {
              try {
                restoreTable = proc.result.restoreTable;
                if (!restoreTable || String(restoreTable).trim() === '')
                  restoreTable = undefined;
                else {
                  this.logger.warn(
                    `[${
                      loaderjob.name
                    }] Restore DB Table: ${restoreTable} Date: ${dateRef.toFormat(
                      'dd/MM/yyyy',
                    )} - All schedules stoped and waiting for process to finish`,
                  );
                  stopedSchedules.push(
                    ...(await this.stopAllSchedulesAndWaitForTasks()),
                  );
                }
              } catch (e) {}
            }
            const task = new Task(loaderjob!.name, loaderjob!.reportLoader, {
              dateRef,
              dateMatch: DateTime.fromJSDate(proc.datematch),
              restoreTable,
            });

            try {
              loaderjob.instancesRunning++;
              await task.process(true);

              if (restoreTable) {
                if (stopedSchedules.length > 0) {
                  await this.queryfactory.runQuery(
                    `UPDATE "loadcontrol-schedule" SET active=TRUE WHERE name = ANY($1)`,
                    {
                      stopedSchedules,
                    },
                  );
                  this.logger.warn(
                    `[${
                      loaderjob.name
                    }] Restore DB Table: ${restoreTable} Date: ${dateRef.toFormat(
                      'dd/MM/yyyy',
                    )} - Schedules restarted: ${stopedSchedules}`,
                  );
                }

                return; // breaks jobs loop to initiate again, after db recovery
              }
            } catch (e) {
              this.logger.error(
                `[${
                  loaderjob!.name
                } - REPROCESS - DateRef: ${DateTime.fromJSDate(
                  proc.dateRef,
                ).toFormat('dd/MM/yyyy')}] Execution aborted due to error: ${
                  e.message
                }`,
              );
            } finally {
              loaderjob.instancesRunning--;
            }
          }
        }
      }
    }
  }

  private async processSchedule(taskName: string): Promise<void> {
    const loaderjob = this.loaderjobs.find(sch => sch.name === taskName);

    if (!loaderjob || !loaderjob.job.running) return;

    const dateMatch = DateTime.fromJSDate(loaderjob!.job.lastDate());
    let dateRef = dateMatch;
    let dtIni = dateMatch;
    for (let i = 0; i < Math.abs(loaderjob!.dtRefAdj); i++) {
      if (loaderjob!.dtRefAdj > 0) {
        const cron = parseExpression(loaderjob!.cron, {
          currentDate: dateRef.toJSDate(),
        });
        while (
          dtIni.startOf('day').toMillis() === dateRef.startOf('day').toMillis()
        ) {
          dateRef = DateTime.fromJSDate(cron.next().toDate());
        }
        dateRef = dateRef.startOf('day');
      } else if (loaderjob!.dtRefAdj < 0) {
        const cron = parseExpression(loaderjob!.cron, {
          currentDate: dateRef.toJSDate(),
        });
        while (
          dtIni.startOf('day').toMillis() === dateRef.startOf('day').toMillis()
        ) {
          dateRef = DateTime.fromJSDate(cron.prev().toDate());
        }
        dateRef = dateRef.startOf('day');
      }
      dtIni = dateRef;
    }

    if (loaderjob.instancesRunning >= loaderjob.maxInstances) {
      this.queryfactory.runQuery(
        `INSERT INTO "loadcontrol" ("date-match", "date-ref", process, status, 
        "started-at") VALUES ($1::DATE, $2::DATE, $3, $4, $5) ON CONFLICT("date-ref", process) DO 
        UPDATE SET "date-match"=$1::DATE, status=$4, "started-at"=$5, result=NULL, 
        "finished-at"=NULL, "reprocessed-at"=NULL`,
        {
          dateMatch: dateMatch.toJSDate(),
          dateRef: dateRef.toJSDate(),
          process: loaderjob!.name,
          status: TLoadStatus.STARTED,
          startedAt: DateTime.now().toJSDate(),
        },
      );
      this.logger.warn(
        `[${loaderjob.name}] - DateRef: ${DateTime.fromJSDate(
          loaderjob!.job.lastDate(),
        ).toFormat('dd/MM/yyyy')} - Maximum instances reached: ${
          loaderjob.instancesRunning
        } - DtAdj: ${loaderjob.dtRefAdj}`,
      );
      return;
    }

    const task = new Task(loaderjob!.name, loaderjob!.reportLoader, {
      dateRef,
      dateMatch,
    });
    try {
      loaderjob.instancesRunning++;
      await task.process();
    } catch (e) {
      this.logger.error(
        `[${loaderjob!.name} - DateRef: ${dateRef.toFormat(
          'dd/MM/yyyy',
        )}] Task processing aborted due to error: ${JSON.stringify(e)}`,
      );
    } finally {
      loaderjob.instancesRunning--;
    }
  }

  private async stopAllSchedulesAndWaitForTasks(): Promise<string[]> {
    const qUpdated = await this.queryfactory.runQuery(
      `UPDATE "loadcontrol-schedule" SET active=FALSE WHERE active=TRUE RETURNING name`,
      {},
    );
    const updatedSchedules: string[] =
      qUpdated && qUpdated.lenght > 0 ? qUpdated.map((q: any) => q.name) : [];

    const checkTasksTimout = 5000;

    return new Promise(resolve => {
      const checkTasks = async () => {
        let allDone = true;
        this.loaderjobs.every(job => {
          if (job.instancesRunning > 0 && !(job instanceof BackupRestoreDB)) {
            allDone = false;
            return false;
          }
          return true;
        });
        if (allDone) {
          resolve(updatedSchedules);
        } else {
          setTimeout(checkTasks, checkTasksTimout);
        }
      };
      setTimeout(checkTasks, checkTasksTimout);
    });
  }
}

export default TaskManager;
