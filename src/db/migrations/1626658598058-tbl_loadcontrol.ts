import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class tblLoadcontrol1626658598058 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'loadcontrol',
        columns: [
          {
            name: 'date-match',
            type: 'timestamptz',
            isNullable: false,
            isPrimary: false,
          },
          {
            name: 'date-ref',
            type: 'timestamptz',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'process',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'status',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'result',
            type: 'JSON',
            isNullable: true,
          },
          {
            name: 'started-at',
            type: 'timestamptz',
            isNullable: false,
          },
          {
            name: 'reprocessed-at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'finished-at',
            type: 'timestamptz',
            isNullable: true,
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('loadcontrol');
  }
}
