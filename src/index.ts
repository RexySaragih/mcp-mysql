#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { MysqlClient } from './clients/mysql-client.js';
import type { ToolResponse } from './types/index.js';
import {
  describeTableTool,
  handleDescribeTable,
  handleListDatabases,
  handleListEvents,
  handleListForeignKeys,
  handleListIndexes,
  handleListRoutines,
  handleListTables,
  handleListTriggers,
  handleShowCreateTable,
  listDatabasesTool,
  listEventsTool,
  listForeignKeysTool,
  listIndexesTool,
  listRoutinesTool,
  listTablesTool,
  listTriggersTool,
  showCreateTableTool,
} from './tools/schema.js';
import {
  explainQueryTool,
  handleExplainQuery,
  handleReadQuery,
  readQueryTool,
} from './tools/query.js';

const SERVER_NAME = 'mysql-mcp';
const SERVER_VERSION = '1.1.0';

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

function logTool(
  tool: string,
  status: 'ok' | 'error',
  durationMs: number,
): void {
  console.error(
    `[mcp=${SERVER_NAME} tool=${tool} status=${status} duration_ms=${durationMs}]`,
  );
}

async function start(): Promise<void> {
  const client = new MysqlClient();

  const tools = [
    listDatabasesTool,
    listTablesTool,
    describeTableTool,
    showCreateTableTool,
    listIndexesTool,
    listForeignKeysTool,
    listRoutinesTool,
    listTriggersTool,
    listEventsTool,
    readQueryTool,
    explainQueryTool,
  ];

  const toolHandlers: Record<
    string,
    (args: unknown) => Promise<ToolResponse>
  > = {
    list_databases: (args) => handleListDatabases(client, args),
    list_tables: (args) => handleListTables(client, args),
    describe_table: (args) => handleDescribeTable(client, args),
    show_create_table: (args) => handleShowCreateTable(client, args),
    list_indexes: (args) => handleListIndexes(client, args),
    list_foreign_keys: (args) => handleListForeignKeys(client, args),
    list_routines: (args) => handleListRoutines(client, args),
    list_triggers: (args) => handleListTriggers(client, args),
    list_events: (args) => handleListEvents(client, args),
    read_query: (args) => handleReadQuery(client, args),
    explain_query: (args) => handleExplainQuery(client, args),
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolHandlers[name];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    const started = Date.now();
    try {
      const result = await handler(args ?? {});
      logTool(name, result.isError ? 'error' : 'ok', Date.now() - started);
      return result;
    } catch (error: unknown) {
      logTool(name, 'error', Date.now() - started);
      if (error instanceof McpError) throw error;
      const message =
        error instanceof Error ? error.message : 'Unknown tool error';
      throw new McpError(ErrorCode.InternalError, message);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} ${SERVER_VERSION} running on stdio`);

  const shutdown = async (): Promise<void> => {
    await client.close();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

start().catch((error: unknown) => {
  console.error('Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
