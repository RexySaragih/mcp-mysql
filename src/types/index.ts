export type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type MysqlRow = Record<string, unknown>;

export interface QueryResult {
  rows: MysqlRow[];
  fields: string[];
  durationMs: number;
  truncated: boolean;
}

export interface TableSummary {
  database: string;
  name: string;
  type: string;
  engine: string | null;
  rowsApprox: number | null;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  key: string;
  defaultValue: string | null;
  extra: string;
}

export interface IndexInfo {
  name: string;
  column: string;
  nonUnique: boolean;
  seq: number;
  type: string;
}

export interface ForeignKeyInfo {
  constraintName: string;
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  updateRule: string;
  deleteRule: string;
}

export interface RoutineInfo {
  name: string;
  type: string;
  returnType: string | null;
  definition: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TriggerInfo {
  name: string;
  event: string;
  table: string;
  timing: string;
  statement: string;
}

export interface EventInfo {
  name: string;
  status: string;
  eventType: string;
  executeAt: string | null;
  intervalValue: string | null;
  intervalField: string | null;
  definition: string | null;
}
