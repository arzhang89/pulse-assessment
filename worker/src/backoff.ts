/**
 * Capped exponential backoff with small random jitter for database errors.
 * Attempt 0 → baseMs; then doubles until maxMs. Jitter is ±10% of the delay.
 */
export function databaseErrorBackoffMs(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const baseMs = options.baseMs ?? 250
  const maxMs = options.maxMs ?? 30_000
  const random = options.random ?? Math.random

  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  const jitter = exp * 0.1 * (random() * 2 - 1)
  return Math.max(0, Math.round(exp + jitter))
}
