import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblExchangeCalendar1627569959875
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // holiday-calendar
    await queryRunner.createTable(
      new Table({
        name: 'holiday-calendar',
        columns: [
          {
            name: 'country-code',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'date',
            type: 'date',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'currency-code',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'event',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'updated-at',
            type: 'timestamptz',
            isNullable: false,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'holiday-calendar',
      new TableIndex({
        name: 'IDX_5d28f030-6358-45aa-abce-d7aef7f450c7',
        columnNames: ['date'],
      }),
    );

    await queryRunner.createIndex(
      'holiday-calendar',
      new TableIndex({
        name: 'IDX_a4743ea8-041d-44c1-a8ca-6e4f2a21698c',
        columnNames: ['currency-code', 'date'],
      }),
    );

    // economic-calendar
    await queryRunner.createTable(
      new Table({
        name: 'economic-calendar',
        columns: [
          {
            name: 'date',
            type: 'date',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'country-code',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'timestamp-event',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'event',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'importance',
            type: 'smallint',
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'previous',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'actual',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'forecast',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: true,
            unsigned: false,
          },
          {
            name: 'unit',
            type: 'text',
            isNullable: true,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'economic-calendar',
      new TableIndex({
        name: 'IDX_0175aac1-360b-447c-b642-50aa08ef8a75',
        columnNames: ['timestamp-event', 'country-code', 'importance'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // holiday-calendar
    await queryRunner.dropTable('holiday-calendar');

    await queryRunner.dropIndex(
      'holiday-calendar',
      'IDX_5d28f030-6358-45aa-abce-d7aef7f450c7',
    );

    await queryRunner.dropIndex(
      'holiday-calendar',
      'IDX_a4743ea8-041d-44c1-a8ca-6e4f2a21698c',
    );

    // economic-calendar
    await queryRunner.dropTable('economic-calendar');

    await queryRunner.dropIndex(
      'economic-calendar',
      'IDX_0175aac1-360b-447c-b642-50aa08ef8a75',
    );
  }
}
