import { Router } from 'express';
import path from 'path';
import ejs from 'ejs';
import BaseRoutes from './baseRoutes';

export default class WebAppRoutes extends BaseRoutes {
  public async getRouter(): Promise<Router> {
    const router: Router = Router();

    router.get('/ip', this.logRemoteCall, (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send({
        ip: req.ip,
        headers_xforwardedfor: req.headers
          ? req.headers['x-forwarded-for'] || ''
          : 'no headers',
        socketremoteaddress: req.socket
          ? req.socket.remoteAddress || ''
          : 'no socket',
      });
    });

    router.get('/webapps/quotes', this.logRemoteCall, async (req, res) => {
      const session = this.bot.cryptdata(req.ip);
      res.cookie('mo_session', session, {
        secure: true,
        maxAge:
          Number(process.env.WEBAPP_EXPIRATION_INTERVAL_MINUTES || '600') *
          60 *
          1000,
      });

      const html = await ejs.renderFile(
        path.join(__dirname, '../bot/webapps/html', 'assetQuotes.html'),
        {
          host: process.env.BOT_HOST,
          botUserName: this.bot.BOT_USERNAME,
        },
      );
      res.setHeader('Content-Type', 'text/html');
      res.status(200).send(html);
    });

    return router;
  }
}
