import TelegramBot, {
  Message,
  IUser,
  TUserType,
  TUserReturnAuthType,
} from '../telegramBot';

interface IBotCommand {
  name: string;
  regEx: RegExp;
  procedure: (
    //    bot: TelegramBot,
    msg: Message,
    match?: RegExpExecArray | null,
  ) => Promise<void>;
}

const MSG_COMMAND_ERROR = `Command $1 can't be executed due to error: $2\n\nContact your administrator.`;
const MSG_ACCESS_DENIED = `Access denied.`;

abstract class BaseBotCommands {
  bot: TelegramBot;

  botCommands: IBotCommand[] = [];

  constructor(bot: TelegramBot) {
    this.bot = bot;
  }

  public loadCommands(): void {
    this.botCommands.forEach(cmd => {
      this.bot.onText(
        cmd.regEx,
        async (msg: Message, match?: RegExpExecArray | null) => {
          try {
            await cmd.procedure.bind(this)(msg, match);
          } catch (err) {
            this.bot.sendMessage(
              msg.chat.id,
              MSG_COMMAND_ERROR.replace(/\$1/g, `\\${cmd.name}`).replace(
                /\$2/g,
                `${err.message}`,
              ),
              {
                reply_to_message_id: msg.message_id,
              },
            );
            this.bot.logger.error(
              MSG_COMMAND_ERROR.replace(/\$1/g, `\\${cmd.name}`).replace(
                /\$2/g,
                `${JSON.stringify(err)}`,
              ),
            );
          }
        },
      );
    });
  }

  async checkAuth(
    msg: Message,
    userType: TUserType,
    allowExpired = false,
  ): Promise<{
    cmdAllowed: boolean;
    user: IUser | undefined;
    authType: TUserReturnAuthType;
  }> {
    const { authType, user } = await this.bot.getUser({
      username: msg.from?.username,
    });
    if (
      !user ||
      authType === TUserReturnAuthType.NOTREGITERED ||
      user.type < userType
    )
      return { cmdAllowed: false, user, authType };
    if (
      authType !== TUserReturnAuthType.AUTH &&
      !(authType === TUserReturnAuthType.EXPIREDTOKEN && allowExpired)
    ) {
      await this.bot.sendMessage(msg.chat.id, MSG_ACCESS_DENIED, {
        reply_to_message_id: msg.message_id,
      });
      return { cmdAllowed: false, user, authType };
    }
    return { cmdAllowed: true, user, authType };
  }
}

export default BaseBotCommands;
export { IBotCommand };
