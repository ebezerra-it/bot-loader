/* eslint-disable no-nested-ternary */
/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
/* eslint-disable no-use-before-define */
/* eslint-disable no-useless-escape */
/* eslint-disable no-param-reassign */
/* eslint-disable no-restricted-globals */
/* eslint-disable no-restricted-syntax */
import { Pool, PoolClient } from 'pg';
import { from as pgCopyFrom, to as pgCopyTo } from 'pg-copy-streams';
import fs, { existsSync } from 'fs';
import { DateTime } from 'luxon';
import { iterateStreamLines } from '@mangosteen/line-by-line';
import { isNumber } from '../utils';
import { IExchange, TExchange, getExchange } from '../tcountry';
import { TDataOrigin } from '../../db/migrations/1634260181468-tbl_b3_ts_summary';

enum TFileSizeUnit {
  BYTES = 0,
  KB = 1,
  MB = 2,
  GB = 3,
  TB = 4,
}

enum TFieldType {
  TEXT = 'TEXT',
  INT = 'INT',
  DECIMAL = 'DECIMAL',
  BOOLEAN = 'BOOLEAN',
  TIMESTAMP = 'TIMESTAMP',
  TIMESTAMPTZ = 'TIMESTAMPTZ',
  DATE = 'DATE',
}

async function convertToFieldType(
  anyValue: any,
  field: IField,
  layout: IFileLayout,
  rowIndex: number,
  _poolClient: PoolClient,
): Promise<any> {
  if (!(typeof anyValue === 'string') && field.type !== TFieldType.TEXT)
    return anyValue;

  let value: any = anyValue;

  switch (field.type) {
    case TFieldType.TIMESTAMPTZ:
    case TFieldType.TIMESTAMP:
    case TFieldType.DATE:
      if (!field.dateFormat)
        throw new Error(
          `Invalid date format in row ${rowIndex} for field ${JSON.stringify(
            field,
          )}`,
        );
      if (
        field.type === TFieldType.TIMESTAMPTZ ||
        field.type === TFieldType.TIMESTAMP
      ) {
        if (!layout.exchange)
          throw new Error(
            `Missing exchange in layout: ${JSON.stringify(layout)}`,
          );
        value = DateTime.fromFormat(value, field.dateFormat, {
          zone: layout.exchange.timezone,
        });
      } else {
        value = DateTime.fromFormat(value, field.dateFormat);
      }
      if (!value.isValid)
        throw new Error(
          `Invalid date in row ${rowIndex} for field ${JSON.stringify(field)}`,
        );
      break;

    case TFieldType.BOOLEAN:
      if (
        !['true', 'false'].find(b => b === String(value).trim().toLowerCase())
      )
        throw new Error(
          `Invalid boolean value in row ${rowIndex} for field ${JSON.stringify(
            field,
          )}`,
        );

      value = String(value).trim().toLowerCase() === 'true';
      break;

    case TFieldType.INT:
    case TFieldType.DECIMAL:
      if (field.thousandSeparator)
        value = value.replace(
          new RegExp(`\\${field.thousandSeparator}`, 'g'),
          '',
        );
      if (field.decimalSeparator)
        value = value.replace(field.decimalSeparator, '.');

      if (!isNumber(value))
        throw new Error(
          `Invalid numeric value in row ${rowIndex} at field: ${JSON.stringify(
            field,
          )}`,
        );

      if (field.type === TFieldType.INT) value = Math.round(Number(value));
      else value = Number(value);
      break;

    case TFieldType.TEXT:
      value = String(value).trim();
      break;

    default:
      throw new Error(`Invalid field type: ${JSON.stringify(field)}`);
  }

  return value;
}

interface IFieldTransformParameteres {
  poolClient: PoolClient;
  filename?: string;
  financialVolumeDivisor?: number | undefined;
  // eslint-disable-next-line no-use-before-define
  layout: IFileLayout;
  row: any[];
  rowIndex: number;
}

