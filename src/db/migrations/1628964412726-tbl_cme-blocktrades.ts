import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblCmeBlocktrades1628964412726
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    await queryRunner.createTable(
      new Table({
        name: 'cme-blocktrades',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            unsigned: true,
            isGenerated: true,
            isPrimary: true,
            isUnique: true,
            isNullable: false,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'blocktrade-id',
            type: 'uuid',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'calendar-date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'tradedate',
            type: 'timestamptz',
            isNullable: false,
          },
          {
            name: 'action',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'exchange',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'type',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'symbol',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'globexcode',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'product-id',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'contract',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'optiontype',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'optionstrikeprice',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'matmonthyear',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'matdate',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'ratio',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'tradeside',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'size',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'price',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'settle',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: true,
            unsigned: false,
          },
        ],
        foreignKeys: [
          {
            columnNames: ['blocktrade-id'],
            referencedTableName: 'cme-blocktrades',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'cme-blocktrades',
      new TableIndex({
        name: 'IDX_e6f71ec8-0d74-410d-82ec-c7907bf4d8dc',
        columnNames: [
          'calendar-date',
          'globexcode',
          'contract',
          'type',
          'action',
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'cme-blocktrades',
      'IDX_e6f71ec8-0d74-410d-82ec-c7907bf4d8dc',
    );
    await queryRunner.dropTable('cme-blocktrades');
  }
}
