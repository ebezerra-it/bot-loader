/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */

import path from 'path';
import BaseBot from '../baseBot';
import { loadJSONFile } from '../../controllers/utils';

interface IBotCommandMessage {
  chatId: number;
  username: string;
  replyToMessageId: number;
}

interface IBotCommand {
  name: string;
  regEx: RegExp;
  procedure: (
    msg: IBotCommandMessage,
    match?: RegExpExecArray | null,
  ) => Promise<void>;
}

abstract class BaseBotCommands {
  bot: BaseBot;

  botCommands: IBotCommand[] = [];

  public COMMAND_MESSAGES: any;

  constructor(bot: BaseBot) {
    this.bot = bot;

    this.COMMAND_MESSAGES = {};

    this.readCommandMessages('baseCommands');
  }

  public readCommandMessages(section: string): void {
    loadJSONFile(
      path.join(
        __dirname,
        '../../../',
        'config/',
        'bot_commands_messages.json',
      ),
    )
      .then(json => {
        if (!json || !json[section])
          throw new Error(
            `[BOT-ServiceAdmCommands] Missing '${section}' property in 'config/bot_commands_messages.json' file`,
          );

        if (Object.keys(json[section]).length === 0)
          throw new Error(
            `[BOT-ServiceAdmCommands] Empty '${section}' property in 'config/bot_commands_messages.json' file`,
          );

        for (const msg in json[section]) {
          if (this.COMMAND_MESSAGES[msg])
            throw new Error(
              `[BOT-ServiceAdmCommands] Duplicated msg '${msg}' in '${section}' property in 'config/bot_commands_messages.json' file`,
            );

          this.COMMAND_MESSAGES[msg] = json[section][msg];
        }
      })
      .catch(e => {
        throw new Error(
          `[BOT-ServiceAdmCommands] Error found in 'config/bot_commands_messages.json' file: ${e.message}`,
        );
      });
  }

  public getCommandMessage(msgCode: string): string {
    return this.COMMAND_MESSAGES[msgCode] ? this.COMMAND_MESSAGES[msgCode] : '';
  }
}

export default BaseBotCommands;
export { IBotCommand, IBotCommandMessage };
