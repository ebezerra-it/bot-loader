import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export default class tblB3Oiplayers1626299009565 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    queryRunner.createTable(
      new Table({
        name: 'b3-oi-players',
        columns: [
          {
            name: 'date',
            type: 'Date',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'asset-code',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'asset-type',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'caption',
            type: 'text',
            isNullable: false,
            isPrimary: true,
          },
          {
            name: 'central_bank_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'central_bank_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'fin_corp_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'fin_corp_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'fin_corp_banks_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'fin_corp_banks_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'fin_corp_dtvm_ctvm_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'fin_corp_dtvm_ctvm_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'fin_corp_others_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'fin_corp_others_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'inst_inv_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'inst_inv_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'inst_inv_national_investor_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'inst_inv_national_investor_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'for_inv_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'for_inv_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'for_inv_res2687_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'for_inv_res2687_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'for_inv_res2689_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'for_inv_res2689_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'non_fin_corp_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'non_fin_corp_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'ind_inv_buy',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'ind_inv_sell',
            type: 'int',
            isNullable: true,
            unsigned: true,
          },
          {
            name: 'raw_data',
            type: 'text',
            isNullable: true,
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'b3-oi-players',
      new TableIndex({
        name: `IDX_4f2ab7e3-1ee8-4dbd-b610-3998b8864807`,
        columnNames: ['date', 'asset-code', 'asset-type'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'b3-oi-players',
      'IDX_4f2ab7e3-1ee8-4dbd-b610-3998b8864807',
    );
    await queryRunner.dropTable('b3-oi-players');

    await queryRunner.query('DROP TYPE "TAssetType"');
  }
}
