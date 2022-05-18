import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class tblGlobalparameters1626193614700
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'global-parameters',
        columns: [
          {
            name: 'key',
            type: 'text',
            isNullable: false,
            isUnique: true,
            isPrimary: true,
          },
          {
            name: 'value',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'lastupdate-user',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'lastupdate-ts',
            type: 'timestamptz',
            isNullable: false,
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('global-parameters');
  }
}
