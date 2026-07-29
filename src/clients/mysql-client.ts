import mysql from 'mysql2/promise';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import {
  ClientConstants,
  optionalEnv,
  parsePositiveInt,
  requireEnv,
  sanitizeErrorMessage,
} from './base-client.js';
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  MysqlRow,
  QueryResult,
  TableSummary,
} from '../types/index.js';

export interface MysqlClientConfig {
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  timeoutMs?: number;
  maxRows?: number;
}

function configFromEnv(): MysqlClientConfig {
  const url = optionalEnv('MYSQL_URL');
  return {
    url,
    host: optionalEnv('MYSQL_HOST') ?? '127.0.0.1',
    port: parsePositiveInt(optionalEnv('MYSQL_PORT'), 3306),
    user: url ? undefined : requireEnv('MYSQL_USER'),
    password: optionalEnv('MYSQL_PASSWORD') ?? '',
    database: optionalEnv('MYSQL_DATABASE'),
    ssl: (optionalEnv('MYSQL_SSL') ?? '').toLowerCase() === 'true',
    timeoutMs: parsePositiveInt(
      optionalEnv('MYSQL_QUERY_TIMEOUT_MS'),
      ClientConstants.DEFAULT_TIMEOUT_MS,
    ),
    maxRows: parsePositiveInt(
      optionalEnv('MYSQL_MAX_ROWS'),
      ClientConstants.DEFAULT_MAX_ROWS,
    ),
  };
}

export class MysqlClient {
  private readonly pool: Pool;
  readonly timeoutMs: number;
  readonly maxRows: number;
  readonly defaultDatabase: string | undefined;