interface IField {
  name: string;
  index: number | undefined;
  type: TFieldType;
  fixedValue: any | undefined;
  dateFormat: string | undefined;
  decimalSeparator: string | undefined;
  thousandSeparator: string | undefined;
  allowNull: boolean;
  transformFunction:
    | ((params: IFieldTransformParameteres) => Promise<any>)
    | undefined;
  dbColumn: string;
}

interface IFileLayout {
  ignoreBlankRows: boolean;
  hasHeader: boolean;
  exchange: IExchange | undefined;
  separator: string;
  tableName: string;
  fields: IField[];
}

const increment = async (
  params: IFieldTransformParameteres,
): Promise<string> => {
  return String(params.rowIndex).padStart(7, '0');
};

const calculateRollLevel = async (
  params: IFieldTransformParameteres,
): Promise<number> => {
  const fieldDtTrade = params.layout.fields.find(
    f => f.dbColumn === 'trade-timestamp',
  )!;
  const dtTrade: Date = await convertToFieldType(
    params.row[fieldDtTrade!.index!],
    fieldDtTrade,
    params.layout,
    params.rowIndex,
    params.poolClient,
  );

  const fieldRollLevel = params.layout.fields.find(
    f => f.dbColumn === 'level',
  )!;
  const roll: number = await convertToFieldType(
    params.row[fieldRollLevel!.index!],
    fieldRollLevel,
    params.layout,
    params.rowIndex,
    params.poolClient,
  );

  const assetCode: string = params.layout.fields.find(
    f => f.dbColumn === 'asset-code',
  )?.fixedValue!;

  const contractFrom: string = params.layout.fields.find(
    f => f.dbColumn === 'contract-from',
  )?.fixedValue!;

  const qLevel = await params.poolClient.query(
    `SELECT vwap FROM "b3-ts-summary" WHERE asset=$1 AND "timestamp-open"<=$2 
    ORDER BY "timestamp-open" DESC LIMIT 1`,
    [`${assetCode}${contractFrom}`, dtTrade],
  );

  if (!qLevel || qLevel.rowCount === 0)
    throw new Error(
      `CalculateRollLevel - No data was found for asset [${assetCode}${contractFrom}] at timestamp: ${dtTrade} - Row Index: ${params.rowIndex}`,
    );

  return Number(qLevel.rows[0].vwap) + roll;
};

const LAYOUT_PROFIT_ROLLING_TT: IFileLayout = {
  ignoreBlankRows: true,
  hasHeader: true,
  exchange: getExchange(TExchange.B3),
  separator: '\t',
  tableName: 'b3-rollingtrades',
  fields: [
    {
      name: 'Data',
      index: 0,
      type: TFieldType.TIMESTAMPTZ,
      dateFormat: 'dd/MM/yyyy HH:mm:ss.SSS',
      allowNull: false,
      dbColumn: 'trade-timestamp',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'Asset',
      index: undefined,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'asset-code',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: '',
      transformFunction: undefined,
    },
    {
      name: 'contract-from',
      index: undefined,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'contract-from',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: '',
      transformFunction: undefined,
    },
    {
      name: 'contract-to',
      index: undefined,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'contract-to',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: '',
      transformFunction: undefined,
    },
    {
      name: 'Valor',
      index: 2,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'level',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: calculateRollLevel,
    },
    {
      name: 'Quantidade',
      index: 3,
      type: TFieldType.INT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'size',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'Tradeid',
      index: undefined,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'trade-id',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: 'Tradeid',
      transformFunction: increment,
    },
    {
      name: 'origin',
      index: undefined,
      type: TFieldType.INT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'origin',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: TDataOrigin.PROFIT_LOADER,
      transformFunction: undefined,
    },
  ],
};

