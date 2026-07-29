const MUTATING_PREFIXES = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'MERGE',
  'TRUNCATE',
  'ALTER',
  'DROP',
  'CREATE',
  'RENAME',
  'GRANT',
  'REVOKE',
  'FLUSH',
  'LOAD',
  'CALL',
  'DO',
  'HANDLER',
  'LOCK',
  'UNLOCK',
  'SET',
  'START',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'PREPARE',
  'EXECUTE',
  'DEALLOCATE',
  'USE',
  'ANALYZE',
  'OPTIMIZE',
  'REPAIR',
  'CHECK',
  'CHECKSUM',
  'BACKUP',
  'RESTORE',
  'PURGE',
  'RESET',
  'CHANGE',
  'STOP',
  'SHUTDOWN',
  'KILL',
  'INSTALL',
  'UNINSTALL',
  'BINLOG',
] as const;

export type SqlRiskKind =
  | 'for_update'
  | 'for_share'
  | 'lock_in_share_mode'
  | 'into_variable'
  | 'into_outfile';

export interface SqlRiskFlag {
  kind: SqlRiskKind;
  summary: string;
  whatHappens: string;
}

export interface SqlSafetyResult {
  ok: boolean;
  reason?: string;
  normalized: string;
  /** Soft risks — allowed after confirmed: true */
  risks: SqlRiskFlag[];
  needsConfirmation: boolean;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ');
}

function hasMultipleStatements(sql: string): boolean {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  return trimmed.includes(';');
}

function hasForbiddenFileIo(sql: string): boolean {
  const upper = sql.toUpperCase();
  return (
    upper.includes('INTO OUTFILE') ||
    upper.includes('INTO DUMPFILE') ||
    upper.includes('LOAD_FILE(')
  );
}

function leadingKeyword(sql: string): string {
  const match = sql.trim().match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : '';
}

function detectSoftRisks(sql: string): SqlRiskFlag[] {
  const upper = sql.toUpperCase();
  const risks: SqlRiskFlag[] = [];

  if (/\bFOR\s+UPDATE\b/.test(upper)) {
    risks.push({
      kind: 'for_update',
      summary: 'Row locks (FOR UPDATE)',
      whatHappens:
        'MySQL will take exclusive locks on matching rows for the duration of this statement (autocommit). Concurrent writers updating those rows may block briefly until the query finishes. No data is modified, but lock contention is possible.',
    });
  }

  if (/\bFOR\s+SHARE\b/.test(upper)) {
    risks.push({
      kind: 'for_share',
      summary: 'Shared locks (FOR SHARE)',
      whatHappens:
        'MySQL will take shared locks on matching rows. Writers that need exclusive locks on those rows may wait until this query completes.',
    });
  }

  if (/\bLOCK\s+IN\s+SHARE\s+MODE\b/.test(upper)) {
    risks.push({
      kind: 'lock_in_share_mode',
      summary: 'Shared locks (LOCK IN SHARE MODE)',
      whatHappens:
        'Legacy shared-lock syntax. Matching rows are share-locked until the statement ends; conflicting writers may block briefly.',
    });
  }

  // SELECT ... INTO @var (not OUTFILE — that is hard-rejected)
  if (/\bINTO\s+@/.test(upper)) {
    risks.push({
      kind: 'into_variable',
      summary: 'Session variables (INTO @var)',
      whatHappens:
        'This assigns values into connection user-variables. With a connection pool, those variables may not be visible on later tool calls (different connection). Prefer returning columns in the result set instead.',
    });
  }

  return risks;
}

/**
 * Allow only a single SELECT / WITH … SELECT statement.
 * Mutating SQL + file I/O are rejected.
 * Lock / INTO @var patterns need confirmation (not hard-rejected).
 */
export function assertReadOnlySelect(sql: string): SqlSafetyResult {
  const withoutComments = stripSqlComments(sql).trim();
  if (!withoutComments) {
    return {
      ok: false,
      reason: 'Empty SQL',
      normalized: '',
      risks: [],
      needsConfirmation: false,
    };
  }

  if (hasMultipleStatements(withoutComments)) {
    return {
      ok: false,
      reason: 'Multiple statements are not allowed',
      normalized: withoutComments,
      risks: [],
      needsConfirmation: false,
    };
  }

  if (hasForbiddenFileIo(withoutComments)) {
    return {
      ok: false,
      reason:
        'File I/O SQL constructs (INTO OUTFILE / DUMPFILE / LOAD_FILE) are not allowed',
      normalized: withoutComments,
      risks: [],
      needsConfirmation: false,
    };
  }

  const keyword = leadingKeyword(withoutComments);
  if (keyword !== 'SELECT' && keyword !== 'WITH') {
    if ((MUTATING_PREFIXES as readonly string[]).includes(keyword)) {
      return {
        ok: false,
        reason: `Rejected ${keyword} — this server is read-only (SELECT / WITH only)`,
        normalized: withoutComments,
        risks: [],
        needsConfirmation: false,
      };
    }
    return {
      ok: false,
      reason: `Unsupported statement type "${keyword || 'UNKNOWN'}" — only SELECT or WITH`,
      normalized: withoutComments,
      risks: [],
      needsConfirmation: false,
    };
  }

  if (keyword === 'WITH') {
    const upper = withoutComments.toUpperCase();
    for (const bad of MUTATING_PREFIXES) {
      const re = new RegExp(`\\b${bad}\\b`);
      if (re.test(upper)) {
        return {
          ok: false,
          reason: `CTE contains forbidden keyword ${bad}`,
          normalized: withoutComments,
          risks: [],
          needsConfirmation: false,
        };
      }
    }
    if (!/\bSELECT\b/.test(upper)) {
      return {
        ok: false,
        reason: 'WITH clause must include SELECT',
        normalized: withoutComments,
        risks: [],
        needsConfirmation: false,
      };
    }
  }

  const risks = detectSoftRisks(withoutComments);
  return {
    ok: true,
    normalized: withoutComments,
    risks,
    needsConfirmation: risks.length > 0,
  };
}

export function assertExplainableSelect(sql: string): SqlSafetyResult {
  return assertReadOnlySelect(sql);
}

export function formatConfirmationPrompt(
  analysis: SqlSafetyResult,
  sql: string,
): string {
  const lines: string[] = [
    '## Confirmation required',
    '',
    'This SELECT is allowed but has side effects beyond a plain read. Nothing has been executed yet.',
    '',
    '### What will happen if you approve',
  ];

  for (const risk of analysis.risks) {
    lines.push(`- **${risk.summary}:** ${risk.whatHappens}`);
  }

  lines.push(
    '',
    '### Query',
    '```sql',
    sql,
    '```',
    '',
    '### How to approve',
    'Call `read_query` again with the **same `sql`** and set `confirmed: true`.',
    '',
    'If you did not intend locking or session variables, rewrite the query as a plain SELECT without `FOR UPDATE` / `FOR SHARE` / `LOCK IN SHARE MODE` / `INTO @var`.',
  );

  return lines.join('\n');
}
