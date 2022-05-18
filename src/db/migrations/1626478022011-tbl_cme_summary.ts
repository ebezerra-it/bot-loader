import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblCmeSummary1626478022011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'cme-summary',
        columns: [
          {
            name: 'date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'globexcode',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'month',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'contract',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'product-id',
            type: 'int',
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'open',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'high',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'low',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'last',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'change',
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
          {
            name: 'volume_globex',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'volume_openoutcry',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'volume_total',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'block_vol',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'efp_vol',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'efr_vol',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'eoo_vol',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'efs_vol',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'sub_vol',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'pnt_vol',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'tas_vol',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'deliveries',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'oi_open',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'oi_close',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'oi_change',
            type: 'int',
            isNullable: true,
            unsigned: false,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'cme-summary',
      new TableIndex({
        name: `IDX_630854b7-e73b-49a6-bdf8-09973b569f7e`,
        columnNames: ['date', 'globexcode', 'contract'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'cme-summary',
      'IDX_630854b7-e73b-49a6-bdf8-09973b569f7e',
    );
    await queryRunner.dropTable('cme-summary');
  }
}
