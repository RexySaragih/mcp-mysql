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

export interface SqlSafetyResult {
  ok: boolean;
  reason?: string;
  normalized: string;
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

/**
 * Allow only a single SELECT / WITH … SELECT statement.
 * EXPLAIN wrappers are validated separately by callers.
 */
export function assertReadOnlySelect(sql: string): SqlSafetyResult {
  const withoutComments = stripSqlComments(sql).trim();
  if (!withoutComments) {
    return { ok: false, reason: 'Empty SQL', normalized: '' };
  }

  if (hasMultipleStatements(withoutComments)) {
    return {
      ok: false,
      reason: 'Multiple statements are not allowed',
      normalized: withoutComments,
    };
  }

  if (hasForbiddenFileIo(withoutComments)) {
    return {
      ok: false,
      reason: 'File I/O SQL constructs are not allowed',
      normalized: withoutComments,
    };
  }

  const keyword = leadingKeyword(withoutComments);
  if (keyword !== 'SELECT' && keyword !== 'WITH') {
    if ((MUTATING_PREFIXES as readonly string[]).includes(keyword)) {
      return {
        ok: false,
        reason: `Rejected ${keyword} — this server is read-only (SELECT / WITH only)`,
        normalized: withoutComments,
      };
    }
    return {
      ok: false,
      reason: `Unsupported statement type "${keyword || 'UNKNOWN'}" — only SELECT or WITH`,
      normalized: withoutComments,
    };
  }

  // WITH must eventually select; reject WITH … INSERT etc. via substring scan
  if (keyword === 'WITH') {
    const upper = withoutComments.toUpperCase();
    for (const bad of MUTATING_PREFIXES) {
      const re = new RegExp(`\\b${bad}\\b`);
      if (re.test(upper)) {
        return {
          ok: false,
          reason: `CTE contains forbidden keyword ${bad}`,
          normalized: withoutComments,
        };
      }
    }
    if (!/\bSELECT\b/.test(upper)) {
      return {
        ok: false,
        reason: 'WITH clause must include SELECT',
        normalized: withoutComments,
      };
    }
  }

  return { ok: true, normalized: withoutComments };
}

export function assertExplainableSelect(sql: string): SqlSafetyResult {
  return assertReadOnlySelect(sql);
}
