import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblB3Timesnsales1633636284006
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-timesnsales',
        columns: [
          {
            name: 'trade-timestamp',
            precision: 3,
            type: 'timestamptz',
            isNullable: false,
          },
          {
            name: 'asset',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'level',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'size',
            type: 'int',
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'trade-id',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'updt',
            type: 'smallint',
            isNullable: false,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'b3-timesnsales',
      new TableIndex({
        name: 'IDX_0fe5122f-a33a-4383-ae8e-a9d564b72be6',
        columnNames: ['asset', 'trade-timestamp'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'b3-timesnsales',
      'IDX_0fe5122f-a33a-4383-ae8e-a9d564b72be6',
    );
    await queryRunner.dropTable('b3-timesnsales');
  }
}
