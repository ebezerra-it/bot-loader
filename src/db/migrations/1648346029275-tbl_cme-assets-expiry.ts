import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblCmeAssetsExpiry1648346029275
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'cme-assets-expiry',
        columns: [
          {
            name: 'globexcode',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'type', // O - Options F - Futures
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'contract',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'product-id',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'product-name',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'product-group',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'product-subgroup',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'exchange',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'date-avail',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'date-expiry',
            type: 'timestamptz',
            isNullable: false,
          },
          {
            name: 'date-settle',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'underlying-globexcode',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'underlying-contract',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'opt-type-code',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'opt-type-daily',
            type: 'boolean',
            isNullable: true,
          },
          {
            name: 'opt-type-weekly',
            type: 'boolean',
            isNullable: true,
          },
          {
            name: 'opt-type-sto', // short-term-option
            type: 'boolean',
            isNullable: true,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'cme-assets-expiry',
      new TableIndex({
        name: 'b46c2a12-53bb-437c-9539-4f33e4fae5df',
        isUnique: true,
        columnNames: ['product-id', 'contract'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'cme-assets-expiry',
      'b46c2a12-53bb-437c-9539-4f33e4fae5df',
    );
    await queryRunner.dropTable('cme-assets-expiry');
  }
}
