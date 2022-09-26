import fs from 'fs';
import path from 'path';
import BaseCommands from './baseBotCommands';
import TelegramBot, { Message } from '../telegramBot';

interface IVMCommandReturn {
  status: string;
  message: string;
  vmstatus?: { state: string; since?: Date };
  screenshotFile?: string;
}

class VMCommands extends BaseCommands {
  VM_PATH_TO_PIPE2HOST_FILE: string;

  constructor(bot: TelegramBot) {
    super(bot);

    this.VM_PATH_TO_PIPE2HOST_FILE = path.join(
      process.env.VM_PIPE2HOST_CONT_DIR || '',
      process.env.VM_PIPE2HOST_FILENAME || '',
    );

    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE))
      throw new Error(
        `[VMCommands] Constructor() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
      );

    this.botCommands.push({
      name: 'vmstart',
      regEx: new RegExp(/^\/vm\sSTART?$/gi),
      procedure: this.vmstart,
    });

    this.botCommands.push({
      name: 'vmstop',
      regEx: new RegExp(/^\/vm\sSTOP?$/gi),
      procedure: this.vmstop,
    });

    this.botCommands.push({
      name: 'vmrestart',
      regEx: new RegExp(/^\/vm\sRESTART?$/gi),
      procedure: this.vmrestart,
    });

    this.botCommands.push({
      name: 'vmstatus',
      regEx: new RegExp(/^\/vm\sSTATUS?$/gi),
      procedure: this.vmstatus,
    });

    this.botCommands.push({
      name: 'vmscreenshot',
      regEx: new RegExp(/^\/vm\sSCREENSHOT?$/gi),
      procedure: this.vmscreenshot,
    });
  }

  public static async waitForVMCommand(
    VMCommand: string,
  ): Promise<IVMCommandReturn> {
    const commandReturn: IVMCommandReturn = <IVMCommandReturn>(
      await new Promise(resolve => {
        const pathFileCmdReturn = path.join(
          process.env.VM_PIPE2HOST_CONT_DIR || '',
          process.env.VM_PIPE2HOST_COMMAND_RETURN_FILENAME || '',
        );

        let checkCmd: NodeJS.Timer;
        const checkCmdFunction = () => {
          if (fs.existsSync(pathFileCmdReturn)) {
            if (checkCmd) clearInterval(checkCmd);
            const strRetCmd = String(fs.readFileSync(pathFileCmdReturn)).trim();
            if (strRetCmd === '') {
              checkCmd = setInterval(checkCmdFunction, 1000);
              return;
            }
            // this.bot.logger.warn(`strRetCmd=${strRetCmd}`);
            try {
              const retCmd = JSON.parse(strRetCmd);
              if (String(retCmd.status).trim().toLowerCase() === 'success') {
                const cmdResponse = {
                  status: 'success',
                  message: String(retCmd.message).trim(),
                  vmstatus: retCmd.vmstatus
                    ? {
                        state: String(retCmd.vmstatus.state)
                          .trim()
                          .toLowerCase(),
                        since: retCmd.vmstatus.upseconds
                          ? new Date(
                              Math.round(
                                new Date().getTime() -
                                  Number(retCmd.vmstatus.upseconds) * 1000,
                              ),
                            )
                          : undefined,
                      }
                    : undefined,
                  screenshotFile: retCmd.filename,
                };
                if (!cmdResponse.vmstatus) delete cmdResponse.vmstatus;
                else if (!cmdResponse.vmstatus.since)
                  delete cmdResponse.vmstatus.since;
                if (!cmdResponse.screenshotFile)
                  delete cmdResponse.screenshotFile;
                resolve(cmdResponse);
              } else {
                resolve({
                  status: 'error',
                  message: String(retCmd.message).trim(),
                });
              }
            } catch (err) {
              resolve({
                status: 'error',
                message: `Unable to parse VM Command return: "${strRetCmd}" due to error: ${JSON.stringify(
                  err,
                )}`,
              });
            } finally {
              if (fs.existsSync(pathFileCmdReturn))
                fs.unlinkSync(pathFileCmdReturn);
            }
          }
        };
        checkCmd = setInterval(checkCmdFunction, 1000);

        setTimeout(() => {
          if (checkCmd) clearInterval(checkCmd);
          if (fs.existsSync(pathFileCmdReturn))
            fs.unlinkSync(pathFileCmdReturn);
          resolve({
            status: 'error',
            message: `VM Command timed out: ${VMCommand}`,
          });
        }, Number(process.env.TRYDLOADER_COMMAND_TIMEOUT || '30') * 1000);
      })
    );
    return commandReturn;
  }

  private async vmstart(
    msg: Message,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE)) {
      await this.bot.sendMessage(
        msg.chat.id,
        `[VM CONTROL] VMStart() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const vmCommand = `VMSTART VM_NAME=${process.env.VM_NAME} VM_HOST_NAME=${process.env.VM_HOST_NAME} VM_HOST_IP=${process.env.VM_HOST_IP} VM_USER=${process.env.VM_USER} VM_PASS='${process.env.VM_PASS}' VM_SNAPSHOT_START=${process.env.VM_SNAPSHOT_START} VM_FILESYSTEM_XML_PATH=${process.env.VM_FILESYSTEM_XML_PATH} DB_PORT=${process.env.DB_PORT} DB_NAME=${process.env.DB_NAME} DB_USER=${process.env.DB_USER} DB_PASS='${process.env.DB_PASS}' TELEGRAM_API_PORT=${process.env.TELEGRAM_API_PORT}`;
    // this.bot.logger.warn(`VM_COMMAND=${vmCommand}`);

    fs.appendFileSync(this.VM_PATH_TO_PIPE2HOST_FILE, vmCommand);

    const commandReturn: IVMCommandReturn = await VMCommands.waitForVMCommand(
      vmCommand,
    );

    await this.bot.sendMessage(
      msg.chat.id,
      `${TelegramBot.printJSON(commandReturn)}`,
      {
        reply_to_message_id: msg.message_id,
      },
    );
  }

  private async vmstop(
    msg: Message,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE)) {
      await this.bot.sendMessage(
        msg.chat.id,
        `[VM CONTROL] VMStop() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const vmCommand = `VMSTOP VM_NAME=${process.env.VM_NAME}`;
    // this.bot.logger.warn(`VM_COMMAND=${vmCommand}`);

    fs.appendFileSync(this.VM_PATH_TO_PIPE2HOST_FILE, vmCommand);

    const commandReturn: IVMCommandReturn = await VMCommands.waitForVMCommand(
      vmCommand,
    );

    await this.bot.sendMessage(
      msg.chat.id,
      `${TelegramBot.printJSON(commandReturn)}`,
      {
        reply_to_message_id: msg.message_id,
      },
    );
  }

  private async vmrestart(
    msg: Message,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE)) {
      await this.bot.sendMessage(
        msg.chat.id,
        `[VM CONTROL] VMRestart() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const vmCommand = `VMRESTART VM_NAME=${process.env.VM_NAME} VM_HOST_NAME=${process.env.VM_HOST_NAME} VM_HOST_IP=${process.env.VM_HOST_IP} VM_USER=${process.env.VM_USER} VM_PASS=${process.env.VM_PASS} VM_SNAPSHOT_START=${process.env.VM_SNAPSHOT_START} VM_FILESYSTEM_XML_PATH=${process.env.VM_FILESYSTEM_XML_PATH} DB_PORT=${process.env.DB_PORT} DB_NAME=${process.env.DB_NAME} DB_USER=${process.env.DB_USER} DB_PASS=${process.env.DB_PASS} TELEGRAM_API_PORT=${process.env.TELEGRAM_API_PORT}`;

    fs.appendFileSync(this.VM_PATH_TO_PIPE2HOST_FILE, vmCommand);

    const commandReturn: IVMCommandReturn = await VMCommands.waitForVMCommand(
      vmCommand,
    );
    /* this.bot.logger.warn(
      `VM_COMMAND_RETURN=${JSON.stringify(commandReturn, null, 4)}`,
    ); */

    await this.bot.sendMessage(
      msg.chat.id,
      `${TelegramBot.printJSON(commandReturn)}`,
      {
        reply_to_message_id: msg.message_id,
      },
    );
  }

  private async vmstatus(
    msg: Message,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE)) {
      await this.bot.sendMessage(
        msg.chat.id,
        `[VM CONTROL] VMStatus() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const vmCommand = `VMSTATUS VM_NAME=${process.env.VM_NAME}`;
    // this.bot.logger.warn(`VM_COMMAND=${vmCommand}`);

    fs.appendFileSync(this.VM_PATH_TO_PIPE2HOST_FILE, vmCommand);

    const commandReturn: IVMCommandReturn = await VMCommands.waitForVMCommand(
      vmCommand,
    );

    await this.bot.sendMessage(
      msg.chat.id,
      `${TelegramBot.printJSON(commandReturn)}`,
      {
        reply_to_message_id: msg.message_id,
      },
    );
  }

  private async vmscreenshot(
    msg: Message,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE)) {
      await this.bot.sendMessage(
        msg.chat.id,
        `[VM CONTROL] VMScreenshot() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    const vmCommand = `VMSCREENSHOT VM_NAME=${process.env.VM_NAME} VM_SCREENSHOTS_HOST_DIR=${process.env.VM_SCREENSHOTS_HOST_DIR}`;
    // this.bot.logger.warn(`VM_COMMAND=${vmCommand}`);

    fs.appendFileSync(this.VM_PATH_TO_PIPE2HOST_FILE, vmCommand);

    const commandReturn: IVMCommandReturn = await VMCommands.waitForVMCommand(
      vmCommand,
    );

    if (
      !commandReturn.screenshotFile ||
      !fs.existsSync(
        path.join(
          process.env.VM_SCREENSHOTS_CONT_DIR || '',
          commandReturn.screenshotFile,
        ),
      )
    ) {
      await this.bot.sendMessage(
        msg.chat.id,
        `[VMCONTROL] Screenshot() - Unable to take VM screenshot`,
        {
          reply_to_message_id: msg.message_id,
        },
      );
      return;
    }

    await this.bot.sendDocument(
      msg.chat.id,
      path.join(
        process.env.VM_SCREENSHOTS_CONT_DIR || '',
        commandReturn.screenshotFile,
      ),
      {
        caption: commandReturn.screenshotFile!,
        reply_to_message_id: msg.message_id,
      },
    );

    fs.unlinkSync(
      path.join(
        process.env.VM_SCREENSHOTS_CONT_DIR || '',
        commandReturn.screenshotFile,
      ),
    );
  }
}

export default VMCommands;
export { IVMCommandReturn };
