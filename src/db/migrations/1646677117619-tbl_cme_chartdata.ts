import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class tblCmeChartdata1646677117619
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'cme-chartdata',
        columns: [
          {
            name: 'globexcode',
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
            name: 'timestamp-open',
            type: 'timestamptz',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'open',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: false,
            unsigned: false,
          },
          {
            name: 'close',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: false,
            unsigned: false,
          },
          {
            name: 'high',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: false,
            unsigned: false,
          },
          {
            name: 'low',
            type: 'numeric',
            precision: 12,
            scale: 5,
            isNullable: false,
            unsigned: false,
          },
          {
            name: 'volume',
            type: 'int',
            isNullable: false,
            unsigned: true,
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('cme-chartdata');
  }
}
