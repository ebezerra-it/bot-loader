import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblB3Assetsquotes1668783218916
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-assetsquotes',
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
            name: 'open',
            type: 'numeric',
            precision: 12,
            scale: 3,
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'high',
            type: 'numeric',
            precision: 12,
            scale: 3,
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'low',
            type: 'numeric',
            precision: 12,
            scale: 3,
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'last',
            type: 'numeric',
            precision: 12,
            scale: 3,
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'vwap',
            type: 'numeric',
            precision: 12,
            scale: 3,
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'quantity',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'volume',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'aggression-quantity-buy',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'aggression-quantity-sell',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'aggression-volume-buy',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'aggression-volume-sell',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'theorical-level',
            type: 'numeric',
            precision: 12,
            scale: 3,
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'theorical-volume-buy',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'theorical-volume-sell',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'state',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'auction',
            type: 'boolean',
            isNullable: false,
            default: false,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'b3-assetsquotes',
      new TableIndex({
        name: '3a316311-a5a8-4c47-bf98-929ea16fd08c',
        columnNames: ['asset', 'datetime', 'auction'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'b3-assetsquotes',
      '3a316311-a5a8-4c47-bf98-929ea16fd08c',
    );
    await queryRunner.dropTable('b3-assetsquotes', true, true, true);
  }
}
