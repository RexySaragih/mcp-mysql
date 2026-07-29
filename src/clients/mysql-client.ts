import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { SslOptions } from 'mysql2';
import {
  ClientConstants,
  optionalEnv,
  parsePositiveInt,
  requireEnv,
  sanitizeErrorMessage,
} from './base-client.js';
import { applyRowLimit } from '../utils/row-limit.js';
import type {
  ColumnInfo,
  EventInfo,
  ForeignKeyInfo,
  IndexInfo,
  MysqlRow,
  QueryResult,
  RoutineInfo,
  TableSummary,
  TriggerInfo,
} from '../types/index.js';

export interface MysqlClientConfig {
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: SslOptions;
  timeoutMs?: number;
  maxRows?: number;
}

export function databaseFromMysqlUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

function buildSslOptions(): SslOptions | undefined {
  const enabled = (optionalEnv('MYSQL_SSL') ?? '').toLowerCase() === 'true';
  if (!enabled) return undefined;

  const caPath = optionalEnv('MYSQL_SSL_CA');
  const certPath = optionalEnv('MYSQL_SSL_CERT');
  const keyPath = optionalEnv('MYSQL_SSL_KEY');
  const rejectUnauthorized =
    (optionalEnv('MYSQL_SSL_REJECT_UNAUTHORIZED') ?? 'true').toLowerCase() !==
    'false';

  const ssl: SslOptions = { rejectUnauthorized };
  if (caPath) ssl.ca = readFileSync(caPath);
  if (certPath) ssl.cert = readFileSync(certPath);
  if (keyPath) ssl.key = readFileSync(keyPath);
  return ssl;
}

function parseUrlConfig(url: string): {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password
      ? decodeURIComponent(parsed.password)
      : undefined,
    database: databaseFromMysqlUrl(url),
  };
}

