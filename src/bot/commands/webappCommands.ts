import path from 'path';
import BaseCommands, { IBotCommandMessage } from './baseBotCommands';
import BaseBot, { TUserType } from '../baseBot';

export default class WebappCommands extends BaseCommands {
  constructor(bot: BaseBot) {
    super(bot);

    this.botCommands.push({
      name: 'webapps',
      regEx: new RegExp(/^\/webapps$/gi),
      procedure: this.webapps.bind(this),
    });

    this.botCommands.push({
      name: 'sendCertificate',
      regEx: new RegExp(/^\/webapps\sCERTIFICATE$/gi),
      procedure: this.sendCertificate.bind(this),
    });
  }

  private async webapps(msg: IBotCommandMessage): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    await this.bot.sendWebApps(msg);
  }

  private async sendCertificate(msg: IBotCommandMessage): Promise<void> {
    const { cmdAllowed, user } = await this.bot.checkBotUserAuth(
      { username: msg.username },
      TUserType.DEFAULT,
      true,
    );
    if (!cmdAllowed || !user) return;

    const pathCertificate = path.join(
      __dirname,
      '../../../cert/web',
      process.env.BOT_CERT_FILE || '',
    );

    await this.bot.sendDocument(pathCertificate, msg);
  }
}
