import fs from 'fs';
import path from 'path';
import BaseCommands from './baseBotCommands';
import TelegramBot, { Message } from '../telegramBot';

interface IVMCommandReturn {
  status: string;
  message: string;
  vmstatus?: { state: string; since: Date };
  screenshotFile?: string;
}

class vmCommands extends BaseCommands {
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

  private async waitForVMCommand(VMCommand: string): Promise<IVMCommandReturn> {
    const commandReturn: IVMCommandReturn = <IVMCommandReturn>(
      await new Promise(resolve => {
        const pathFileCmdReturn = path.join(
          path.dirname(process.env.VM_PIPE2HOST_CONT_DIR || ''),
          process.env.VM_PIPE2HOST_COMMAND_RETURN_FILENAME || '',
        );

        const checkCmd = setInterval(() => {
          if (fs.existsSync(pathFileCmdReturn)) {
            clearInterval(checkCmd);
            const strRetCmd = String(
              fs.readFileSync(path.join(pathFileCmdReturn)),
            );
            try {
              const retCmd = JSON.parse(strRetCmd);
              if (String(retCmd.status).trim().toLowerCase() === 'success')
                resolve({
                  status: 'success',
                  message: String(retCmd.message).trim(),
                  vmstatus: retCmd.state
                    ? {
                        state: String(retCmd.status).trim().toLowerCase(),
                        since: new Date(String(retCmd.since).trim()),
                      }
                    : undefined,
                  screenshotFile: retCmd.filename,
                });
              else
                resolve({
                  status: 'error',
                  message: String(retCmd.message).trim(),
                });
            } catch (err) {
              resolve({
                status: 'error',
                message: `Unable to parse VM Command return: ${strRetCmd}`,
              });
            } finally {
              fs.unlinkSync(pathFileCmdReturn);
            }
          }
        }, 1000);

        setTimeout(() => {
          if (checkCmd) clearInterval(checkCmd);
          resolve({
            status: 'error',
            message: `VM Command timed out: ${VMCommand}`,
          });
        }, Number(process.env.VM_COMMAND_TIMEOUT || '30') * 1000);
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

    const vmCommand = `VMSTART VM_NAME=${process.env.VM_NAME} VM_SNAPSHOT_START=${process.env.VM_SNAPSHOT_START} VM_NAME=${process.env.VM_NAME} HOST_IP=${process.env.HOST_IP} DB_PORT=${process.env.DB_PORT} DB_NAME=${process.env.DB_NAME} DB_USER=${process.env.DB_USER} DB_PASS=${process.env.DB_PASS} TELEGRAM_API_PORT=${process.env.TELEGRAM_API_PORT}`;
    const ws = fs.createWriteStream(this.VM_PATH_TO_PIPE2HOST_FILE);
    ws.write(vmCommand);
    ws.close();

    const commandReturn: IVMCommandReturn = await this.waitForVMCommand(
      vmCommand,
    );
    await this.bot.sendMessage(
      msg.chat.id,
      `${JSON.stringify(commandReturn)}`,
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

    const CMD = `VMSTOP VM_NAME=${process.env.VM_NAME}`;
    const ws = fs.createWriteStream(this.VM_PATH_TO_PIPE2HOST_FILE);
    ws.write(CMD);
    ws.close();

    const commandReturn: IVMCommandReturn = await this.waitForVMCommand(CMD);
    await this.bot.sendMessage(
      msg.chat.id,
      `${JSON.stringify(commandReturn)}`,
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

    const CMD = `VMRESTART VM_NAME=${process.env.VM_NAME} VM_SNAPSHOT_START=${process.env.VM_SNAPSHOT_START} VM_NAME=${process.env.VM_NAME} HOST_IP=${process.env.HOST_IP} DB_PORT=${process.env.DB_PORT} DB_NAME=${process.env.DB_NAME} DB_USER=${process.env.DB_USER} DB_PASS=${process.env.DB_PASS} TELEGRAM_API_PORT=${process.env.TELEGRAM_API_PORT}`;
    const ws = fs.createWriteStream(this.VM_PATH_TO_PIPE2HOST_FILE);
    ws.write(CMD);
    ws.close();

    const commandReturn: IVMCommandReturn = await this.waitForVMCommand(CMD);
    await this.bot.sendMessage(
      msg.chat.id,
      `${JSON.stringify(commandReturn)}`,
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

    const CMD = `VMSTATUS VM_NAME=${process.env.VM_NAME}`;
    const ws = fs.createWriteStream(this.VM_PATH_TO_PIPE2HOST_FILE);
    ws.write(CMD);
    ws.close();

    const commandReturn: IVMCommandReturn = await this.waitForVMCommand(CMD);
    await this.bot.sendMessage(
      msg.chat.id,
      `${JSON.stringify(commandReturn)}`,
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

    const CMD = `VMSCREENSHOT VM_NAME=${process.env.VM_NAME} VM_SCREENSHOTS_HOST_DIR=${process.env.VM_SCREENSHOTS_HOST_DIR}`;
    const ws = fs.createWriteStream(this.VM_PATH_TO_PIPE2HOST_FILE);
    ws.write(CMD);
    ws.close();

    const commandReturn: IVMCommandReturn = await this.waitForVMCommand(CMD);

    if (
      commandReturn.screenshotFile &&
      fs.existsSync(
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
        commandReturn.screenshotFile!,
      ),
      {
        caption: commandReturn.screenshotFile!,
        reply_to_message_id: msg.message_id,
      },
    );
  }
}

export default vmCommands;
