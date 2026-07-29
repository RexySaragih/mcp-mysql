# mysql-mcp

MCP server for **MySQL and MariaDB**: schema inspection, SELECT, and **separate confirmation-gated** write/DDL/transaction tools.

Works over the MySQL wire protocol (MySQL 5.7+/8+ and MariaDB). For **Aurora IAM** or **RDS Data API**, use AWS Labs’ MySQL MCP instead.

Secrets belong in agent **mcp.json `env`** (mcpServers.*.env) — **not project `.env`**. Do not create a project `.env` for runtime credentials.

## Tools

| Tool | Notes |
|------|-------|
| `list_databases` / `list_tables` / `describe_table` / `show_create_table` | Schema inspect |
| `list_indexes` / `list_foreign_keys` / `list_routines` / `list_triggers` / `list_events` | Schema inspect |
| `read_query` | SELECT only; locks/`INTO @var` need `confirmed` |
| `write_query` | INSERT/UPDATE/DELETE/REPLACE/TRUNCATE — **strong confirm** |
| `schema_query` | CREATE/ALTER/DROP/RENAME — **strong confirm** |
| `transaction_query` | Multi-statement txn — per-stmt preview + **strong confirm** |
| `explain_query` | EXPLAIN |

Writes are **separate tools** from reads. Agents must not use `read_query` for DML/DDL.

### Strong confirmation

MCP has no native UI modal. Mutating tools return an impact preview and **do not execute** until called again with the same `sql` and `confirmed: true`.

Client operators should require approval on `write_query`, `schema_query`, and `transaction_query` (`destructiveHint` / non-readOnly).

## Auth / env

| Variable | Required | Purpose |
|----------|----------|---------|
| `MYSQL_URL` | no* | `mysql://user:pass@host:3306/db` |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | * | Discrete connection |
| `MYSQL_SSL` (+ CA/CERT/KEY) | no | TLS |
| `MYSQL_QUERY_TIMEOUT_MS` / `MYSQL_MAX_ROWS` | no | Caps |

**Privilege scope:** prefer least privilege. Use a write-capable role only when write tools are needed.

### mcp.json example

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/Volumes/ADATA/Projects/mcp-mysql/dist/index.js"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_USER": "mcp_rw",
        "MYSQL_PASSWORD": "your-password",
        "MYSQL_DATABASE": "your_database"
      }
    }
  }
}
```

## Develop

```bash
npm test && npm run build
# Smoke (pass env inline — never create a repo .env):
# MYSQL_HOST=… MYSQL_USER=… MYSQL_PASSWORD=… MYSQL_DATABASE=… npm run test:connections
```

## Risks

- Row content is untrusted (prompt injection)
- Confirmed writes are permanent without DB-level undo
- Shared bot identity; `transaction_query` has large blast radius after confirm
