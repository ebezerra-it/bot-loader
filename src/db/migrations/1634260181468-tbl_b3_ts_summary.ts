import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblB3TsSummary1634260181468 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'b3-ts-summary',
        columns: [
          {
            name: 'timestamp-open',
            type: 'timestamptz',
            isNullable: false,
          },
          {
            name: 'asset',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'open',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'close',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'high',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'low',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'quantity',
            type: 'int',
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'volume',
            type: 'bigint',
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'avgp',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'vwap',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'poc',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'vpoc',
            type: 'numeric',
            precision: 10,
            scale: 3,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'sigma',
            type: 'numeric',
            precision: 9,
            scale: 2,
            isNullable: false,
            unsigned: true,
          },
          {
            name: 'volume-profile',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'origin', // 1-B3 LOADER PROCESS; 2-B3 LOADER REPROCESS; 3-PROFIT LOADER
            type: 'smallint',
            isNullable: true,
          },
          {
            name: 'asset-type',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'option-type',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'option-style',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'option-exercise-price',
            type: 'numeric',
            precision: 9,
            scale: 2,
            unsigned: true,
            isNullable: true,
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

    await queryRunner.createIndex(
      'b3-ts-summary',
      new TableIndex({
        name: 'IDX_e0d104db-7839-4f54-b774-0a0e282151a8',
        columnNames: ['asset', 'timestamp-open'],
      }),
    );

    await queryRunner.query(`CREATE INDEX 
    "IDX_893be6b6-1491-49f0-bca9-e011cd8a79ab" 
    ON "b3-ts-summary" USING btree (asset, "timestamp-open" DESC);`);

    await queryRunner.query(
      `drop aggregate if exists stddev_combine (numeric, numeric, numeric) restrict;`,
    );
    await queryRunner.query(
      `drop function if exists stddev_combine_accum(numeric[], numeric, numeric, numeric) restrict;`,
    );
    await queryRunner.query(
      `drop function if exists stddev_combine_final(numeric[]) restrict;`,
    );
    await queryRunner.query(`drop type if exists TStdDev`);
    await queryRunner.query(
      `drop function if exists unnest_multidim(anyarray)`,
    );

    await queryRunner.query(`create type TStdDev as (
      qtty numeric,
      mean numeric,
      sd numeric);
    `);

    await queryRunner.query(`create or replace function 
    stddev_combine_accum(ret numeric[], qtty numeric, mean numeric, sd numeric) 
    returns numeric[]
    language plpgsql
    as $$
    declare res numeric[3];
    begin 
      res[0] := coalesce(ret[0], 0) + qtty;
      res[1] := coalesce(ret[1], 0) + qtty*mean;
      res[2] := coalesce(ret[2], 0) + sd*sd*(qtty)+((qtty*mean)^2)/qtty;
      return res;
    end; $$;
    `);

    await queryRunner.query(`create or replace function 
    stddev_combine_final(ret numeric[]) returns TStdDev 
    language plpgsql
    as $$
    declare
      res TStdDev;
    begin 
      select ret[0] as qtty, ret[1]/ret[0] as mean, sqrt((ret[2] - ret[1]^2 / ret[0]) / (ret[0])) as sd into res;
      return (res.qtty, res.mean, res.sd)::TStdDev;
    end; $$;`);

    await queryRunner.query(`create or replace aggregate 
    stddev_combine (numeric, numeric, numeric) (
      sfunc = stddev_combine_accum,
      stype = numeric[],
      finalfunc = stddev_combine_final
    );`);

    await queryRunner.query(`CREATE OR REPLACE FUNCTION unnest_multidim(anyarray)
    RETURNS SETOF anyarray AS
    $BODY$
      SELECT array_agg($1[series2.i][series2.x]) FROM
        (SELECT generate_series(array_lower($1,2),array_upper($1,2)) as x, series1.i
         FROM 
         (SELECT generate_series(array_lower($1,1),array_upper($1,1)) as i) series1 
        ) series2
    GROUP BY series2.i
    $BODY$
    LANGUAGE sql IMMUTABLE;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'b3-ts-summary',
      'IDX_e0d104db-7839-4f54-b774-0a0e282151a8',
    );
    await queryRunner.dropTable('b3-ts-summary');
    await queryRunner.query(
      `drop aggregate if exists stddev_combine (numeric, numeric, numeric) restrict;`,
    );
    await queryRunner.query(
      `drop function if exists stddev_combine_accum(numeric[], numeric, numeric, numeric) restrict;`,
    );
    await queryRunner.query(
      `drop function if exists stddev_combine_final(numeric[]) restrict;`,
    );
    await queryRunner.query(`drop type if exists TStdDev`);
    await queryRunner.query(
      `drop function if exists unnest_multidim(anyarray)`,
    );
  }
}

/* 
select level, sum(volume) as volume, sum(quantity) as quantity from 
(select (jsonb_array_elements("volume-profile"::JSONB)->>'level')::numeric as level, (jsonb_array_elements("volume-profile"::JSONB)->>'volume')::numeric as volume, (jsonb_array_elements("volume-profile"::JSONB)->>'quantity')::numeric as quantity from "cme-ts-summary" cts where asset = 'ESZ21' and "calendar-date"='2021-10-26') t
group by level
order by level asc; 
*/
/* 
select 1.qtty as volume, 1.mean as vwap, 1.sd as sd from 
(select stddev_combine(volume, vwap, sigma) from "b3-ts-summary" where asset = 'DOLZ21' and volume>0 and "timestamp-open"::DATE = '2021-11-08') q;  
*/