const calculateVWAP1mFile = async (
  params: IFieldTransformParameteres,
): Promise<number> => {
  const field = params.layout.fields.find(f => f.dbColumn === 'vwap')!;
  const volFin = params.row[6]
    .replace(new RegExp(`\\${field.thousandSeparator}`, 'g'), '')
    .replace(field.decimalSeparator, '.');

  if (!isNumber(volFin))
    throw new Error(
      `Invalid value ${params.row[6]} for column 'Volume Financeiro' in row ${params.rowIndex}`,
    );

  const volQtty = params.row[8]
    .replace(new RegExp(`\\${field.thousandSeparator}`, 'g'), '')
    .replace(field.decimalSeparator, '.');

  if (!isNumber(volQtty))
    throw new Error(
      `Invalid value ${params.row[6]} for column 'Volume Quantidade' in row ${params.rowIndex}`,
    );

  return (
    Number(volFin) / (Number(volQtty) * (params.financialVolumeDivisor || 1))
  );
};

const calculateSigma1mFile = async (
  params: IFieldTransformParameteres,
): Promise<number> => {
  const field = params.layout.fields.find(f => f.dbColumn === 'high')!;

  const high = params.row[
    params.layout.fields.find(f => f.dbColumn === 'high')!.index!
  ]
    .replace(new RegExp(`\\${field.thousandSeparator}`, 'g'), '')
    .replace(field.decimalSeparator, '.');

  if (!isNumber(high))
    throw new Error(
      `Invalid value ${high} for column 'Máxima' in row ${params.rowIndex}`,
    );

  const low = params.row[
    params.layout.fields.find(f => f.dbColumn === 'low')!.index!
  ]
    .replace(new RegExp(`\\${field.thousandSeparator}`, 'g'), '')
    .replace(field.decimalSeparator, '.');

  if (!isNumber(low))
    throw new Error(
      `Invalid value ${low} for column 'Mínima' in row ${params.rowIndex}`,
    );

  return (
    (Number(high) - Number(low)) *
    Number(process.env.BOT_QUERY_OI_HIGH_LOW_TO_SDEV_MULTIPLIER || '0.225')
  );
};

const calculateVolumeProfile1mFile = async (
  params: IFieldTransformParameteres,
): Promise<string> => {
  const field = params.layout.fields.find(f => f.dbColumn === 'vwap')!;
  const vwap = await calculateVWAP1mFile(params);
  const volQtty = params.row[8]
    .replace(new RegExp(`\\${field.thousandSeparator}`, 'g'), '')
    .replace(field.decimalSeparator, '.');

  if (!isNumber(volQtty))
    throw new Error(
      `Invalid value ${params.row[6]} for column 'Volume Quantidade' in row ${params.rowIndex}`,
    );

  const quantity = Number(
    params.layout.fields.find(f => f.dbColumn === 'quantity')!.fixedValue,
  );
  return `[{\"level\": ${vwap}, \"volume\": ${volQtty}, \"quantity\": ${quantity}}]`;
};

const LAYOUT_PROFIT_1M: IFileLayout = {
  ignoreBlankRows: true,
  hasHeader: true,
  exchange: getExchange(TExchange.B3),
  separator: '\t',
  tableName: 'b3-ts-summary',
  fields: [
    {
      name: 'Data',
      index: 0,
      type: TFieldType.TIMESTAMPTZ,
      dateFormat: 'dd/MM/yyyy HH:mm',
      allowNull: false,
      dbColumn: 'timestamp-open',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'Asset',
      index: undefined,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'asset',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: '',
      transformFunction: undefined,
    },
    {
      name: 'Abertura',
      index: 1,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'open',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'Fechamento',
      index: 4,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'close',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'Máxima',
      index: 2,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'high',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'Mínima',
      index: 3,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'low',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'quantity',
      index: undefined,
      type: TFieldType.INT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'quantity',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: 1,
      transformFunction: undefined,
    },
    {
      name: 'Volume Quantidade',
      index: 8,
      type: TFieldType.INT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'volume',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'avgp',
      index: undefined,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'avgp',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: calculateVWAP1mFile,
    },
    {
      name: 'vwap',
      index: undefined,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'vwap',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: calculateVWAP1mFile,
    },
    {
      name: 'poc',
      index: undefined,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'poc',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: calculateVWAP1mFile,
    },
    {
      name: 'vpoc',
      index: undefined,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'vpoc',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: calculateVWAP1mFile,
    },
    {
      name: 'sigma',
      index: undefined,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'sigma',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: calculateSigma1mFile,
    },
    {
      name: 'volume-profile',
      index: undefined,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'volume-profile',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: undefined,
      transformFunction: calculateVolumeProfile1mFile,
    },
    {
      name: 'origin',
      index: undefined,
      type: TFieldType.INT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'origin',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: TDataOrigin.PROFIT_LOADER,
      transformFunction: undefined,
    },
  ],
};

