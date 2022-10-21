import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblB3Brokersbalance1659394131573
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-brokersbalance',
        columns: [
          {
            name: 'datetime',
            type: 'timestamptz',
            isNullable: false,
          },
          {
            name: 'asset',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'broker-id',
            type: 'smallint',
            isNullable: false,
          },
          {
            name: 'volume',
            type: 'int',
            isNullable: false,
            unsigned: false,
          },
          {
            name: 'vwap',
            type: 'numeric',
            precision: 12,
            scale: 2,
            isNullable: false,
            unsigned: true,
          },
        ],
        foreignKeys: [
          {
            columnNames: ['broker-id'],
            referencedTableName: 'b3-brokers',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'b3-brokersbalance',
      new TableIndex({
        name: '7c825efe-1f4c-4df8-b9d7-9b6103aec421',
        columnNames: ['datetime', 'asset', 'broker-id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'b3-brokersbalance',
      '7c825efe-1f4c-4df8-b9d7-9b6103aec421',
    );
    await queryRunner.dropTable('b3-brokersbalance', true, true, true);
  }
}
