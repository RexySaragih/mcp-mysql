import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertExplainableSelect,
  assertReadOnlySelect,
} from '../src/utils/sql-safety.js';

describe('assertReadOnlySelect', () => {
  it('should allow simple SELECT', () => {
    const result = assertReadOnlySelect('SELECT 1');
    assert.equal(result.ok, true);
  });

  it('should allow WITH … SELECT', () => {
    const result = assertReadOnlySelect(
      'WITH cte AS (SELECT 1 AS n) SELECT * FROM cte',
    );
    assert.equal(result.ok, true);
  });

  it('should reject INSERT', () => {
    const result = assertReadOnlySelect('INSERT INTO t VALUES (1)');
    assert.equal(result.ok, false);
  });

  it('should reject multi-statement', () => {
    const result = assertReadOnlySelect('SELECT 1; DROP TABLE users');
    assert.equal(result.ok, false);
  });

  it('should reject INTO OUTFILE', () => {
    const result = assertReadOnlySelect(
      "SELECT * FROM t INTO OUTFILE '/tmp/x'",
    );
    assert.equal(result.ok, false);
  });

  it('should reject comments wrapping DELETE', () => {
    const result = assertReadOnlySelect('/* comment */ DELETE FROM t');
    assert.equal(result.ok, false);
  });

  it('should reject WITH containing DELETE', () => {
    const result = assertReadOnlySelect(
      'WITH cte AS (SELECT 1) DELETE FROM t',
    );
    assert.equal(result.ok, false);
  });
});

describe('assertExplainableSelect', () => {
  it('should allow SELECT for explain', () => {
    const result = assertExplainableSelect('SELECT id FROM users');
    assert.equal(result.ok, true);
  });
});
