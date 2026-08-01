/**
 * Approved post-check cadence:
 * candidate = scheduledFor + interval
 * nextCheckAt = candidate > finishedAt ? candidate : finishedAt + interval
 */
export function computeNextCheckAfterResult(
  scheduledFor: Date,
  intervalSeconds: number,
  finishedAt: Date,
): Date {
  const intervalMs = intervalSeconds * 1_000
  const candidate = new Date(scheduledFor.getTime() + intervalMs)
  if (candidate.getTime() > finishedAt.getTime()) {
    return candidate
  }
  return new Date(finishedAt.getTime() + intervalMs)
}
