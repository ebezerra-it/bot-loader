import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export default class tblUsersTokens1631751083044 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users-tokens',
        columns: [
          {
            name: 'user-id',
            type: 'int',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'token',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'email-trials',
            type: 'smallint',
            isNullable: false,
            default: 0,
          },
          {
            name: 'expires',
            type: 'timestamptz',
            isNullable: true,
          },
        ],
        foreignKeys: [
          {
            columnNames: ['user-id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('users-tokens');
  }
}
