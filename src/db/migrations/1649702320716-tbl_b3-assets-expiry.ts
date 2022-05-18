import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class tblB3AssetsExpiry1649702320716
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-assets-expiry',
        columns: [
          {
            name: 'asset',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'type',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'contract',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'underlying-asset',
            type: 'text',
            isNullable: true,
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
            name: 'date-trading-start',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'date-trading-end',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'date-expiry',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'currency-code',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'quote-quantity',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'quote-multiplier',
            type: 'numeric',
            precision: 10,
            scale: 5,
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'option-type',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'option-style',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'option-exercise-price',
            type: 'numeric',
            precision: 12,
            scale: 5,
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'rollover-base-price',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'loaded-at',
            type: 'timestamptz',
            isNullable: false,
          },
        ],
      }),
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "135992b9-b2a8-474e-ba00-adce4766a5c0" 
      ON "b3-assets-expiry" (asset, type, COALESCE(contract, ''));`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "b3-assets-expiry"."135992b9-b2a8-474e-ba00-adce4766a5c0";`,
    );

    await queryRunner.dropTable('b3-assets-expiry');
  }
}
