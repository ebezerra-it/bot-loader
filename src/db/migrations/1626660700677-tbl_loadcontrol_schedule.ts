import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class tblLoadcontrolSchedule1626660700677
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'loadcontrol-schedule',
        columns: [
          {
            name: 'name',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'cron',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'date-ref-adjust',
            type: 'int',
            isNullable: false,
            default: 0,
          },
          {
            name: 'max-instances',
            type: 'int',
            isNullable: false,
            default: 2,
          },
          {
            name: 'active',
            type: 'boolean',
            isNullable: false,
            default: false,
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('loadcontrol-schedule');
  }
}
