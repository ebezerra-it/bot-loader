import { DateTime } from 'luxon';
import { ILoadResult } from '../reportLoader';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import VMCommands, {
  IVMCommandReturn,
  TVMCommandType,
} from '../../bot/commands/vmCommands';

export default class TrydLoaderStarter extends ReportLoaderCalendar {
  async process(params: { dateRef: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );

    let commandReturn: IVMCommandReturn;

    commandReturn = await this.retry({
      vmCommandType: TVMCommandType.STATUS,
    });

    if (commandReturn.vmstatus && commandReturn.vmstatus.state === 'running') {
      commandReturn = await this.retry({
        vmCommandType: TVMCommandType.STOP,
      });
    }

    commandReturn = await this.retry({
      vmCommandType: TVMCommandType.START,
    });

    if (!commandReturn || commandReturn.status !== 'success') {
      await this.queryFactory.runQuery(
        `UPDATE "loadcontrol" SET status=$3, result=$4, "finished-at"=$5 
      WHERE "date-ref"::DATE=$1::DATE AND process=$2`,
        {
          dateRef: params.dateRef.toJSDate(),
          process: this.processName,
          status: 'DONE',
          result: { inserted: -1, deleted: 0 },
          finished: new Date(),
        },
      );
      throw new Error(
        `Maximum ${Number(
          process.env.TRYDLOADER_STARTER_MAX_RETRIES || '5',
        )} retries reached.\nUnable to start TrydLoaderStarter process due to error: ${JSON.stringify(
          commandReturn,
        )}`,
      );
    }

    return { inserted: 1, deleted: 0 };
  }

  async performQuery(params: {
    vmCommandType: TVMCommandType;
  }): Promise<IVMCommandReturn> {
    let commandReturn: IVMCommandReturn;

    switch (params.vmCommandType) {
      case TVMCommandType.START:
        commandReturn = await VMCommands.sendVMCommand(TVMCommandType.START);
        break;
      case TVMCommandType.STOP:
        commandReturn = await VMCommands.sendVMCommand(TVMCommandType.STOP);
        break;
      case TVMCommandType.STATUS:
        commandReturn = await VMCommands.sendVMCommand(TVMCommandType.STATUS);
        break;
      default:
        throw new Error(
          `[${this.processName}] Unknown VM command: ${params.vmCommandType}`,
        );
    }

    if (commandReturn.status !== 'success')
      throw new Error(
        `[${this.processName}] Failed to run VM command: ${params.vmCommandType} due to error: ${commandReturn.message}`,
      );

    return commandReturn;
  }
}
