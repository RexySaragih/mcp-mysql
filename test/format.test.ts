import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatRowsAsMarkdownTable,
  truncateCell,
} from '../src/utils/format.js';
import { sanitizeUpstreamBody } from '../src/clients/base-client.js';

describe('format helpers', () => {
  it('should truncate long cells', () => {
    const long = 'x'.repeat(600);
    const out = truncateCell(long);
    assert.ok(out.endsWith('…'));
    assert.ok(out.length < 510);
  });

  it('should render markdown table', () => {
    const text = formatRowsAsMarkdownTable(
      [{ id: 1, name: 'a|b' }],
      ['id', 'name'],
      { durationMs: 1, truncated: false, title: 't' },
    );
    assert.match(text, /## t/);
    assert.match(text, /a\\\|b/);
  });
});

describe('sanitizeUpstreamBody', () => {
  it('should redact mysql urls', () => {
    const out = sanitizeUpstreamBody(
      'fail mysql://user:secret@localhost:3306/db',
    );
    assert.match(out, /\[REDACTED\]/);
    assert.doesNotMatch(out, /secret/);
  });
});
