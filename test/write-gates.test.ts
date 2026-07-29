import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MysqlClient } from '../src/clients/mysql-client.js';
import {
  handleSchemaQuery,
  handleWriteQuery,
} from '../src/tools/write.js';

function mockClient(): MysqlClient {
  return {
    executeMutation: async () => ({ durationMs: 1, affectedRows: 1 }),
    executeTransaction: async () => ({
      success: true,
      durationMs: 1,
      results: [],
    }),
  } as unknown as MysqlClient;
}

describe('write tool gates', () => {
  it('should preview write_query and not execute', async () => {
    let called = false;
    const client = {
      executeMutation: async () => {
        called = true;
        return { durationMs: 1, affectedRows: 1 };
      },
    } as unknown as MysqlClient;

    const result = await handleWriteQuery(client, {
      sql: 'DELETE FROM users WHERE id = 1',
    });
    assert.equal(called, false);
    assert.match(result.content[0].text, /Confirmation required/);
    assert.match(result.content[0].text, /confirmed: true/);
    assert.match(result.content[0].text, /write_query/);
  });

  it('should execute write_query when confirmed', async () => {
    const result = await handleWriteQuery(mockClient(), {
      sql: 'DELETE FROM users WHERE id = 1',
      confirmed: true,
    });
    assert.match(result.content[0].text, /Write executed after confirmation/);
  });

  it('should route DDL to schema_query', async () => {
    const result = await handleWriteQuery(mockClient(), {
      sql: 'DROP TABLE users',
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /schema_query/);
  });

  it('should preview schema_query', async () => {
    const result = await handleSchemaQuery(mockClient(), {
      sql: 'ALTER TABLE users ADD COLUMN x INT',
    });
    assert.match(result.content[0].text, /schema_query/);
    assert.match(result.content[0].text, /confirmed: true/);
  });
});
