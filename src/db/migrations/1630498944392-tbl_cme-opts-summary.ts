import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblCmeOptsSummary1630498944392
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'cme-opts-summary',
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
            name: 'product-id',
            type: 'int',
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'contract',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'option-type',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'strike',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: false,
            unsigned: false,
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
            name: 'volume',
            type: 'int',
            isNullable: true,
            unsigned: true,
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
            name: 'opnt',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'aon',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'exercises',
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
      'cme-opts-summary',
      new TableIndex({
        name: `IDX_e8028f6e-dca8-469f-95e4-309d069d69d2`,
        columnNames: [
          'date',
          'globexcode',
          'contract',
          'option-type',
          'strike',
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'cme-opts-summary',
      'IDX_e8028f6e-dca8-469f-95e4-309d069d69d2',
    );
    await queryRunner.dropTable('cme-opts-summary');
  }
}
