import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblB3Assetsbrokers1668782218916
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-assetsbrokers',
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
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'auction',
            type: 'boolean',
            isNullable: false,
            default: false,
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
      'b3-assetsbrokers',
      new TableIndex({
        name: 'a9644ff9-3d97-4c17-9ca7-95fc39c44dbb',
        columnNames: ['datetime', 'asset', 'broker-id', 'auction'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'b3-assetsbrokers',
      'a9644ff9-3d97-4c17-9ca7-95fc39c44dbb',
    );
    await queryRunner.dropTable('b3-assetsbrokers', true, true, true);
  }
}
