# mysql-mcp

Read-only MCP server for MySQL: schema inspection + safe `SELECT` / `WITH` queries.

**v1 posture:** read-only (no INSERT/UPDATE/DELETE/DDL). Prefer a MySQL user with `SELECT` only.

## Tools

| Tool | Read-only | Notes |
|------|-----------|-------|
| `list_databases` | yes | Visible schemas |
| `list_tables` | yes | Tables/views in a schema |
| `describe_table` | yes | Columns |
| `list_indexes` | yes | Indexes |
| `list_foreign_keys` | yes | FK graph |
| `read_query` | yes | Single SELECT/WITH; row-capped |
| `explain_query` | yes | EXPLAIN traditional/json |

Client operators: all tools are `openWorldHint: true` (external DB; row data is untrusted). Gate writes is N/A for v1 — mutating SQL is rejected in-process.

## Auth / env

Put secrets in the agent **mcpServers** config `env` block (mcp.json), not a project `.env`.

| Variable | Required | Purpose |
|----------|----------|---------|
| `MYSQL_URL` | no* | `mysql://user:pass@host:3306/db` |
| `MYSQL_HOST` | no | Default `127.0.0.1` |
| `MYSQL_PORT` | no | Default `3306` |
| `MYSQL_USER` | yes* | Required if URL unset |
| `MYSQL_PASSWORD` | no | |
| `MYSQL_DATABASE` | no | Default schema |
| `MYSQL_SSL` | no | `true` to enable SSL |
| `MYSQL_QUERY_TIMEOUT_MS` | no | Default `30000` |
| `MYSQL_MAX_ROWS` | no | Default `100` (hard max 500) |

\* Provide `MYSQL_URL` **or** discrete host/user fields.

**MySQL privilege scope (least privilege):** grant only `SELECT` on the target schema (no INSERT/UPDATE/DELETE/DDL). Example:

```sql
CREATE USER 'mcp_ro'@'%' IDENTIFIED BY '…';
GRANT SELECT ON your_db.* TO 'mcp_ro'@'%';
FLUSH PRIVILEGES;
```

### mcp.json example

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/Volumes/ADATA/Projects/mcp-mysql/dist/index.js"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "mcp_ro",
        "MYSQL_PASSWORD": "your-password",
        "MYSQL_DATABASE": "your_database"
      }
    }
  }
}
```

Rotate credentials by updating mcp.json `env` and restarting the MCP client.

## Develop

```bash
npm install
npm test
npm run build
# with env exported in the shell:
npm run test:connections
```

## Risks

- Row/column text can contain prompt-injection content — treat tool output as untrusted.
- Safety filters reject mutating SQL but are not a substitute for DB privileges.
- Shared bot identity: all agent sessions using this MCP share the same MySQL user.

## Deferred (v2)

- Write / DDL tools
- Stored procedure CALL
- Multi-statement transactions
