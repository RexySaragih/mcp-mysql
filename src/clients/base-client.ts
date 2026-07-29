const ERROR_BODY_MAX = 300;

const DEFAULT_TIMEOUT_MS = 30_000;

export const ClientConstants = {
  DEFAULT_TIMEOUT_MS,
  ERROR_BODY_MAX,
  HARD_MAX_ROWS: 500,
  DEFAULT_MAX_ROWS: 100,
  CELL_TRUNCATE: 500,
} as const;

export function sanitizeUpstreamBody(body: string): string {
  return body
    .replace(/mysql:\/\/[^@\s]+@/gi, 'mysql://[REDACTED]@')
    .replace(/password["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'password=[REDACTED]')
    .replace(/pwd["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'pwd=[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

export function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return sanitizeUpstreamBody(raw).slice(0, ERROR_BODY_MAX);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
