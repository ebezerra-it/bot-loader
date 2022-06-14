import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { TDataOrigin } from './1634260181468-tbl_b3_ts_summary';

export default class tblB3Rollingtrades1633835436615
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-rollingtrades',
        columns: [
          {
            name: 'trade-timestamp',
            type: 'timestamptz',
            precision: 3,
            isNullable: false,
          },
          {
            name: 'asset-code',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'contract-from',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'contract-to',
            type: 'text',
            isNullable: false,
          },

          {
            name: 'level',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'size',
            type: 'int',
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'trade-id',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'origin', // TDataOrigin: 1-B3 LOADER PROCESS; 2-B3 LOADER REPROCESS; 3-PROFIT LOADER
            type: 'smallint',
            isNullable: true,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'b3-rollingtrades',
      new TableIndex({
        name: 'IDX_ee28aef1-f03b-4eed-823d-d8b96b80f26d',
        columnNames: ['asset-code', 'contract-to', 'trade-timestamp'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'b3-rollingtrades',
      'IDX_ee28aef1-f03b-4eed-823d-d8b96b80f26d',
    );
    await queryRunner.dropTable('b3-rollingtrades');
  }
}

export { TDataOrigin };
