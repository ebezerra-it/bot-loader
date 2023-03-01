import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblB3Assetsbooks1668784555985
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-assetsbooks',
        columns: [
          {
            name: 'datetime',
            type: 'timestamptz',
            isNullable: false,
          },
          {
            name: 'asset',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'book-price',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'auction',
            type: 'boolean',
            isNullable: false,
            default: false,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'b3-assetsbooks',
      new TableIndex({
        name: '8b44b9d7-15fa-4a6b-9b0b-9c97cb0672c4',
        columnNames: ['asset', 'datetime', 'auction'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'b3-assetsbooks',
      '8b44b9d7-15fa-4a6b-9b0b-9c97cb0672c4',
    );
    await queryRunner.dropTable('b3-assetsbooks', true, true, true);
  }
}

/*
// Querying book
select q.datetime, q.asset, booktype."buyVolume", booktype."buyLevel", booktype."sellLevel", booktype."sellVolume"  from 
(select * from "b3-assetsbooks" where asset = 'DOLF23' order by datetime desc limit 1) q,
jsonb_to_recordset(q."book-price") as booktype("buyLevel" decimal, "buyOffers" int, "buyVolume" int, "sellLevel" decimal, "sellOffers" int, "sellVolume" int)
*/
