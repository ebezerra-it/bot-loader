import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { ILoadResult } from '../reportLoader';
import ReportLoaderCalendar from '../reportLoaderCalendar';
import VMCommands, { IVMCommandReturn } from '../../bot/commands/vmCommands';

export default class TrydLoaderStarter extends ReportLoaderCalendar {
  async process(params: { dateRef: DateTime }): Promise<ILoadResult> {
    this.logger.info(
      `[${
        this.processName
      }] - Process started - DateRef: ${params.dateRef.toFormat('dd/MM/yyyy')}`,
    );

    const VM_PATH_TO_PIPE2HOST_FILE = path.join(
      process.env.VM_PIPE2HOST_CONT_DIR || '',
      process.env.VM_PIPE2HOST_FILENAME || '',
    );

    const vmCommand = `VMSTART VM_NAME=${process.env.VM_NAME} VM_HOST_NAME=${process.env.VM_HOST_NAME} VM_HOST_IP=${process.env.VM_HOST_IP} VM_USER=${process.env.VM_USER} VM_PASS='${process.env.VM_PASS}' VM_SNAPSHOT_START=${process.env.VM_SNAPSHOT_START} VM_FILESYSTEM_XML_PATH=${process.env.VM_FILESYSTEM_XML_PATH} DB_PORT=${process.env.DB_PORT} DB_NAME=${process.env.DB_NAME} DB_USER=${process.env.DB_USER} DB_PASS='${process.env.DB_PASS}' TELEGRAM_API_PORT=${process.env.TELEGRAM_API_PORT}`;
    fs.appendFileSync(VM_PATH_TO_PIPE2HOST_FILE, vmCommand);

    const commandReturn: IVMCommandReturn = await VMCommands.waitForVMCommand(
      vmCommand,
    );

    if (commandReturn.status !== 'success')
      throw new Error(
        `Unable to start TrydLoaderStarter process due to error: ${commandReturn.message}`,
      );

    return { inserted: 1, deleted: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  async performQuery(_params: any): Promise<any> {
    return undefined;
  }
}
