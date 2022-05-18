import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class tblB3OIContracts1626300356444
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-oi-contracts',
        columns: [
          {
            name: 'date',
            type: 'date',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'asset-code',
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
            name: 'oi-volume',
            type: 'int',
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'prior-day-diff',
            type: 'int',
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
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('b3-oi-contracts');
  }
}
