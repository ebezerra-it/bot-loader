import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

enum TDataOrigin {
  B3_LOADER_PROCESS = 1,
  B3_LOADER_REPROCESS = 2,
  PROFIT_LOADER = 3,
}

export default class tblB3TsSummary1634260181468 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-ts-summary',
        columns: [
          {
            name: 'timestamp-open',
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
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'close',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'high',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'low',
            type: 'numeric',
            precision: 10,
            scale: 3,
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
            name: 'volume',
            type: 'bigint',
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'avgp',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'vwap',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'poc',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'vpoc',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'sigma',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'volume-profile',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'origin', // TDataOrigin: 1-B3 LOADER PROCESS; 2-B3 LOADER REPROCESS; 3-PROFIT LOADER
            type: 'smallint',
            isNullable: true,
          },
          {
            name: 'asset-type',
            type: 'text',
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

    await queryRunner.createIndex(
      'b3-ts-summary',
      new TableIndex({
        name: 'IDX_e0d104db-7839-4f54-b774-0a0e282151a8',
        columnNames: ['asset', 'timestamp-open'],
      }),
    );

    await queryRunner.query(`CREATE INDEX 
    "IDX_893be6b6-1491-49f0-bca9-e011cd8a79ab" 
    ON "b3-ts-summary" USING btree (asset, "timestamp-open" DESC);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'b3-ts-summary',
      'IDX_e0d104db-7839-4f54-b774-0a0e282151a8',
    );
    await queryRunner.dropTable('b3-ts-summary');
  }
}

export { TDataOrigin };