const LAYOUT_PROFIT_FRP: IFileLayout = {
  ignoreBlankRows: true,
  hasHeader: true,
  exchange: getExchange(TExchange.B3),
  separator: '\t',
  tableName: 'b3-ts-summary',
  fields: [
    {
      name: 'timestamp-open',
      index: 0,
      type: TFieldType.TIMESTAMPTZ,
      dateFormat: 'dd/MM/yyyy',
      allowNull: false,
      dbColumn: 'timestamp-open',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'asset',
      index: 1,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'asset',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'open',
      index: 2,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'open',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'close',
      index: 3,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'close',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'high',
      index: 4,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'high',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'low',
      index: 5,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'low',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'quantity',
      index: 6,
      type: TFieldType.INT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'quantity',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'volume',
      index: 7,
      type: TFieldType.INT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'volume',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'avgp',
      index: 10,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'avgp',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'vwap',
      index: 11,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'vwap',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'poc',
      index: 12,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'poc',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'vpoc',
      index: 13,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'vpoc',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'sigma',
      index: 14,
      type: TFieldType.DECIMAL,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'sigma',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'volume-profile',
      index: 15,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'volume-profile',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'origin',
      index: undefined,
      type: TFieldType.INT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'origin',
      decimalSeparator: ',',
      thousandSeparator: '.',
      fixedValue: TDataOrigin.PROFIT_LOADER,
      transformFunction: undefined,
    },
  ],
};

const LAYOUT_HOLIDAYS_CAL: IFileLayout = {
  ignoreBlankRows: true,
  hasHeader: true,
  exchange: undefined,
  separator: '\t',
  tableName: 'holiday-calendar',
  fields: [
    {
      name: 'country-code',
      index: 0,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'country-code',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'date',
      index: 1,
      type: TFieldType.DATE,
      dateFormat: 'yyyy-MM-dd',
      allowNull: false,
      dbColumn: 'date',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'currency-code',
      index: 2,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'currency-code',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'event',
      index: 3,
      type: TFieldType.TEXT,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'event',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: undefined,
      transformFunction: undefined,
    },
    {
      name: 'updated-at',
      index: undefined,
      type: TFieldType.TIMESTAMP,
      dateFormat: undefined,
      allowNull: false,
      dbColumn: 'updated-at',
      decimalSeparator: undefined,
      thousandSeparator: undefined,
      fixedValue: new Date(),
      transformFunction: undefined,
    },
  ],
};

