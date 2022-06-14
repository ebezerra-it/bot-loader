import { MigrationInterface, QueryRunner, Table } from 'typeorm';

enum TChartDataOrigin {
  CME = 1,
  TRADINGVIEW = 2,
  YAHOO = 3,
}

export default class tblChartdata1653872110319 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'chartdata',
        columns: [
          {
            name: 'asset-code', // Futures globexcode+contract; Spot symbol
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'contract', // Futures contract code 'N22' or 'SPOT'
            type: 'text',
            isNullable: false,
            isPrimary: true,
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
          {
            name: 'origin', // 1-CME; 2-TRADINGVIEW; 3-YAHOO
            type: 'smallint',
            isNullable: false,
            unsigned: true,
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('chartdata');
  }
}

export { TChartDataOrigin };
