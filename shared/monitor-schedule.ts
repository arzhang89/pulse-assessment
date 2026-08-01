/**
 * Bounded initial jitter for next_check_at:
 * now + random(0 .. min(30s, intervalSeconds)).
 * Shared by create, URL change, interval change, and re-enable paths.
 */
export const MAX_INITIAL_JITTER_MS = 30_000

export function computeNextCheckAt(
  intervalSeconds: number,
  from: Date = new Date(),
  random: () => number = Math.random,
): Date {
  const maxJitterMs = Math.min(MAX_INITIAL_JITTER_MS, Math.max(0, intervalSeconds) * 1000)
  const jitterMs = Math.floor(random() * (maxJitterMs + 1))
  return new Date(from.getTime() + jitterMs)
}