class DataFileLoader {
  pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  public async exportToFile(
    pathFile: string,
    layout: IFileLayout,
  ): Promise<number> {
    const poolClient = await this.pool.connect();

    const filterFields = layout.fields
      .filter(field => field.fixedValue)
      .map(field => {
        switch (field.type) {
          case TFieldType.DATE:
          case TFieldType.TIMESTAMP:
          case TFieldType.TIMESTAMPTZ:
            return `"${field.dbColumn}"='${
              DateTime.isDateTime(field.fixedValue)
                ? field.fixedValue.toISO()
                : field.fixedValue instanceof Date
                ? DateTime.fromJSDate(field.fixedValue).toISO()
                : DateTime.fromISO(field.fixedValue).toISO()
            }'`;
          case TFieldType.TEXT:
            return `"${field.dbColumn}"='${field.fixedValue}'`;
          case TFieldType.BOOLEAN:
          case TFieldType.DECIMAL:
          case TFieldType.INT:
            return `"${field.dbColumn}"=${field.fixedValue}`;
          default:
            return '';
        }
      });

    let sqlWhere;
    sqlWhere = filterFields.join(' AND ');
    if (sqlWhere) sqlWhere = ` WHERE ${sqlWhere}`;

    const qRowCount = await poolClient.query(
      `SELECT COUNT(*) qtty FROM "${layout.tableName}"${sqlWhere}`,
    );

    if (!qRowCount.rows || qRowCount.rowCount === 0)
      throw new Error(
        `Empty table ${layout.tableName} - Filter fields: ${filterFields.join(
          ', ',
        )}`,
      );

    const inserted = Number(qRowCount.rows[0].qtty);
    const sqlCopyStream = `COPY (SELECT * FROM "${layout.tableName}"${sqlWhere}) TO STDOUT WITH CSV DELIMITER '${layout.separator}' HEADER`;
    const fileStream = fs.createWriteStream(pathFile);

    await new Promise<void>((resolve, reject) => {
      fileStream.on('ready', () => {
        const dbStream = poolClient.query(pgCopyTo(sqlCopyStream));
        dbStream.pipe(fileStream);

        dbStream.on('end', () => {
          fileStream.close();
          resolve();
        });

        dbStream.on('error', error => {
          reject(error);
        });
      });
    });

    return inserted;
  }

  public async loadFile(
    pathFile: string,
    layout: IFileLayout,
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    transformParams: any,
  ): Promise<number> {
    if (!existsSync(pathFile)) throw new Error(`File not found: ${pathFile}`);
    if (layout.tableName.trim() === '' || layout.fields.length === 0)
      throw new Error(`Wrong layout: ${JSON.stringify(layout)}`);

    const poolClient = await this.pool.connect();
    poolClient.emit('drain');
    const poolUtc = await this.pool.connect();
    poolUtc.emit('drain');

    const sqlCopyStream = `COPY "${layout.tableName}" (${layout.fields
      .map(f => `"${f.dbColumn}"`)
      .join(',')}) FROM STDIN WITH CSV DELIMITER ';'`;
    const pgStream = poolClient.query(pgCopyFrom(sqlCopyStream));

    let rowIndex = 0;
    try {
      const fileStream = fs.createReadStream(pathFile);
      const rows: AsyncIterable<string> = iterateStreamLines(
        fileStream,
        'utf8',
      );

      for await (const row of rows) {
        if (rowIndex === 0)
          if (layout.hasHeader && !this.validadeHeader(row, layout))
            throw new Error(
              `Invalid header for layout - Header: ${row} - Layout: ${JSON.stringify(
                layout,
              )}`,
            );
          else {
            rowIndex++;
            // eslint-disable-next-line no-continue
            continue;
          }

        if (row.trim() === '')
          if (!layout.ignoreBlankRows)
            throw new Error(
              `Invalid blank line ${rowIndex} for file layout: ${JSON.stringify(
                layout,
              )}`,
            );
          // eslint-disable-next-line no-continue
          else continue;

        const fRow = await this.parseRow(row, rowIndex, layout, poolUtc, {
          ...transformParams,
        });
        pgStream.write(`${fRow}\n`);
        rowIndex++;
      }
    } catch (err) {
      pgStream.end();
      throw new Error(
        `File loading ${pathFile} exception thrown in line ${rowIndex} - Error: ${JSON.stringify(
          err,
        )}`,
      );
    } finally {
      pgStream.end();
      await poolClient.query(`COMMIT`);

      poolUtc.release();
      poolClient.release();
    }
    return layout.hasHeader ? rowIndex - 1 : rowIndex;
  }

