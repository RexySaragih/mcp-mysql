import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MysqlClient } from '../clients/mysql-client.js';
import { sanitizeErrorMessage } from '../clients/base-client.js';
import type { ToolResponse } from '../types/index.js';
import { toolErr, toolOk } from '../utils/format.js';
import {
  analyzeQuery,
  formatTransactionConfirmation,
  formatWriteConfirmation,
} from '../utils/sql-safety.js';

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const writeQueryTool: Tool = {
  name: 'write_query',
  description:
    'Execute INSERT, UPDATE, DELETE, REPLACE, or TRUNCATE. Separate from read_query. Requires confirmed=true after a strong confirmation preview.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'Single INSERT/UPDATE/DELETE/REPLACE/TRUNCATE statement',
      },
      confirmed: {
        type: 'boolean',
        description:
          'Must be true to execute. If omitted/false, returns an impact preview only — nothing runs.',
      },
    },
    required: ['sql'],
    additionalProperties: false,
  },
  annotations: WRITE_ANNOTATIONS,
};

export const schemaQueryTool: Tool = {
  name: 'schema_query',
  description:
    'Execute CREATE, ALTER, DROP, or RENAME (DDL). Separate from write_query. Requires confirmed=true after a strong confirmation preview.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'Single CREATE/ALTER/DROP/RENAME statement',
      },
      confirmed: {
        type: 'boolean',
        description:
          'Must be true to execute. If omitted/false, returns an impact preview only — nothing runs.',
      },
    },
    required: ['sql'],
    additionalProperties: false,
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};

export const transactionQueryTool: Tool = {
  name: 'transaction_query',
  description:
    'Execute multiple statements in one transaction. Preview lists per-statement risk. Requires confirmed=true.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'One or more SQL statements separated by semicolons',
      },
      confirmed: {
        type: 'boolean',
        description:
          'Must be true to execute. If omitted/false, returns a per-statement risk preview only.',
      },
    },
    required: ['sql'],
    additionalProperties: false,
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};

const confirmedSqlSchema = z.object({
  sql: z.string().min(1),
  confirmed: z.boolean().optional(),
});

function rejectMultiStatement(sql: string): string | null {
  const normalized = sql.trim().replace(/;+\s*$/, '');
  if (normalized.includes(';')) {
    return 'Multiple statements are not allowed here — use transaction_query for multi-statement work.';
  }
  return null;
}

export async function handleWriteQuery(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = confirmedSqlSchema.parse(args ?? {});
    const multi = rejectMultiStatement(parsed.sql);
    if (multi) return toolErr(multi);

    const analysis = analyzeQuery(parsed.sql);
    if (analysis.isReadOnly) {
      return toolErr(
        'write_query only accepts INSERT/UPDATE/DELETE/REPLACE/TRUNCATE. Use read_query for SELECT.',
      );
    }
    if (
      analysis.type === 'CREATE' ||
      analysis.type === 'ALTER' ||
      analysis.type === 'DROP' ||
      analysis.type === 'RENAME'
    ) {
      return toolErr('Use schema_query for CREATE/ALTER/DROP/RENAME.');
    }
    if (
      analysis.type !== 'INSERT' &&
      analysis.type !== 'UPDATE' &&
      analysis.type !== 'DELETE' &&
      analysis.type !== 'REPLACE' &&
      analysis.type !== 'TRUNCATE'
    ) {
      return toolErr(
        `Unsupported write type ${analysis.type}. Use schema_query or transaction_query if appropriate.`,
      );
    }

    if (!parsed.confirmed) {
      return toolOk(
        formatWriteConfirmation(
          'write_query',
          analysis,
          analysis.normalized || parsed.sql,
        ),
      );
    }

    const result = await client.executeMutation(analysis.normalized);
    return toolOk(
      [
        '**Write executed after confirmation**',
        `**Type:** ${analysis.type}`,
        `**Duration:** ${result.durationMs}ms`,
        `**Affected rows:** ${result.affectedRows}`,
      ].join('\n'),
    );
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleSchemaQuery(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = confirmedSqlSchema.parse(args ?? {});
    const multi = rejectMultiStatement(parsed.sql);
    if (multi) return toolErr(multi);

    const analysis = analyzeQuery(parsed.sql);
    if (
      analysis.type !== 'CREATE' &&
      analysis.type !== 'ALTER' &&
      analysis.type !== 'DROP' &&
      analysis.type !== 'RENAME'
    ) {
      return toolErr(
        'schema_query only accepts CREATE, ALTER, DROP, or RENAME. Use write_query for DML.',
      );
    }

    if (!parsed.confirmed) {
      return toolOk(
        formatWriteConfirmation(
          'schema_query',
          analysis,
          analysis.normalized || parsed.sql,
        ),
      );
    }

    const result = await client.executeMutation(analysis.normalized);
    return toolOk(
      [
        '**Schema change executed after confirmation**',
        `**Type:** ${analysis.type}`,
        `**Duration:** ${result.durationMs}ms`,
        `**Affected rows:** ${result.affectedRows}`,
      ].join('\n'),
    );
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleTransactionQuery(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = confirmedSqlSchema.parse(args ?? {});

    if (!parsed.confirmed) {
      return toolOk(formatTransactionConfirmation(parsed.sql));
    }

    const result = await client.executeTransaction(parsed.sql);
    if (!result.success) {
      return toolErr(
        [
          '**Transaction failed** (rolled back)',
          `**Duration:** ${result.durationMs}ms`,
          `**Error:** ${result.error}`,
          `**Statements before error:** ${result.results.length}`,
        ].join('\n'),
      );
    }

    const lines = [
      '**Transaction executed after confirmation**',
      `**Duration:** ${result.durationMs}ms`,
      `**Statements:** ${result.results.length}`,
      '',
      '**Results:**',
    ];
    result.results.forEach((stmt, index) => {
      lines.push(`\n${index + 1}. ${stmt.statement}`);
      lines.push(`   - Duration: ${stmt.durationMs}ms`);
      if (stmt.affectedRows !== undefined) {
        lines.push(`   - Affected rows: ${stmt.affectedRows}`);
      }
    });
    return toolOk(lines.join('\n'));
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}
