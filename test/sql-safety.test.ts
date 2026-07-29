import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertExplainableSelect,
  assertReadOnlySelect,
  formatConfirmationPrompt,
} from '../src/utils/sql-safety.js';
import { applyRowLimit } from '../src/utils/row-limit.js';
import { databaseFromMysqlUrl } from '../src/clients/mysql-client.js';

describe('assertReadOnlySelect', () => {
  it('should allow simple SELECT', () => {
    const result = assertReadOnlySelect('SELECT 1');
    assert.equal(result.ok, true);
    assert.equal(result.needsConfirmation, false);
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

  it('should flag FOR UPDATE for confirmation (not reject)', () => {
    const result = assertReadOnlySelect(
      'SELECT id FROM users WHERE id = 1 FOR UPDATE',
    );
    assert.equal(result.ok, true);
    assert.equal(result.needsConfirmation, true);
    assert.ok(result.risks.some((risk) => risk.kind === 'for_update'));
  });

  it('should flag INTO @var for confirmation', () => {
    const result = assertReadOnlySelect('SELECT id INTO @x FROM users LIMIT 1');
    assert.equal(result.ok, true);
    assert.equal(result.needsConfirmation, true);
  });

  it('should explain confirmation impact', () => {
    const result = assertReadOnlySelect('SELECT * FROM t FOR UPDATE');
    const text = formatConfirmationPrompt(result, result.normalized);
    assert.match(text, /Confirmation required/);
    assert.match(text, /confirmed: true/);
    assert.match(text, /exclusive locks/i);
  });
});

describe('assertExplainableSelect', () => {
  it('should allow SELECT for explain', () => {
    const result = assertExplainableSelect('SELECT id FROM users');
    assert.equal(result.ok, true);
  });
});

describe('applyRowLimit', () => {
  it('should append LIMIT', () => {
    assert.equal(applyRowLimit('SELECT * FROM t', 50), 'SELECT * FROM t LIMIT 50');
  });

  it('should clamp existing LIMIT', () => {
    assert.equal(
      applyRowLimit('SELECT * FROM t LIMIT 999', 50),
      'SELECT * FROM t LIMIT 50',
    );
  });

  it('should insert LIMIT before FOR UPDATE', () => {
    assert.equal(
      applyRowLimit('SELECT * FROM t WHERE id = 1 FOR UPDATE', 10),
      'SELECT * FROM t WHERE id = 1 LIMIT 10 FOR UPDATE',
    );
  });
});

describe('databaseFromMysqlUrl', () => {
  it('should parse database from URL path', () => {
    assert.equal(
      databaseFromMysqlUrl('mysql://u:p@localhost:3306/app_db'),
      'app_db',
    );
  });

  it('should return undefined without path', () => {
    assert.equal(
      databaseFromMysqlUrl('mysql://u:p@localhost:3306'),
      undefined,
    );
  });
});
