import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class tblB3Summary1626193614800 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    queryRunner.createTable(
      new Table({
        name: 'b3-summary',
        columns: [
          {
            name: 'date',
            type: 'Date',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'asset',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'asset-code',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'asset-type',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'caption',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'contract',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'oi-open',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'oi-close',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'trades-quantity',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'volume-size',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'financial-volume',
            type: 'numeric',
            precision: 14,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'previous-settle',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'previous-adjust-settle',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'open',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'low',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'high',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'close',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'vwap',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'settle',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'oscilation',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'variation-points',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'reference-premium',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'last-buy',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'last-sell',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: true,
            unsigned: false,
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
            precision: 9,
            scale: 2,
            unsigned: true,
            isNullable: true,
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
        ],
      }),
    );

    await queryRunner.query(
      `CREATE INDEX "98deddfd-83a5-4e94-bdf5-0d3f68e132a3" 
      ON "b3-summary" (date, "asset-code", "asset-type", COALESCE(contract, ''));`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "b3-summary"."98deddfd-83a5-4e94-bdf5-0d3f68e132a3";`,
    );

    await queryRunner.dropTable('b3-summary');
  }
}
