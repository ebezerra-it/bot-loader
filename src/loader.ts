import { Logger } from 'tslog';
import BaseBot from './bot/baseBot';
import { QueryFactory } from './db/queryFactory';
import TaskManager from './controllers/taskManager';

export default class Loader {
  queryfactory: QueryFactory;

  bot: BaseBot;

  logger: Logger;

  taskManager: TaskManager;

  isRunning: boolean;

  constructor(queryfactory: QueryFactory, bot: BaseBot, logger: Logger) {
    this.queryfactory = queryfactory;
    this.bot = bot;
    this.logger = logger;
    this.isRunning = false;
  }

  public async start(): Promise<void> {
    try {
      this.taskManager = new TaskManager(this.queryfactory, this.logger);

      await this.taskManager.startScheduler();
      this.taskManager.start();
      this.isRunning = true;
    } catch (error) {
      this.logger.fatal(
        `[FATAL] - Unhandled exception: ${JSON.stringify(error)}`,
      );
      this.taskManager.emit('stoped', error.message);
    }
  }

  public stop(msg: string): void {
    this.taskManager.stop(msg);
    this.isRunning = false;
  }
}
