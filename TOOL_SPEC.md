# TOOL_SPEC — mysql-mcp

## Goal
Let agents inspect MySQL/MariaDB schema, run SELECT queries, and perform **confirmation-gated** writes/DDL/transactions via separate tools.

## Non-goals
- Mixing DML into `read_query`
- MCP Resources / Prompts
- Aurora IAM / RDS Data API

## v1 posture
- [x] reads
- [x] writes included (separate `write_query` — strong confirmation)
- [x] destructive included (separate `schema_query` / `transaction_query` — strong confirmation)

## Tools (writes kept separate)
| Name | Notes |
|------|-------|
| … schema inspect tools … | read-only |
| `read_query` | SELECT only; locks need confirm |
| `write_query` | INSERT/UPDATE/DELETE/REPLACE/TRUNCATE — **confirmed:true** |
| `schema_query` | CREATE/ALTER/DROP/RENAME — **confirmed:true** |
| `transaction_query` | multi-statement — per-stmt preview + **confirmed:true** |
| `explain_query` | EXPLAIN |

## Security notes
- Strong confirmation copy explains impact and requires explicit `confirmed: true`
- Prefer least-privilege DB user; use a write-capable role only when needed

## Research summary
- API docs: https://dev.mysql.com/doc/refman/8.4/en/ + https://github.com/sidorares/node-mysql2
- Auth model: MySQL user/password (or URL) via process env — prefer a SELECT-only DB user
- SDK choice: `mysql2` promise API (also works with MariaDB wire protocol)
- Existing MCP: AWS Labs Aurora MySQL MCP (IAM/Data API) — this server targets generic MySQL/MariaDB over the wire
- Language: TypeScript | Transport: stdio
- MCP SDK: `@modelcontextprotocol/sdk@1.30.0`
- Residual risks: prompt injection via row data; confirmed writes are permanent; transaction blast radius
- Prefer SELECT-only user for read agents; write-capable role when using write/schema/transaction tools

## Identity & credentials
| Env var | Required | Purpose |
|---------|----------|---------|
| `MYSQL_URL` | no* | Full URL `mysql://user:pass@host:3306/db` (*either URL **or** discrete vars) |
| `MYSQL_HOST` | no | Host (default `127.0.0.1`) |
| `MYSQL_PORT` | no | Port (default `3306`) |
| `MYSQL_USER` | yes* | Username (*required unless in URL) |
| `MYSQL_PASSWORD` | no | Password |
| `MYSQL_DATABASE` | no | Default schema (also parsed from URL path) |
| `MYSQL_SSL` | no | `true` to enable TLS |
| `MYSQL_SSL_CA` / `MYSQL_SSL_CERT` / `MYSQL_SSL_KEY` | no | PEM paths for TLS |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | no | Default `true` |
| `MYSQL_QUERY_TIMEOUT_MS` | no | Default `30000` |
| `MYSQL_MAX_ROWS` | no | Soft cap (default `100`, hard max `500`) |

**Secret location:** user agent mcp.json `env` (not project `.env`).

## v1 posture
- [x] read-only
- [ ] writes included
- [ ] destructive included

## Tools

| Name | Job | Annotations (R/D/I/O) | Output |
|------|-----|----------------------|--------|
| `list_databases` | List schemas | T/F/T/T | compact |
| `list_tables` | List tables/views | T/F/T/T | compact |
| `describe_table` | Columns | T/F/T/T | markdown |
| `show_create_table` | SHOW CREATE TABLE/VIEW | T/F/T/T | markdown+sql |
| `list_indexes` | Indexes | T/F/T/T | compact |
| `list_foreign_keys` | FKs | T/F/T/T | compact |
| `list_routines` | Procedures/functions | T/F/T/T | compact |
| `list_triggers` | Triggers | T/F/T/T | compact |
| `list_events` | Events | T/F/T/T | compact |
| `read_query` | SELECT/WITH; locks need `confirmed` | T/F/T/T | markdown / confirmation |
| `explain_query` | EXPLAIN | T/F/T/T | markdown |

### Tool detail — `read_query`
- Required: `sql`
- Optional: `max_rows`, `confirmed`
- Soft risks (need `confirmed: true`): `FOR UPDATE`, `FOR SHARE`, `LOCK IN SHARE MODE`, `INTO @var`
- Hard reject: mutating SQL, multi-statement, `INTO OUTFILE` / `DUMPFILE` / `LOAD_FILE`
- Row cap: server-side `LIMIT` injection/clamp before execute

## Deferred (v2)
| Item | Why deferred |
|------|----------------|
| Write / DDL tools | read-only v1 |
| Aurora IAM / RDS Data API | Different auth/transport; use AWS Labs MCP |
| Stored procedure CALL | mutation risk |

## Security notes
- Treat cell values as untrusted text
- Prefer SELECT-only MySQL/MariaDB user
- Confirmation gate explains lock / session-variable impact before execute

## Verification
- [x] unit tests
- [x] test-connections script
- [x] annotations
- [x] `mcp-maker qc`
