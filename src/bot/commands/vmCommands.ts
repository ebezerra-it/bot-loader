import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import BaseCommands, { IBotCommandMessage } from './baseBotCommands';
import BaseBot, { TUserType } from '../baseBot';

interface IVMCommandReturn {
  status: string;
  message: string;
  vmstatus?: { state: string; since?: Date };
  screenshotFile?: string;
}

enum TVMCommandType {
  START = 'START',
  STOP = 'STOP',
  RESTART = 'RESTART',
  STATUS = 'STATUS',
  SCREENSHOT = 'SCREENSHOT',
}

class VMCommands extends BaseCommands {
  VM_PATH_TO_PIPE2HOST_FILE: string;

  constructor(bot: BaseBot) {
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
      name: 'vmhelp',
      regEx: new RegExp(/^\/vm\sHELP?$/gi),
      procedure: this.vmhelp.bind(this),
    });

    this.botCommands.push({
      name: 'vmstart',
      regEx: new RegExp(/^\/vm\sSTART?$/gi),
      procedure: this.vmstart.bind(this),
    });

    this.botCommands.push({
      name: 'vmstop',
      regEx: new RegExp(/^\/vm\sSTOP?$/gi),
      procedure: this.vmstop.bind(this),
    });

    this.botCommands.push({
      name: 'vmrestart',
      regEx: new RegExp(/^\/vm\sRESTART?$/gi),
      procedure: this.vmrestart.bind(this),
    });

    this.botCommands.push({
      name: 'vmstatus',
      regEx: new RegExp(/^\/vm\sSTATUS?$/gi),
      procedure: this.vmstatus.bind(this),
    });

    this.botCommands.push({
      name: 'vmscreenshot',
      regEx: new RegExp(/^\/vm\sSCREENSHOT?$/gi),
      procedure: this.vmscreenshot.bind(this),
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
            message: `VM Command timed out: ${VMCommand.replace(
              process.env.DB_PASS || '',
              '*',
            ).replace(process.env.VM_PASS || '', '*')}`,
          });
        }, Number(process.env.TRYDLOADER_COMMAND_TIMEOUT || '30') * 1000);
      })
    );
    return commandReturn;
  }

  public static async sendVMCommand(
    vmCommandType: TVMCommandType,
  ): Promise<IVMCommandReturn> {
    const VM_PATH_TO_PIPE2HOST_FILE = path.join(
      process.env.VM_PIPE2HOST_CONT_DIR || '',
      process.env.VM_PIPE2HOST_FILENAME || '',
    );

    if (!fs.existsSync(VM_PATH_TO_PIPE2HOST_FILE))
      throw new Error(
        `[VMCommands] sendVMCommand() - Missing pipe2host file: ${VM_PATH_TO_PIPE2HOST_FILE}`,
      );

    let vmCommand = '';
    switch (vmCommandType) {
      case TVMCommandType.START:
        vmCommand = `VMSTART VM_NAME=${process.env.VM_NAME} VM_HOST_NAME=${process.env.VM_HOST_NAME} VM_HOST_IP=${process.env.VM_HOST_IP} VM_USER=${process.env.VM_USER} VM_PASS='${process.env.VM_PASS}' VM_SNAPSHOT_START=${process.env.VM_SNAPSHOT_START} VM_FILESYSTEM_XML_PATH=${process.env.VM_FILESYSTEM_XML_PATH} DB_PORT=${process.env.DB_PORT} DB_NAME=${process.env.DB_NAME} DB_USER=${process.env.DB_USER} DB_PASS='${process.env.DB_PASS}' TELEGRAM_API_PORT=${process.env.TELEGRAM_API_PORT}`;
        break;
      case TVMCommandType.STOP:
        vmCommand = `VMSTOP VM_NAME=${process.env.VM_NAME}`;
        break;
      case TVMCommandType.RESTART:
        vmCommand = `VMRESTART VM_NAME=${process.env.VM_NAME} VM_HOST_NAME=${process.env.VM_HOST_NAME} VM_HOST_IP=${process.env.VM_HOST_IP} VM_USER=${process.env.VM_USER} VM_PASS='${process.env.VM_PASS}' VM_SNAPSHOT_START=${process.env.VM_SNAPSHOT_START} VM_FILESYSTEM_XML_PATH=${process.env.VM_FILESYSTEM_XML_PATH} DB_PORT=${process.env.DB_PORT} DB_NAME=${process.env.DB_NAME} DB_USER=${process.env.DB_USER} DB_PASS='${process.env.DB_PASS}' TELEGRAM_API_PORT=${process.env.TELEGRAM_API_PORT}`;
        break;
      case TVMCommandType.STATUS:
        vmCommand = `VMSTATUS VM_NAME=${process.env.VM_NAME}`;
        break;
      case TVMCommandType.SCREENSHOT:
        vmCommand = `VMSCREENSHOT VM_NAME=${process.env.VM_NAME} VM_SCREENSHOTS_HOST_DIR=${process.env.VM_SCREENSHOTS_HOST_DIR}`;
        break;
      default:
        throw new Error(
          `[VMCOMMANDS] sendVMCommand() - Unknown command: ${vmCommandType}`,
        );
    }

    fs.appendFileSync(VM_PATH_TO_PIPE2HOST_FILE, vmCommand);

    return VMCommands.waitForVMCommand(vmCommand);
  }

  private async vmstart(
    msg: IBotCommandMessage,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.OWNER,
      true,
    );
    if (!cmdAllowed || !user) return;

    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE)) {
      await this.bot.sendMessage(
        `[VM CONTROL] VMStart() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
        {
          chatId: msg.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    const commandReturn: IVMCommandReturn = await VMCommands.sendVMCommand(
      TVMCommandType.START,
    );

    await this.bot.sendMessage(`${BaseBot.printJSON(commandReturn)}`, {
      chatId: msg.chatId,
      replyToMessageId: msg.replyToMessageId,
    });
  }

  private async vmstop(
    msg: IBotCommandMessage,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.OWNER,
      true,
    );
    if (!cmdAllowed || !user) return;

    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE)) {
      await this.bot.sendMessage(
        `[VM CONTROL] VMStop() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
        {
          chatId: msg.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    const commandReturn: IVMCommandReturn = await VMCommands.sendVMCommand(
      TVMCommandType.STOP,
    );

    await this.bot.sendMessage(`${BaseBot.printJSON(commandReturn)}`, {
      chatId: msg.chatId,
      replyToMessageId: msg.replyToMessageId,
    });
  }

  private async vmrestart(
    msg: IBotCommandMessage,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.OWNER,
      true,
    );
    if (!cmdAllowed || !user) return;

    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE)) {
      await this.bot.sendMessage(
        `[VM CONTROL] VMRestart() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
        {
          chatId: msg.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    const commandReturn: IVMCommandReturn = await VMCommands.sendVMCommand(
      TVMCommandType.RESTART,
    );

    await this.bot.sendMessage(`${BaseBot.printJSON(commandReturn)}`, {
      chatId: msg.chatId,
      replyToMessageId: msg.replyToMessageId,
    });
  }

  private async vmstatus(
    msg: IBotCommandMessage,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.OWNER,
      true,
    );
    if (!cmdAllowed || !user) return;

    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE)) {
      await this.bot.sendMessage(
        `[VM CONTROL] VMStatus() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
        {
          chatId: msg.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    const commandReturn: IVMCommandReturn = await VMCommands.sendVMCommand(
      TVMCommandType.STATUS,
    );

    await this.bot.sendMessage(`${BaseBot.printJSON(commandReturn)}`, {
      chatId: msg.chatId,
      replyToMessageId: msg.replyToMessageId,
    });
  }

  private async vmscreenshot(
    msg: IBotCommandMessage,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.OWNER,
      true,
    );
    if (!cmdAllowed || !user) return;

    if (!fs.existsSync(this.VM_PATH_TO_PIPE2HOST_FILE)) {
      await this.bot.sendMessage(
        `[VM CONTROL] VMScreenshot() - Missing pipe2host file: ${this.VM_PATH_TO_PIPE2HOST_FILE}`,
        {
          chatId: msg.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    const commandReturn: IVMCommandReturn = await VMCommands.sendVMCommand(
      TVMCommandType.SCREENSHOT,
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
        `[VMCONTROL] Screenshot() - Unable to take VM screenshot`,
        {
          chatId: msg.chatId,
          replyToMessageId: msg.replyToMessageId,
        },
      );
      return;
    }

    const pathConvertedImg = await this.convertPPMtoPNG(
      path.join(
        process.env.VM_SCREENSHOTS_CONT_DIR || '',
        commandReturn.screenshotFile,
      ),
    );
    await this.bot.sendDocument(pathConvertedImg, {
      chatId: msg.chatId,
      replyToMessageId: msg.replyToMessageId,
      extraOptions: {
        caption: path.basename(pathConvertedImg),
      },
    });

    fs.unlinkSync(pathConvertedImg);
  }

  private async vmhelp(
    msg: IBotCommandMessage,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    await this.bot.sendMessage(`It worked!`, {
      chatId: msg.chatId,
      replyToMessageId: msg.replyToMessageId,
    });
  }

  private async convertPPMtoPNG(ppmPath: string): Promise<string> {
    const pathPPMPath = path.parse(ppmPath);
    const convertedImgPath = path.join(
      path.dirname(ppmPath),
      `${pathPPMPath.name}.png`,
    );
    try {
      execSync(`pnmtopng ${ppmPath} > ${convertedImgPath}`);
    } catch (e) {
      this.bot.logger.warn(
        `[PNMTOPNG] PPM file: ${ppmPath} - PNG file: ${convertedImgPath} - Error: ${JSON.stringify(
          e,
        )}`,
      );
      return ppmPath;
    }

    if (fs.existsSync(convertedImgPath)) {
      fs.unlinkSync(ppmPath);
      return convertedImgPath;
    }
    return ppmPath;
  }

  /* private async webappquotes(
    msg: IBotCommandMessage,
    _match?: RegExpExecArray | null,
  ): Promise<void> {
    this.bot.sendMessage('WEBAPP Quotes - Asset: DOLF23', {
      chatId: msg.chatId,
      replyToMessageId: msg.replyToMessageId,
      extraOptions: {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'webapp',
                web_app: {
                  url: 'https://179.180.237.77:8001/webapps/quotes/',
                  // url: 'https://myoraculum.netlify.app/assetquotes',
                  // url: 'https://0.tcp.sa.ngrok.io:17640/webapps/quotes',
                  // url: 'https://192.168.1.102:8001/webapps/quotes',
                },
                // request_contact: true,
                // request_location: true,
              },
            ],
          ],
        },
      },
    });
  } */
}

export default VMCommands;
export { IVMCommandReturn, TVMCommandType };
