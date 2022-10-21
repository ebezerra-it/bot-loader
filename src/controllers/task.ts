/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';
import ReportLoader from './reportLoader';
import ReportLoaderCalendar from './reportLoaderCalendar';

enum TLoadStatus {
  STARTED = 'STARTED',
  DONE = 'DONE',
}

class Task extends EventEmitter {
  reportLoader: ReportLoader | ReportLoaderCalendar;

  name: string;

  params: any;

  constructor(
    name: string,
    reportLoader: ReportLoader | ReportLoaderCalendar,
    params: any,
  ) {
    super();
    this.name = name;
    this.reportLoader = reportLoader;
    this.params = params;

    // Non-Promisse jobs
    this.on('task-finished', results => {
      this.reportLoader.logger.info(
        `[${this.name}] - DateRef: ${this.params.dateRef.toFormat(
          'dd/MM/yyyy',
        )} - Task finished: ${JSON.stringify(
          results,
        )} - Params: ${JSON.stringify(this.params)}`,
      );
    });
  }

  async process(reprocess = false): Promise<any> {
    // Update load control - PROCESSING
    await this.reportLoader.queryFactory.runQuery(
      `INSERT INTO "loadcontrol" ("date-match", "date-ref", process, status, 
      "started-at") VALUES ($1::DATE, $2::DATE, $3, $4, $5) ON CONFLICT("date-ref", process) DO 
      UPDATE SET "date-match"=$1::DATE, status=$4, "started-at"=$5, 
      "finished-at"=NULL, "reprocessed-at"=NULL`,
      {
        dateMatch: this.params.dateMatch.toJSDate(),
        dateRef: this.params.dateRef.toJSDate(),
        process: this.name,
        status: TLoadStatus.STARTED,
        startedAt: DateTime.now()
          .setZone(this.params.dateMatch.zoneName)
          .toJSDate(),
      },
    );

    const exec = this.reportLoader.process(this.params);

    if (exec instanceof Promise) {
      return exec
        .then(async (results: { inserted: number; deleted: number }) => {
          let sql = '';
          // in case of empty end of task not in a holiday, make it reprocessable
          if (results.inserted === 0) {
            if (
              (<ReportLoaderCalendar>this.reportLoader).exchange !== undefined
            ) {
              if (
                !(await (<ReportLoaderCalendar>this.reportLoader).isHoliday(
                  this.params.dateRef,
                ))
              ) {
                this.reportLoader.logger.warn(
                  `[${this.name}] - DateRef: ${this.params.dateRef.toFormat(
                    'dd/MM/yyyy',
                  )} - Task finished empty. Waiting for REPROCESS schedule.`,
                );
                return { ...results };
              }
              this.reportLoader.logger.info(
                `[${this.name}] - DateRef: ${this.params.dateRef.toFormat(
                  'dd/MM/yyyy',
                )} - Task finished empty. Identified holiday - ${JSON.stringify(
                  results,
                )}`,
              );
            } else if (this.name === 'BackupRestoreDB') {
              if (
                !(await this.reportLoader.allExchangesHoliday(
                  this.params.dateRef,
                ))
              ) {
                this.reportLoader.logger.warn(
                  `[${this.name}] - DateRef: ${this.params.dateRef.toFormat(
                    'dd/MM/yyyy',
                  )} - Non Calendar Task finished empty. Waiting for REPROCESS schedule.`,
                );
                return { ...results };
              }
            }
          }

          if (reprocess) {
            sql = `UPDATE "loadcontrol" SET status=$3, result=$4, 
              "reprocessed-at"=$5 WHERE "date-ref"::DATE=$1::DATE AND process=$2`;
          } else {
            sql = `UPDATE "loadcontrol" SET status=$3, result=$4, 
              "finished-at"=$5 WHERE "date-ref"::DATE=$1::DATE AND process=$2`;
          }

          await this.reportLoader.queryFactory.runQuery(sql, {
            dateRef: this.params.dateRef.toJSDate(),
            process: this.name,
            status: TLoadStatus.DONE,
            results,
            endedAt: DateTime.now()
              .setZone(this.params.dateMatch.zoneName)
              .toJSDate(),
          });

          this.reportLoader.logger.info(
            `[${this.name}] - DateRef: ${this.params.dateRef.toFormat(
              'dd/MM/yyyy',
            )} - Task finished: ${JSON.stringify(
              results,
            )} - Params: ${JSON.stringify(this.params)}`,
          );

          return { ...results };
        })
        .catch(error => {
          this.reportLoader.logger.error(
            `[${this.name}] - DateRef: ${this.params.dateRef.toFormat(
              'dd/MM/yyyy',
            )} - Params: ${JSON.stringify(
              this.params,
            )} - Error: ${JSON.stringify(error)}`,
          );
          throw error;
        });
    }

    // Non-Promise jobs
    this.emit('task-finished');
    return exec;
  }
}

export default Task;
export { TLoadStatus };