  private validadeHeader(header: string, layout: IFileLayout): boolean {
    if (!layout.hasHeader) return true;
    const aHeader = header.split(layout.separator);

    const aIdx: number[] = layout.fields
      .filter(f => f)
      .map(f => Number(f.index));
    if (!aIdx)
      throw new Error(
        `Layout doen't have any data index source: ${JSON.stringify(layout)}`,
      );

    // eslint-disable-next-line prefer-spread
    if (Math.max.apply(Math, aIdx) >= aHeader.length)
      throw new Error(
        `Row missing fields for layout: ${JSON.stringify(
          layout,
        )} - Row: ${header}`,
      );

    return layout.fields.every(field => {
      if (
        field.name !== '' &&
        isNumber(field.index) &&
        !field.fixedValue &&
        !field.transformFunction
      ) {
        if (aHeader[field.index!] !== field.name)
          throw new Error(
            `Invalid header: ${
              aHeader[field.index!]
            } for field: ${JSON.stringify(field)}`,
          );
      }

      return true;
    });
  }

  private async parseRow(
    row: string,
    rowIndex: number,
    layout: IFileLayout,
    poolUtc: PoolClient,
    transformParams: any,
  ): Promise<string> {
    const aData = row.split(layout.separator);
    const aIdx: number[] = layout.fields
      .filter(f => f)
      .map(f => Number(f.index));
    if (!aIdx)
      throw new Error(
        `Layout doen't have any data index source: ${JSON.stringify(layout)}`,
      );

    // eslint-disable-next-line prefer-spread
    if (Math.max.apply(Math, aIdx) >= aData.length)
      throw new Error(`Row missing fields for layout: ${layout} - Row: ${row}`);

    const aFormattedData: any[] = [];
    for (let index = 0; index < layout.fields.length; index++) {
      const field = layout.fields[index];

      if (
        !field.fixedValue &&
        !field.transformFunction &&
        (!isNumber(field.index) || Number(field.index) >= aData.length)
      )
        throw new Error(
          `Can't find index/field ${field.index}/${field.name} in row: ${row}`,
        );

      let value: any;

      if (field.transformFunction) {
        if (!transformParams)
          throw new Error(
            `Transform parameters not provided for field: ${JSON.stringify(
              field,
            )}`,
          );

        value = await field.transformFunction({
          row: row.split(layout.separator),
          rowIndex,
          layout,
          poolClient: poolUtc,
          ...transformParams,
        });
      } else
        value = field.fixedValue
          ? field.fixedValue
          : String(aData[field.index!]);

      value = await convertToFieldType(value, field, layout, rowIndex, poolUtc);

      // Postgres data formatting
      if (
        field.type === TFieldType.TIMESTAMPTZ ||
        field.type === TFieldType.TIMESTAMP ||
        field.type === TFieldType.DATE
      ) {
        value = DateTime.isDateTime(value)
          ? value.toISO()
          : value instanceof Date
          ? DateTime.fromJSDate(value).toISO()
          : DateTime.fromISO(value).toISO();
      }

      aFormattedData.push(value);
    }

    return aFormattedData.join(';');
  }

  public static async getFileSize(
    pathFile: string,
    unit: TFileSizeUnit,
  ): Promise<number> {
    if (!fs.existsSync(pathFile))
      throw new Error(`File not found: ${pathFile}`);

    const { size } = fs.statSync(pathFile);

    return +(Number(size) / 1024 ** unit).toFixed(2);
  }
}

export default DataFileLoader;
export {
  LAYOUT_HOLIDAYS_CAL,
  LAYOUT_PROFIT_FRP,
  LAYOUT_PROFIT_1M,
  LAYOUT_PROFIT_ROLLING_TT,
  IFieldTransformParameteres,
  IFileLayout,
  IField,
  TFieldType,
  TFileSizeUnit,
};
