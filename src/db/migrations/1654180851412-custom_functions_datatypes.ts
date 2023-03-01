import { MigrationInterface, QueryRunner } from 'typeorm';

export default class customFunctionsDatatypes1654180851412
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Statistics - begin
    // source: http://www.obg.cuhk.edu.hk/ResearchSupport/StatTools/CombineMeansSDs_Pgm.php
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

    /* 
    USAGE:
        select level, sum(volume) as volume, sum(quantity) as quantity from 
        (select (jsonb_array_elements("volume-profile"::JSONB)->>'level')::numeric as level, (jsonb_array_elements("volume-profile"::JSONB)->>'volume')::numeric as volume, (jsonb_array_elements("volume-profile"::JSONB)->>'quantity')::numeric as quantity from "cme-ts-summary" cts where asset = 'ESZ21' and "calendar-date"='2021-10-26') t
        group by level
        order by level asc; 

        select (comb).qtty as volume, (comb).mean as vwap, (comb).sd as sd from 
        (select stddev_combine(volume, vwap, sigma) comb from "b3-ts-summary" where asset = 'DOLZ21' and volume>0 and "timestamp-open"::DATE = '2021-11-08') q;  
    */
    // Statistics - end
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Statistics - begin
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
    // Statistics - end
  }
}
