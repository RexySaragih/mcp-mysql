import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MysqlClient } from '../src/clients/mysql-client.js';
import { handleReadQuery, handleExplainQuery } from '../src/tools/query.js';
import {
  handleDescribeTable,
  handleListDatabases,
  handleListTables,
} from '../src/tools/schema.js';

function mockClient(
  overrides: Partial<MysqlClient> = {},
): MysqlClient {
  return {
    maxRows: 100,
    timeoutMs: 30_000,
    defaultDatabase: 'app',
    resolveDatabase: (database?: string) => database ?? 'app',
    listDatabases: async () => ['app', 'information_schema'],
    listTables: async () => [
      {
        database: 'app',
        name: 'users',
        type: 'BASE TABLE',
        engine: 'InnoDB',
        rowsApprox: 10,
      },
    ],
    describeTable: async () => [
      {
        name: 'id',
        dataType: 'int',
        columnType: 'int',
        nullable: false,
        key: 'PRI',
        defaultValue: null,
        extra: 'auto_increment',
      },
    ],
    listIndexes: async () => [],
    listForeignKeys: async () => [],
    readQuery: async () => ({
      rows: [{ id: 1, email: 'a@b.c' }],
      fields: ['id', 'email'],
      durationMs: 3,
      truncated: false,
    }),
    explainQuery: async () => ({
      rows: [{ id: 1, select_type: 'SIMPLE', table: 'users' }],
      fields: ['id', 'select_type', 'table'],
      durationMs: 2,
      truncated: false,
    }),
    ping: async () => undefined,
    close: async () => undefined,
    ...overrides,
  } as MysqlClient;
}

describe('schema handlers', () => {
  it('should list databases as compact text', async () => {
    const result = await handleListDatabases(mockClient(), {});
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /databases \(2\)/);
    assert.match(result.content[0].text, /app/);
  });

  it('should list tables', async () => {
    const result = await handleListTables(mockClient(), {});
    assert.match(result.content[0].text, /app\.users/);
  });

  it('should describe table as markdown', async () => {
    const result = await handleDescribeTable(mockClient(), {
      table: 'users',
    });
    assert.match(result.content[0].text, /# app\.users/);
    assert.match(result.content[0].text, /\| id \|/);
  });
});

describe('query handlers', () => {
  it('should reject mutating SQL before hitting the client', async () => {
    let called = false;
    const client = mockClient({
      readQuery: async () => {
        called = true;
        return { rows: [], fields: [], durationMs: 0, truncated: false };
      },
    });
    const result = await handleReadQuery(client, {
      sql: 'DELETE FROM users',
    });
    assert.equal(result.isError, true);
    assert.equal(called, false);
  });

  it('should preview confirmation for FOR UPDATE without confirmed', async () => {
    let called = false;
    const client = mockClient({
      readQuery: async () => {
        called = true;
        return { rows: [], fields: [], durationMs: 0, truncated: false };
      },
    });
    const result = await handleReadQuery(client, {
      sql: 'SELECT id FROM users FOR UPDATE',
    });
    assert.equal(result.isError, undefined);
    assert.equal(called, false);
    assert.match(result.content[0].text, /Confirmation required/);
    assert.match(result.content[0].text, /confirmed: true/);
  });

  it('should run FOR UPDATE when confirmed', async () => {
    const result = await handleReadQuery(mockClient(), {
      sql: 'SELECT id FROM users FOR UPDATE',
      confirmed: true,
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Query results/);
    assert.match(result.content[0].text, /after confirmation/i);
  });

  it('should run safe SELECT', async () => {
    const result = await handleReadQuery(mockClient(), {
      sql: 'SELECT id, email FROM users',
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Query results/);
    assert.match(result.content[0].text, /a@b\.c/);
  });

  it('should explain SELECT', async () => {
    const result = await handleExplainQuery(mockClient(), {
      sql: 'SELECT 1',
      format: 'traditional',
    });
    assert.match(result.content[0].text, /EXPLAIN/);
  });
});
