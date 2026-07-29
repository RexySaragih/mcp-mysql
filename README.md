# mysql-mcp

Read-only MCP server for **MySQL and MariaDB**: schema inspection + safe `SELECT` / `WITH` queries.

**v1 posture:** read-only (no INSERT/UPDATE/DELETE/DDL). Prefer a DB user with `SELECT` only.

Works over the MySQL wire protocol (MySQL 5.7+/8+ and MariaDB). For **Aurora IAM** or **RDS Data API**, use AWS Labs’ MySQL MCP instead.

## Tools

| Tool | Notes |
|------|-------|
| `list_databases` | Visible schemas |
| `list_tables` | Tables/views |
| `describe_table` | Columns |
| `show_create_table` | Full CREATE DDL |
| `list_indexes` | Indexes |
| `list_foreign_keys` | FK graph |
| `list_routines` | Procedures/functions |
| `list_triggers` | Triggers |
| `list_events` | Scheduled events |
| `read_query` | SELECT/WITH; LIMIT-capped; locks/`INTO @var` need confirmation |
| `explain_query` | EXPLAIN traditional/json |

### Confirmation (locks / session vars)

MCP has no native UI modal. For `FOR UPDATE` / `FOR SHARE` / `LOCK IN SHARE MODE` / `INTO @var`, `read_query` returns a **confirmation preview** explaining impact and does **not** run the SQL. Re-call with the same `sql` and `confirmed: true` to approve.

Client operators: tools are `openWorldHint: true` (external DB; row data untrusted).

## Auth / env

Put secrets in the agent **mcpServers** config `env` block (mcp.json), not a project `.env`.

| Variable | Required | Purpose |
|----------|----------|---------|
| `MYSQL_URL` | no* | `mysql://user:pass@host:3306/db` (DB path = default schema) |
| `MYSQL_HOST` | no | Default `127.0.0.1` |
| `MYSQL_PORT` | no | Default `3306` |
| `MYSQL_USER` | yes* | Required if URL unset |
| `MYSQL_PASSWORD` | no | |
| `MYSQL_DATABASE` | no | Default schema |
| `MYSQL_SSL` | no | `true` to enable TLS |
| `MYSQL_SSL_CA` / `CERT` / `KEY` | no | PEM paths |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | no | Default `true` |
| `MYSQL_QUERY_TIMEOUT_MS` | no | Default `30000` |
| `MYSQL_MAX_ROWS` | no | Default `100` (hard max 500) |

\* Provide `MYSQL_URL` **or** discrete host/user fields.

**MySQL privilege scope (least privilege):** grant only `SELECT` on the target schema.

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
- Confirmed lock queries can briefly block writers.
- Shared bot identity across agent sessions.

## Deferred (v2)

- Write / DDL tools
- Aurora IAM / RDS Data API
- Stored procedure CALL