function configFromEnv(): MysqlClientConfig {
  const url = optionalEnv('MYSQL_URL');
  const fromUrl = url ? parseUrlConfig(url) : undefined;
  return {
    url,
    host: optionalEnv('MYSQL_HOST') ?? fromUrl?.host ?? '127.0.0.1',
    port: parsePositiveInt(
      optionalEnv('MYSQL_PORT'),
      fromUrl?.port ?? 3306,
    ),
    user: optionalEnv('MYSQL_USER') ?? fromUrl?.user,
    password: optionalEnv('MYSQL_PASSWORD') ?? fromUrl?.password ?? '',
    database: optionalEnv('MYSQL_DATABASE') ?? fromUrl?.database,
    ssl: buildSslOptions(),
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

    const user = config.user;
    if (!user && !config.url) {
      throw new Error(
        'MYSQL_USER is required when MYSQL_URL is not set — set either in mcp.json mcpServers.*.env',
      );
    }

    try {
      // Prefer discrete fields so SSL + default database always apply,
      // including when MYSQL_URL was the source of host/user/db.
      this.pool = mysql.createPool({
        host: config.host ?? '127.0.0.1',
        port: config.port ?? 3306,
        user: user ?? requireEnv('MYSQL_USER'),
        password: config.password ?? '',
        database: config.database,
        waitForConnections: true,
        connectionLimit: 4,
        namedPlaceholders: true,
        ssl: config.ssl,
      });
    } catch (error: unknown) {
      throw new Error(`MySQL pool init failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  resolveDatabase(database?: string): string {
    const db = database ?? this.defaultDatabase;
    if (!db) {
      throw new Error(
        'Database not specified — pass `database` or set MYSQL_DATABASE / MYSQL_URL in mcp.json env',
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

  async showCreateTable(table: string, database?: string): Promise<string> {
    const db = this.resolveDatabase(database);
    const qualified = `\`${db.replace(/`/g, '``')}\`.\`${table.replace(/`/g, '``')}\``;
    const rows = await this.queryRows<RowDataPacket>(
      `SHOW CREATE TABLE ${qualified}`,
      [],
      1,
    );
    if (rows.length === 0) {
      throw new Error(`Table not found: ${db}.${table}`);
    }
    const ddl =
      rows[0]['Create Table'] ??
      rows[0]['Create View'] ??
      rows[0]['CREATE TABLE'];
    if (ddl == null) {
      throw new Error(`SHOW CREATE TABLE returned no DDL for ${db}.${table}`);
    }
    return String(ddl);
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

  async listRoutines(database?: string): Promise<RoutineInfo[]> {
    const db = this.resolveDatabase(database);
    const rows = await this.queryRows<RowDataPacket>(
      `SELECT ROUTINE_NAME AS name,
              ROUTINE_TYPE AS routine_type,
              DTD_IDENTIFIER AS return_type,
              ROUTINE_DEFINITION AS definition,
              CREATED AS created_at,
              LAST_ALTERED AS updated_at
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = ?
       ORDER BY ROUTINE_TYPE, ROUTINE_NAME`,
      [db],
      ClientConstants.HARD_MAX_ROWS,
    );
    return rows.map((row) => ({
      name: String(row.name),
      type: String(row.routine_type),
      returnType: row.return_type == null ? null : String(row.return_type),
      definition:
        row.definition == null
          ? null
          : String(row.definition).slice(0, ClientConstants.CELL_TRUNCATE),
      createdAt: row.created_at == null ? null : String(row.created_at),
      updatedAt: row.updated_at == null ? null : String(row.updated_at),
    }));
  }

  async listTriggers(
    database?: string,
    table?: string,
  ): Promise<TriggerInfo[]> {
    const db = this.resolveDatabase(database);
    const params: unknown[] = [db];
    let sql = `
      SELECT TRIGGER_NAME AS name,
             EVENT_MANIPULATION AS event,
             EVENT_OBJECT_TABLE AS table_name,
             ACTION_TIMING AS timing,
             ACTION_STATEMENT AS statement
      FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = ?`;
    if (table) {
      sql += ' AND EVENT_OBJECT_TABLE = ?';
      params.push(table);
    }
    sql += ' ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME';
    const rows = await this.queryRows<RowDataPacket>(
      sql,
      params,
      ClientConstants.HARD_MAX_ROWS,
    );
    return rows.map((row) => ({
      name: String(row.name),
      event: String(row.event),
      table: String(row.table_name),
      timing: String(row.timing),
      statement: String(row.statement ?? '').slice(
        0,
        ClientConstants.CELL_TRUNCATE,
      ),
    }));
  }

  async listEvents(database?: string): Promise<EventInfo[]> {
    const db = this.resolveDatabase(database);
    const rows = await this.queryRows<RowDataPacket>(
      `SELECT EVENT_NAME AS name,
              STATUS AS status,
              EVENT_TYPE AS event_type,
              EXECUTE_AT AS execute_at,
              INTERVAL_VALUE AS interval_value,
              INTERVAL_FIELD AS interval_field,
              EVENT_DEFINITION AS definition
       FROM information_schema.EVENTS
       WHERE EVENT_SCHEMA = ?
       ORDER BY EVENT_NAME`,
      [db],
      ClientConstants.HARD_MAX_ROWS,
    );
    return rows.map((row) => ({
      name: String(row.name),
      status: String(row.status),
      eventType: String(row.event_type),
      executeAt: row.execute_at == null ? null : String(row.execute_at),
      intervalValue:
        row.interval_value == null ? null : String(row.interval_value),
      intervalField:
        row.interval_field == null ? null : String(row.interval_field),
      definition:
        row.definition == null
          ? null
          : String(row.definition).slice(0, ClientConstants.CELL_TRUNCATE),
    }));
  }

  async readQuery(sql: string, maxRows?: number): Promise<QueryResult> {
    const limit = Math.min(
      maxRows ?? this.maxRows,
      ClientConstants.HARD_MAX_ROWS,
    );
    const cappedSql = applyRowLimit(sql, limit);
    const result = await this.runSelect(cappedSql, limit);
    // If we injected/clamped LIMIT, treat hitting the cap as truncated.
    if (result.rows.length >= limit) {
      return { ...result, truncated: true };
    }
    return result;
  }

  async explainQuery(
    sql: string,
    format: 'traditional' | 'json' = 'traditional',
  ): Promise<QueryResult> {
    const explained =
      format === 'json' ? `EXPLAIN FORMAT=JSON ${sql}` : `EXPLAIN ${sql}`;
    return this.runSelect(explained, ClientConstants.HARD_MAX_ROWS);
  }

  async executeMutation(sql: string): Promise<{
    durationMs: number;
    affectedRows: number;
  }> {
    const started = Date.now();
    try {
      const [result] = await this.withTimeout(
        this.pool.query({ sql, timeout: this.timeoutMs }),
      );
      const header = result as { affectedRows?: number };
      return {
        durationMs: Date.now() - started,
        affectedRows: Number(header.affectedRows ?? 0),
      };
    } catch (error: unknown) {
      throw new Error(`Query failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  async executeTransaction(sql: string): Promise<{
    success: boolean;
    durationMs: number;
    results: Array<{ statement: string; affectedRows?: number; durationMs: number }>;
    error?: string;
  }> {
    const connection = await this.pool.getConnection();
    const started = Date.now();
    const results: Array<{
      statement: string;
      affectedRows?: number;
      durationMs: number;
    }> = [];

    try {
      const statements = sql
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.length > 0 && !/^\s*--/.test(part) && !/^\s*#/.test(part));

      if (statements.length === 0) {
        throw new Error('No valid SQL statements found');
      }

      await connection.beginTransaction();

      for (const statement of statements) {
        const upper = statement.toUpperCase().trim();
        if (
          upper === 'BEGIN' ||
          upper.startsWith('BEGIN ') ||
          upper === 'START TRANSACTION' ||
          upper.startsWith('START TRANSACTION') ||
          upper === 'COMMIT' ||
          upper.startsWith('COMMIT ') ||
          upper === 'ROLLBACK' ||
          upper.startsWith('ROLLBACK ')
        ) {
          // Skip explicit txn control — we manage the transaction.
          continue;
        }

        const stmtStart = Date.now();
        const [result] = await connection.query({
          sql: statement,
          timeout: this.timeoutMs,
        });
        const header = result as { affectedRows?: number };
        results.push({
          statement:
            statement.substring(0, 100) + (statement.length > 100 ? '...' : ''),
          affectedRows: header.affectedRows,
          durationMs: Date.now() - stmtStart,
        });
      }

      await connection.commit();
      return {
        success: true,
        durationMs: Date.now() - started,
        results,
      };
    } catch (error: unknown) {
      try {
        await connection.rollback();
      } catch {
        // ignore
      }
      return {
        success: false,
        durationMs: Date.now() - started,
        results,
        error: sanitizeErrorMessage(error),
      };
    } finally {
      connection.release();
    }
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
