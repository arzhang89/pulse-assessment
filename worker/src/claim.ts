import type { Pool } from 'pg'

export type ClaimedMonitor = {
  id: string
  userId: string
  name: string
  url: string
  intervalSeconds: number
  timeoutMs: number
  status: 'UNKNOWN' | 'UP' | 'DOWN'
  consecutiveFailures: number
  consecutiveSuccesses: number
  /** Original next_check_at at claim time; used as scheduled_for and stale guard. */
  scheduledFor: Date
  leaseOwner: string
  leaseExpiresAt: Date
}

export type ClaimMonitorsParams = {
  pool: Pool
  workerId: string
  leaseSeconds: number
  /** Maximum rows to claim this tick (typically free concurrency slots). */
  limit: number
  now?: Date
}

/**
 * Atomically claims due monitors with FOR UPDATE SKIP LOCKED.
 *
 * Claimed rows receive lease_owner / lease_expires_at. updated_at is left
 * unchanged. The original next_check_at is returned as scheduledFor and is
 * not advanced until persistence succeeds.
 */
export async function claimDueMonitors(params: ClaimMonitorsParams): Promise<ClaimedMonitor[]> {
  const { pool, workerId, leaseSeconds, limit } = params

  if (limit <= 0) {
    return []
  }

  const now = params.now ?? new Date()

  const result = await pool.query<{
    id: string
    user_id: string
    name: string
    url: string
    interval_seconds: number
    timeout_ms: number
    status: 'UNKNOWN' | 'UP' | 'DOWN'
    consecutive_failures: number
    consecutive_successes: number
    scheduled_for: Date
    lease_owner: string
    lease_expires_at: Date
  }>(
    `
    WITH due AS (
      SELECT id
      FROM monitors
      WHERE enabled = true
        AND next_check_at <= $1
        AND (
          lease_owner IS NULL
          OR lease_expires_at IS NULL
          OR lease_expires_at <= $1
        )
      ORDER BY next_check_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    UPDATE monitors AS m
    SET
      lease_owner = $3,
      lease_expires_at = $1 + make_interval(secs => $4)
    FROM due
    WHERE m.id = due.id
    RETURNING
      m.id,
      m.user_id,
      m.name,
      m.url,
      m.interval_seconds,
      m.timeout_ms,
      m.status,
      m.consecutive_failures,
      m.consecutive_successes,
      m.next_check_at AS scheduled_for,
      m.lease_owner,
      m.lease_expires_at
    `,
    [now, limit, workerId, leaseSeconds],
  )

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    url: row.url,
    intervalSeconds: row.interval_seconds,
    timeoutMs: row.timeout_ms,
    status: row.status,
    consecutiveFailures: row.consecutive_failures,
    consecutiveSuccesses: row.consecutive_successes,
    scheduledFor: row.scheduled_for,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
  }))
}

/**
 * How many new claims fit under the current concurrency budget.
 */
export function claimCapacity(
  concurrency: number,
  activeCount: number,
  pendingCount: number,
): number {
  return Math.max(0, concurrency - activeCount - pendingCount)
}
