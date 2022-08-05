import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblB3Brokers1659364044873 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-brokers',
        columns: [
          {
            name: 'id',
            type: 'smallint',
            isNullable: false,
            isUnique: true,
            isPrimary: true,
          },
          {
            name: 'name',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'type',
            type: 'text',
            isNullable: false,
            default: 'O', // F - Foreign; N - National; O - Other
          },
          {
            name: 'exchange-bmf',
            type: 'boolean',
            default: false,
          },
          {
            name: 'exchange-bov',
            type: 'boolean',
            default: false,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'b3-brokers',
      new TableIndex({
        name: '4369e327-c40e-4dc1-a8f0-def2ce59b14c',
        columnNames: ['type', 'exchange-bov'],
      }),
    );

    await queryRunner.createIndex(
      'b3-brokers',
      new TableIndex({
        name: '121b724f-34de-425b-b5a5-b88c5ee45521',
        columnNames: ['type', 'exchange-bmf'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'b3-brokers',
      '4369e327-c40e-4dc1-a8f0-def2ce59b14c',
    );
    await queryRunner.dropIndex(
      'b3-brokers',
      '121b724f-34de-425b-b5a5-b88c5ee45521',
    );

    await queryRunner.dropTable('b3-brokers', true, true, true);
  }
}
