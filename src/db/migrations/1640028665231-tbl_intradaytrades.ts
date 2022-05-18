import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblIntradaytrades1640028665231
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'intraday-trades',
        columns: [
          {
            name: 'id',
            type: 'bigint',
            isGenerated: true,
            generationStrategy: 'increment',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'asset',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'ts-trade',
            type: 'timestamptz',
            isNullable: false,
          },
          {
            name: 'price',
            type: 'numeric',
            precision: 8,
            scale: 2,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'quantity',
            type: 'int',
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'roll-price',
            type: 'numeric',
            precision: 8,
            scale: 2,
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'type',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'buyer',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'seller',
            type: 'text',
            isNullable: false,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'intraday-trades',
      new TableIndex({
        name: '3d6f977a-e0c7-4bc1-bbbe-f23e7c2840b4',
        columnNames: ['id'],
      }),
    );

    await queryRunner.createIndex(
      'intraday-trades',
      new TableIndex({
        name: '025ab85d-f949-4381-a3bd-8839f46e25eb',
        columnNames: ['asset', 'ts-trade'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'intraday-trades',
      '3d6f977a-e0c7-4bc1-bbbe-f23e7c2840b4',
    );
    await queryRunner.dropIndex(
      'intraday-trades',
      '025ab85d-f949-4381-a3bd-8839f46e25eb',
    );
    await queryRunner.dropTable('intraday-trades');
  }
}
