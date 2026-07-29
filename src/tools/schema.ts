import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MysqlClient } from '../clients/mysql-client.js';
import type { ToolResponse } from '../types/index.js';
import {
  formatCompactLines,
  toolErr,
  toolOk,
} from '../utils/format.js';
import { sanitizeErrorMessage } from '../clients/base-client.js';

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const listDatabasesTool: Tool = {
  name: 'list_databases',
  description:
    'List MySQL databases (schemas) visible to the configured user.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

export const listTablesTool: Tool = {
  name: 'list_tables',
  description:
    'List tables and views in a database. Uses MYSQL_DATABASE when database is omitted.',
  inputSchema: {
    type: 'object',
    properties: {
      database: {
        type: 'string',
        description: 'Schema name (optional if MYSQL_DATABASE is set)',
      },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

export const describeTableTool: Tool = {
  name: 'describe_table',
  description: 'Describe columns for a table (types, nullability, keys).',
  inputSchema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Table name' },
      database: {
        type: 'string',
        description: 'Schema name (optional if MYSQL_DATABASE is set)',
      },
    },
    required: ['table'],
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

export const listIndexesTool: Tool = {
  name: 'list_indexes',
  description: 'List indexes for a table.',
  inputSchema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Table name' },
      database: {
        type: 'string',
        description: 'Schema name (optional if MYSQL_DATABASE is set)',
      },
    },
    required: ['table'],
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

export const listForeignKeysTool: Tool = {
  name: 'list_foreign_keys',
  description:
    'List foreign-key relationships in a database, optionally filtered by table.',
  inputSchema: {
    type: 'object',
    properties: {
      database: {
        type: 'string',
        description: 'Schema name (optional if MYSQL_DATABASE is set)',
      },
      table: {
        type: 'string',
        description: 'Limit to this table (optional)',
      },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

export const showCreateTableTool: Tool = {
  name: 'show_create_table',
  description: 'Return SHOW CREATE TABLE / VIEW DDL for a table or view.',
  inputSchema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Table or view name' },
      database: {
        type: 'string',
        description: 'Schema name (optional if MYSQL_DATABASE is set)',
      },
    },
    required: ['table'],
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

export const listRoutinesTool: Tool = {
  name: 'list_routines',
  description: 'List stored procedures and functions in a database.',
  inputSchema: {
    type: 'object',
    properties: {
      database: {
        type: 'string',
        description: 'Schema name (optional if MYSQL_DATABASE is set)',
      },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

export const listTriggersTool: Tool = {
  name: 'list_triggers',
  description: 'List triggers in a database, optionally filtered by table.',
  inputSchema: {
    type: 'object',
    properties: {
      database: {
        type: 'string',
        description: 'Schema name (optional if MYSQL_DATABASE is set)',
      },
      table: {
        type: 'string',
        description: 'Limit to this table (optional)',
      },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

export const listEventsTool: Tool = {
  name: 'list_events',
  description: 'List scheduled events in a database.',
  inputSchema: {
    type: 'object',
    properties: {
      database: {
        type: 'string',
        description: 'Schema name (optional if MYSQL_DATABASE is set)',
      },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY_ANNOTATIONS,
};

const listTablesSchema = z.object({
  database: z.string().min(1).optional(),
});

const describeTableSchema = z.object({
  table: z.string().min(1),
  database: z.string().min(1).optional(),
});

const listIndexesSchema = z.object({
  table: z.string().min(1),
  database: z.string().min(1).optional(),
});

const listForeignKeysSchema = z.object({
  database: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
});

const showCreateTableSchema = z.object({
  table: z.string().min(1),
  database: z.string().min(1).optional(),
});

const listRoutinesSchema = z.object({
  database: z.string().min(1).optional(),
});

const listTriggersSchema = z.object({
  database: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
});

const listEventsSchema = z.object({
  database: z.string().min(1).optional(),
});

export async function handleListDatabases(
  client: MysqlClient,
  _args: unknown,
): Promise<ToolResponse> {
  try {
    const databases = await client.listDatabases();
    return toolOk(
      formatCompactLines(
        `databases (${databases.length})`,
        databases.map((name) => name),
      ),
    );
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleListTables(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = listTablesSchema.parse(args ?? {});
    const tables = await client.listTables(parsed.database);
    const lines = tables.map(
      (table) =>
        `${table.database}.${table.name} | ${table.type} | engine=${table.engine ?? '-'} | ~rows=${table.rowsApprox ?? '-'}`,
    );
    return toolOk(formatCompactLines(`tables (${tables.length})`, lines));
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleDescribeTable(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = describeTableSchema.parse(args ?? {});
    const columns = await client.describeTable(parsed.table, parsed.database);
    const db = client.resolveDatabase(parsed.database);
    const lines = [
      `# ${db}.${parsed.table}`,
      '',
      '| column | type | nullable | key | default | extra |',
      '| --- | --- | --- | --- | --- | --- |',
      ...columns.map(
        (column) =>
          `| ${column.name} | ${column.columnType} | ${column.nullable} | ${column.key || '-'} | ${column.defaultValue ?? 'NULL'} | ${column.extra || '-'} |`,
      ),
    ];
    return toolOk(lines.join('\n'));
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleListIndexes(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = listIndexesSchema.parse(args ?? {});
    const indexes = await client.listIndexes(parsed.table, parsed.database);
    const lines = indexes.map(
      (index) =>
        `${index.name} | col=${index.column} | seq=${index.seq} | unique=${!index.nonUnique} | type=${index.type}`,
    );
    return toolOk(formatCompactLines(`indexes (${indexes.length})`, lines));
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleListForeignKeys(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = listForeignKeysSchema.parse(args ?? {});
    const fks = await client.listForeignKeys(parsed.database, parsed.table);
    const lines = fks.map(
      (fk) =>
        `${fk.constraintName} | ${fk.table}.${fk.column} -> ${fk.referencedTable}.${fk.referencedColumn} | on_update=${fk.updateRule} | on_delete=${fk.deleteRule}`,
    );
    return toolOk(formatCompactLines(`foreign_keys (${fks.length})`, lines));
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleShowCreateTable(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = showCreateTableSchema.parse(args ?? {});
    const ddl = await client.showCreateTable(parsed.table, parsed.database);
    const db = client.resolveDatabase(parsed.database);
    return toolOk(`# ${db}.${parsed.table}\n\n\`\`\`sql\n${ddl}\n\`\`\``);
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleListRoutines(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = listRoutinesSchema.parse(args ?? {});
    const routines = await client.listRoutines(parsed.database);
    const lines = routines.map(
      (routine) =>
        `${routine.type} ${routine.name} | returns=${routine.returnType ?? '-'} | updated=${routine.updatedAt ?? '-'}`,
    );
    return toolOk(formatCompactLines(`routines (${routines.length})`, lines));
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleListTriggers(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = listTriggersSchema.parse(args ?? {});
    const triggers = await client.listTriggers(parsed.database, parsed.table);
    const lines = triggers.map(
      (trigger) =>
        `${trigger.name} | ${trigger.timing} ${trigger.event} ON ${trigger.table}`,
    );
    return toolOk(formatCompactLines(`triggers (${triggers.length})`, lines));
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}

export async function handleListEvents(
  client: MysqlClient,
  args: unknown,
): Promise<ToolResponse> {
  try {
    const parsed = listEventsSchema.parse(args ?? {});
    const events = await client.listEvents(parsed.database);
    const lines = events.map(
      (event) =>
        `${event.name} | ${event.status} | ${event.eventType} | at=${event.executeAt ?? '-'} | every=${event.intervalValue ?? '-'} ${event.intervalField ?? ''}`.trim(),
    );
    return toolOk(formatCompactLines(`events (${events.length})`, lines));
  } catch (error: unknown) {
    return toolErr(sanitizeErrorMessage(error));
  }
}