  constructor(config: MysqlClientConfig = configFromEnv()) {
    this.timeoutMs = config.timeoutMs ?? ClientConstants.DEFAULT_TIMEOUT_MS;
    this.maxRows = Math.min(
      config.maxRows ?? ClientConstants.DEFAULT_MAX_ROWS,
      ClientConstants.HARD_MAX_ROWS,
    );
    this.defaultDatabase = config.database;

    try {
      if (config.url) {
        this.pool = mysql.createPool(config.url);
      } else {
        if (!config.user) {
          throw new Error('MYSQL_USER is required when MYSQL_URL is not set');
        }
        this.pool = mysql.createPool({
          host: config.host ?? '127.0.0.1',
          port: config.port ?? 3306,
          user: config.user,
          password: config.password ?? '',
          database: config.database,
          waitForConnections: true,
          connectionLimit: 4,
          namedPlaceholders: true,
          ssl: config.ssl ? {} : undefined,
        });
      }
    } catch (error: unknown) {
      throw new Error(`MySQL pool init failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  resolveDatabase(database?: string): string {
    const db = database ?? this.defaultDatabase;
    if (!db) {
      throw new Error(
        'Database not specified — pass `database` or set MYSQL_DATABASE / include it in MYSQL_URL',
      );
    }
    return db;
  }

  async ping(): Promise<void> {
    await this.queryRows('SELECT 1 AS ok', [], 1);
  }

  async listDatabases(): Promise<string[]> {
    const rows = await this.queryRows<{ Database: string }>(
      'SHOW DATABASES',
      [],
      ClientConstants.HARD_MAX_ROWS,
    );
    return rows.map((row) => String(row.Database));
  }

  async listTables(database?: string): Promise<TableSummary[]> {
    const db = this.resolveDatabase(database);
    const rows = await this.queryRows<RowDataPacket>(
      `SELECT TABLE_SCHEMA AS db_name,
              TABLE_NAME AS name,
              TABLE_TYPE AS table_type,
              ENGINE AS engine,
              TABLE_ROWS AS rows_approx
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [db],
      ClientConstants.HARD_MAX_ROWS,
    );
    return rows.map((row) => ({
      database: String(row.db_name),
      name: String(row.name),
      type: String(row.table_type),
      engine: row.engine == null ? null : String(row.engine),
      rowsApprox: row.rows_approx == null ? null : Number(row.rows_approx),
    }));
  }

  async describeTable(
    table: string,
    database?: string,
  ): Promise<ColumnInfo[]> {
    const db = this.resolveDatabase(database);
    const rows = await this.queryRows<RowDataPacket>(
      `SELECT COLUMN_NAME AS name,
              DATA_TYPE AS data_type,
              COLUMN_TYPE AS column_type,
              IS_NULLABLE AS is_nullable,
              COLUMN_KEY AS column_key,
              COLUMN_DEFAULT AS column_default,
              EXTRA AS extra
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [db, table],
      ClientConstants.HARD_MAX_ROWS,
    );
    if (rows.length === 0) {
      throw new Error(`Table not found: ${db}.${table}`);
    }
    return rows.map((row) => ({
      name: String(row.name),
      dataType: String(row.data_type),
      columnType: String(row.column_type),
      nullable: String(row.is_nullable).toUpperCase() === 'YES',
      key: String(row.column_key ?? ''),
      defaultValue:
        row.column_default == null ? null : String(row.column_default),
      extra: String(row.extra ?? ''),
    }));
  }

  async listIndexes(
    table: string,
    database?: string,
  ): Promise<IndexInfo[]> {
    const db = this.resolveDatabase(database);
    const rows = await this.queryRows<RowDataPacket>(
      `SELECT INDEX_NAME AS name,
              COLUMN_NAME AS col_name,
              NON_UNIQUE AS non_unique,
              SEQ_IN_INDEX AS seq,
              INDEX_TYPE AS index_type
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [db, table],
      ClientConstants.HARD_MAX_ROWS,
    );
    return rows.map((row) => ({
      name: String(row.name),
      column: String(row.col_name),
      nonUnique: Number(row.non_unique) === 1,
      seq: Number(row.seq),
      type: String(row.index_type),
    }));
  }

  async listForeignKeys(
    database?: string,
    table?: string,
  ): Promise<ForeignKeyInfo[]> {
    const db = this.resolveDatabase(database);
    const params: unknown[] = [db];
    let sql = `
      SELECT kcu.CONSTRAINT_NAME AS constraint_name,
             kcu.TABLE_NAME AS table_name,
             kcu.COLUMN_NAME AS column_name,
             kcu.REFERENCED_TABLE_NAME AS referenced_table,
             kcu.REFERENCED_COLUMN_NAME AS referenced_column,
             rc.UPDATE_RULE AS update_rule,
             rc.DELETE_RULE AS delete_rule
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
       AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
      WHERE kcu.TABLE_SCHEMA = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`;
    if (table) {
      sql += ' AND kcu.TABLE_NAME = ?';
      params.push(table);
    }
    sql +=
      ' ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION';

    const rows = await this.queryRows<RowDataPacket>(
      sql,
      params,
      ClientConstants.HARD_MAX_ROWS,
    );
    return rows.map((row) => ({
      constraintName: String(row.constraint_name),
      table: String(row.table_name),
      column: String(row.column_name),
      referencedTable: String(row.referenced_table),
      referencedColumn: String(row.referenced_column),
      updateRule: String(row.update_rule),
      deleteRule: String(row.delete_rule),
    }));
  }

  async readQuery(sql: string, maxRows?: number): Promise<QueryResult> {
    const limit = Math.min(
      maxRows ?? this.maxRows,
      ClientConstants.HARD_MAX_ROWS,
    );
    return this.runSelect(sql, limit);
  }

  async explainQuery(
    sql: string,
    format: 'traditional' | 'json' = 'traditional',
  ): Promise<QueryResult> {
    const explained =
      format === 'json' ? `EXPLAIN FORMAT=JSON ${sql}` : `EXPLAIN ${sql}`;
    return this.runSelect(explained, ClientConstants.HARD_MAX_ROWS);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async runSelect(sql: string, maxRows: number): Promise<QueryResult> {
    const started = Date.now();
    try {
      const [result, fieldPackets] = await this.withTimeout(
        this.pool.query<RowDataPacket[]>({ sql, timeout: this.timeoutMs }),
      );
      const allRows = result as RowDataPacket[];
      const rows = allRows.slice(0, maxRows) as MysqlRow[];
      const fields =
        fieldPackets?.map((field) => field.name) ??
        (rows[0] ? Object.keys(rows[0]) : []);
      return {
        rows,
        fields,
        durationMs: Date.now() - started,
        truncated: allRows.length > maxRows,
      };
    } catch (error: unknown) {
      throw new Error(`Query failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  private async queryRows<T extends object>(
    sql: string,
    params: unknown[],
    maxRows: number,
  ): Promise<T[]> {
    try {
      const [result] = await this.withTimeout(
        this.pool.query<RowDataPacket[]>({
          sql,
          values: params,
          timeout: this.timeoutMs,
        }),
      );
      return (result as unknown as T[]).slice(0, maxRows);
    } catch (error: unknown) {
      throw new Error(`Query failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error(`MySQL query timed out after ${this.timeoutMs}ms`),
            );
          }, this.timeoutMs + 1_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
