import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class tblB3Dailyquotes1638841136382
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-dailyquotes',
        columns: [
          {
            name: 'asset',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'date',
            type: 'date',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'datetime',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'last',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'vwap',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'trades',
            type: 'bigint',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'volume',
            type: 'bigint',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'stddev',
            type: 'numeric',
            precision: 7,
            scale: 2,
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'acum-agg-bal',
            type: 'bigint',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'open-interest',
            type: 'bigint',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'hist-vol',
            type: 'numeric',
            precision: 7,
            scale: 2,
            isNullable: true,
            unsigned: true,
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('b3-dailyquotes');
  }
}
