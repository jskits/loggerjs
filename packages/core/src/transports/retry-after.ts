// Retry-After support shared by the reliability wrappers and HTTP transports.
// The public helpers are re-exported from transports/reliability; the error
// reader stays internal.

/** Error thrown by HTTP transports for a non-2xx response. */
export interface HttpStatusError extends Error {
  status: number;
  /** Delay the server asked for through Retry-After, in milliseconds. */
  retryAfterMs?: number;
}

/**
 * Parses an HTTP `Retry-After` value, either delay-seconds or an HTTP-date,
 * into milliseconds from `now`. Returns undefined when the value is missing
 * or invalid.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Builds the error an HTTP transport throws for a non-2xx response. It
 * carries `status` and, when the response sends `Retry-After`, `retryAfterMs`,
 * which batchTransport() and retryTransport() honor before the next attempt.
 */
export function httpStatusError(
  transport: string,
  response: { status: number; headers?: { get(name: string): string | null } },
): HttpStatusError {
  const error = new Error(`${transport} failed with status ${response.status}`) as HttpStatusError;
  error.status = response.status;
  const retryAfterMs = parseRetryAfter(response.headers?.get("retry-after"));
  if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs;
  return error;
}

/** Reads a server-requested retry delay from a delivery error, if any. */
export function retryAfterFromError(error: unknown): number | undefined {
  const value = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
