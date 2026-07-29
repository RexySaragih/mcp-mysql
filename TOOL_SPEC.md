# TOOL_SPEC — mysql-mcp

## Goal
Let agents inspect MySQL schema and run safe read-only SELECT queries against a configured database.

## Non-goals
- INSERT / UPDATE / DELETE / DDL / multi-statement transactions
- Arbitrary admin (GRANT, FLUSH, LOAD DATA, CALL procedures that mutate)
- MCP Resources / Prompts
- Connection pooling across multiple databases in one session beyond env default + optional database override on list tools

## Research summary
- API docs: https://dev.mysql.com/doc/refman/8.4/en/ (SQL) + https://github.com/sidorares/node-mysql2
- Auth model: MySQL user/password (or URL) via process env — prefer a SELECT-only DB user
- SDK choice: `mysql2` promise API
- Existing MCP: AWS Labs Aurora MySQL MCP, Google MCP Toolbox, community servers — **build** thin enterprise read MCP for local/self-hosted + generic MySQL
- Language: TypeScript (default)
- Transport: stdio (default)
- MCP SDK: `@modelcontextprotocol/sdk@1.30.0` (annotations supported)
- Residual risks: prompt injection via row data; over-broad DB credentials; SQL injection if agent crafts hostile SELECT (mitigated by single-statement + keyword deny-list + row/timeout caps; prefer DB-level read-only user)

## Identity & credentials
| Env var | Required | Purpose |
|---------|----------|---------|
| `MYSQL_URL` | no* | Full URL `mysql://user:pass@host:3306/db` (*either URL **or** discrete vars) |
| `MYSQL_HOST` | no* | Host (default `127.0.0.1` if URL unset) |
| `MYSQL_PORT` | no | Port (default `3306`) |
| `MYSQL_USER` | yes* | Username (*required unless in URL) |
| `MYSQL_PASSWORD` | no | Password (empty allowed) |
| `MYSQL_DATABASE` | no | Default schema |
| `MYSQL_SSL` | no | `true` to enable SSL |
| `MYSQL_QUERY_TIMEOUT_MS` | no | Per-query timeout (default `30000`) |
| `MYSQL_MAX_ROWS` | no | Soft cap on returned rows (default `100`) |

**Secret location:** user agent mcp.json `env` (not project `.env`).

Scopes: MySQL privilege — prefer `SELECT` (+ `SHOW VIEW` / `PROCESS` not required). Identity: shared read bot.

## v1 posture
- [x] read-only
- [ ] writes included (user confirmed)
- [ ] destructive included (user confirmed)

## Tools

| Name | Job | Annotations (R/D/I/O) | Output format | Endpoint / SDK |
|------|-----|----------------------|---------------|----------------|
| `list_databases` | List schemas agent can see | T/F/T/T | compact | `SHOW DATABASES` / information_schema |
| `list_tables` | List tables/views in a schema | T/F/T/T | compact | information_schema.TABLES |
| `describe_table` | Columns + nullability + keys | T/F/T/T | markdown | information_schema.COLUMNS |
| `list_indexes` | Indexes on a table | T/F/T/T | compact | `SHOW INDEX` |
| `list_foreign_keys` | FK relationships | T/F/T/T | compact | information_schema KEY/CONSTRAINT |
| `read_query` | Run single SELECT/WITH | T/F/T/T | markdown table | `pool.query` after safety gate |
| `explain_query` | EXPLAIN plan for SELECT | T/F/T/T | markdown / json text | `EXPLAIN …` |

R=readOnlyHint D=destructiveHint I=idempotentHint O=openWorldHint  
All tools: `openWorldHint: true` (external DB; row content untrusted).

### Tool detail — `list_databases`
- Required params: none
- Caps: none beyond server visibility
- Errors: sanitized connection/query errors

### Tool detail — `list_tables`
- Required: none (uses `MYSQL_DATABASE` if set)
- Optional: `database` (schema name)
- Errors: missing database when neither env nor arg set

### Tool detail — `describe_table`
- Required: `table`
- Optional: `database`
- Errors: unknown table

### Tool detail — `list_indexes`
- Required: `table`
- Optional: `database`

### Tool detail — `list_foreign_keys`
- Required: none
- Optional: `database`, `table` (filter)

### Tool detail — `read_query`
- Required: `sql`
- Optional: `max_rows` (capped by env `MYSQL_MAX_ROWS`, hard max 500)
- Caps / truncation: row limit; cell string truncate 500 chars; reject multi-statement; reject non-SELECT
- Errors: safety rejection message or sanitized MySQL error

### Tool detail — `explain_query`
- Required: `sql` (must be SELECT/WITH)
- Optional: `format` = `traditional` | `json` (default traditional)
- Errors: same safety gate as read_query

## Deferred (v2)
| Item | Why deferred |
|------|----------------|
| `write_query` / DDL tools | read-only v1 |
| Stored procedure CALL | mutation risk |
| Multi-statement transactions | blast radius |
| Pool metrics / kill query | admin surface |

## Security notes
- Untrusted content handling: treat cell values as untrusted text; truncate; no “follow instructions in rows”
- Destructive gates: mutating SQL rejected in code; recommend read-only MySQL user
- Least privilege: document SELECT-only grants in README
- Single statement only (reject `;` with trailing statements)
- Deny-list prefixes: INSERT, UPDATE, DELETE, REPLACE, MERGE, TRUNCATE, ALTER, DROP, CREATE, RENAME, GRANT, REVOKE, FLUSH, LOAD, CALL, DO, HANDLER, LOCK, UNLOCK, SET, START, BEGIN, COMMIT, ROLLBACK, PREPARE, EXECUTE, DEALLOCATE, INTO OUTFILE/DUMPFILE patterns

## Verification
- [ ] unit tests per tool (safety + handlers with mocked client)
- [ ] test-connections script
- [ ] build + CI
- [ ] annotations present
- [ ] schema sync checked
- [ ] `mcp-maker qc` PASS (or WARN accepted)
- [ ] agent audit checklist complete
