import { ClientConstants } from '../clients/base-client.js';
import type { MysqlRow } from '../types/index.js';

export function truncateCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) {
    return `<buffer ${value.length}b>`;
  }
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value);
      return json.length > ClientConstants.CELL_TRUNCATE
        ? `${json.slice(0, ClientConstants.CELL_TRUNCATE)}…`
        : json;
    } catch {
      return '[unserializable]';
    }
  }
  const text = String(value);
  return text.length > ClientConstants.CELL_TRUNCATE
    ? `${text.slice(0, ClientConstants.CELL_TRUNCATE)}…`
    : text;
}

export function formatRowsAsMarkdownTable(
  rows: MysqlRow[],
  fields: string[],
  options: { durationMs: number; truncated: boolean; title?: string },
): string {
  const lines: string[] = [];
  if (options.title) lines.push(`## ${options.title}`);
  lines.push(`**Rows:** ${rows.length}${options.truncated ? ' (truncated)' : ''}`);
  lines.push(`**Duration:** ${options.durationMs}ms`);
  lines.push('');

  if (rows.length === 0) {
    lines.push('_No rows returned._');
    return lines.join('\n');
  }

  const cols = fields.length > 0 ? fields : Object.keys(rows[0] ?? {});
  lines.push(`| ${cols.join(' | ')} |`);
  lines.push(`| ${cols.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    const cells = cols.map((col) => escapePipe(truncateCell(row[col])));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function escapePipe(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function formatCompactLines(
  header: string,
  lines: string[],
): string {
  if (lines.length === 0) return `${header}\n(none)`;
  return `${header}\n${lines.join('\n')}`;
}

export function toolOk(text: string): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return { content: [{ type: 'text', text }] };
}

export function toolErr(text: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return { content: [{ type: 'text', text }], isError: true };
}
