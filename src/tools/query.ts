import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MysqlClient } from '../clients/mysql-client.js';
import { ClientConstants, sanitizeErrorMessage } from '../clients/base-client.js';
import type { ToolResponse } from '../types/index.js';
import {
  formatRowsAsMarkdownTable,
  toolErr,
  toolOk,
} from '../utils/format.js';
import {
  assertExplainableSelect,
  assertReadOnlySelect,
  formatConfirmationPrompt,
} from '../utils/sql-safety.js';

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const readQueryTool: Tool = {
  name: 'read_query',
  description:
    'Execute a single read-only SELECT (or WITH … SELECT). Mutating SQL is rejected. Queries with FOR UPDATE / FOR SHARE / LOCK IN SHARE MODE / INTO @var require confirmed=true after a preview. Results are LIMIT-capped.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SELECT or WITH … SELECT statement',
      },
      max_rows: {
        type: 'number',
        description: `Max rows to return (default env MYSQL_MAX_ROWS / ${ClientConstants.DEFAULT_MAX_ROWS}, hard max ${ClientConstants.HARD_MAX_ROWS})`,
      },
      confirmed: {
        type: 'boolean',
        description:
          'Required true to run SELECT variants that take locks or set session variables. If omitted/false, returns a confirmation preview explaining impact.',
      },
    },
    required: ['sql'],
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

export const explainQueryTool: Tool = {
  name: 'explain_query',
  description:
    'Run EXPLAIN on a SELECT / WITH query (traditional or JSON format).',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SELECT or WITH … SELECT statement to explain',
      },
      format: {
        type: 'string',
        enum: ['traditional', 'json'],
        description: 'EXPLAIN output format (default traditional)',
      },
    },
    required: ['sql'],
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

const readQuerySchema = z.object({
  sql: z.string().min(1),
  max_rows: z
    .number()
    .int()
    .positive()
    .max(ClientConstants.HARD_MAX_ROWS)
    .optional(),
  confirmed: z.boolean().optional(),
});

const explainQuerySchema = z.object({
  sql: z.string().min(1),
  format: z.enum(['traditional', 'json']).optional(),
});

export async function handleReadQuery(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = readQuerySchema.parse(args ?? {});
    const safety = assertReadOnlySelect(parsed.sql);
    if (!safety.ok) {
      return toolErr(safety.reason ?? 'Rejected SQL');
    }

    if (safety.needsConfirmation && !parsed.confirmed) {
      return toolOk(formatConfirmationPrompt(safety, safety.normalized));
    }

    const result = await client.readQuery(safety.normalized, parsed.max_rows);
    const confirmationNote =
      safety.needsConfirmation && parsed.confirmed
        ? '\n\n_Executed after confirmation (lock / session-variable side effects)._\n'
        : '';
    return toolOk(
      confirmationNote +
        formatRowsAsMarkdownTable(result.rows, result.fields, {
          durationMs: result.durationMs,
          truncated: result.truncated,
          title: 'Query results',
        }),
    );
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleExplainQuery(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = explainQuerySchema.parse(args ?? {});
    const safety = assertExplainableSelect(parsed.sql);
    if (!safety.ok) {
      return toolErr(safety.reason ?? 'Rejected SQL');
    }
    const format = parsed.format ?? 'traditional';
    const result = await client.explainQuery(safety.normalized, format);
    return toolOk(
      formatRowsAsMarkdownTable(result.rows, result.fields, {
        durationMs: result.durationMs,
        truncated: result.truncated,
        title: `EXPLAIN (${format})`,
      }),
    );
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}
