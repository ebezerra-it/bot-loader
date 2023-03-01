import WebSocket, { WebSocketServer } from 'ws';
import https from 'https';
import http, { IncomingMessage } from 'http';
import querystring from 'querystring';
import { Logger } from 'tslog';
import { EventEmitter } from 'events';
import BaseBot, { TUserType } from '../../baseBot';

interface IDictionary {
  [key: string]: string | string[] | undefined;
}

enum TMessageType {
  ERROR = 'ERROR',
  DATA = 'DATA',
  PING = 'PING',
}

interface IWSMessage {
  timestamp: Date;
  type: TMessageType;
  data: any;
}

interface IWSMessageError {
  errorCode: string;
  errorMessage: string;
}

abstract class WSServerBase extends EventEmitter {
  public name: string;

  public routePath: string;

  public wsServer: WebSocketServer;

  public logger: Logger;

  public bot: BaseBot;

  public timerSendData: NodeJS.Timer | undefined;

  private buffer: { ws: WebSocket; data: string }[];

  private userType: TUserType;

  constructor(
    name: string,
    routePath: string,
    server: http.Server | https.Server,
    bot: BaseBot,
    logger: Logger,
    userType: TUserType,
  ) {
    super();
    this.name = name;
    this.routePath = routePath;
    this.wsServer = new WebSocketServer({ server, path: routePath });
    this.logger = logger;
    this.bot = bot;
    this.buffer = [];
    this.userType = userType;

    this.wsServer.on(
      'connection',
      async (wsClient: WebSocket, request: IncomingMessage) => {
        if (!this.checkSession(request)) {
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorCode: 'SESSION_EXPIRED',
                errorMessage: 'Session expired',
              },
            },
            wsClient,
          );

          wsClient.close();
          return;
        }

        const params =
          request && request.url ? this.parseURLParams(request.url) : undefined;

        let userAuth;
        if (params && params.user) {
          const user = JSON.parse(
            Array.isArray(params.user) ? '{}' : params.user,
          );
          userAuth = await this.bot.checkBotWebAppUser(user, this.userType);
        }

        if (!userAuth) {
          this.logger.warn(
            `[${this.name}] Invalid user: ${JSON.stringify(params)}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorcode: 'INVALID_USER',
                errorMessage: 'Invalid user',
              },
            },
            wsClient,
          );

          wsClient.close();
          return;
        }
        if (!userAuth.cmdAllowed) {
          this.logger.warn(
            `[${this.name}] Unauthorized user: ${JSON.stringify(params)}`,
          );
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorcode: 'INVALID_USER',
                errorMessage: 'Unauthorized user',
              },
            },
            wsClient,
          );

          wsClient.close();
          return;
        }

        if (!this.checkRequiredParameters(params)) {
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorcode: 'MISSING_PARAMETERS',
                errorMessage: 'Missing parameters',
              },
            },
            wsClient,
          );

          wsClient.close();
          return;
        }

        this.logger.silly(
          `[${this.name}] User login: ${JSON.stringify(
            userAuth.user,
          )} from IP: ${request.socket.remoteAddress}`,
        );

        if (params) params.ts = new Date().toISOString();
        // eslint-disable-next-line no-param-reassign
        Object.assign(wsClient, { params });
        this.emit('sendserverdataonce', wsClient);

        if (!this.timerSendData) {
          this.timerSendData = setInterval(async () => {
            await this.getAndSendServerData();
          }, Number(process.env.WEBAPP_SENDDATA_INTERVAL || '2') * 1000);
        }

        wsClient.on('message', async message => {
          try {
            await this.processClientMessage(
              <IWSMessage>JSON.parse(message.toString()),
              wsClient,
            );
          } catch {
            wsClient.close();
          }
        });
      },
    );

    this.on('sendserverdataonce', async (ws: WebSocket) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const { params } = ws;
      await this.sendServerDataOnce(params, ws);
    });
  }

  private parseURLParams(_url: string): IDictionary | undefined {
    const [, strparams] = _url ? _url.split('?') : [undefined, undefined];
    const params = strparams ? querystring.parse(strparams) : undefined;

    if (!params) return undefined;

    return params;
  }

  private checkSession(request: IncomingMessage): boolean {
    if (!request.socket || !request.socket.remoteAddress) return false;

    const ip = request.socket.remoteAddress;
    const session = (request.headers.cookie || '')
      .split(';')
      .map(c => {
        const obj = c.trim().split('=');
        if (obj.length === 2) return { key: obj[0], value: obj[1] };
        return undefined;
      })
      .find(c => !!c && c.key === 'mo_session');

    if (!session || ip === '') return false;

    const hashsession = this.bot.cryptdata(ip);

    return session.value === hashsession && session.value !== '';
  }

  private async getAndSendServerData(): Promise<void> {
    if (this.wsServer.clients.size === 0 && this.timerSendData) {
      clearInterval(this.timerSendData);
      this.timerSendData = undefined;
      return;
    }

    this.wsServer.clients.forEach(async ws => {
      if (ws.readyState === WebSocket.OPEN) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { params } = ws;

        if (!this.checkRequiredParameters(params)) {
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorcode: 'MISSING_PARAMETERS',
                errorMessage: 'Missing parameters',
              },
            },
            ws,
          );

          ws.close();
          return;
        }

        if (
          !params.ts ||
          new Date().getTime() - new Date(params.ts).getTime() >
            Number(process.env.WEBAPP_EXPIRATION_INTERVAL_MINUTES || '600') *
              60 *
              1000
        ) {
          this.sendMessage(
            {
              timestamp: new Date(),
              type: TMessageType.ERROR,
              data: {
                errorCode: 'SESSION_EXPIRED',
                errorMessage: 'Session expired',
              },
            },
            ws,
          );

          ws.close();
          return;
        }

        await this.sendServerData(params, ws);
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  public sendDataMessage(_serverData: any, ws: WebSocket): void {
    const serverData = _serverData;
    Object.keys(serverData).forEach(
      key => serverData[key] === undefined && delete serverData[key],
    );
    if (Object.keys(serverData).length > 0) {
      this.sendMessage(
        {
          timestamp: new Date(),
          type: TMessageType.DATA,
          data: {
            ...serverData,
          },
        },
        ws,
      );
    }
  }

  public sendMessage(message: IWSMessage, ws: WebSocket): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(BaseBot.printJSON(message));
      return true;
    } catch {
      return false;
    }
  }

  public abstract checkRequiredParameters(
    params: IDictionary | undefined,
  ): boolean;

  public abstract sendServerData(
    params: IDictionary | undefined,
    ws: WebSocket,
  ): Promise<void>;

  public abstract sendServerDataOnce(
    params: IDictionary | undefined,
    ws: WebSocket,
  ): Promise<void>;

  public abstract processClientMessage(
    message: IWSMessage,
    ws: WebSocket,
  ): Promise<void>;
}

export default WSServerBase;
export { IDictionary, IWSMessage, TMessageType, IWSMessageError };
