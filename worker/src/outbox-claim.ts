import type { Pool } from 'pg'
import { claimCapacity } from './claim.js'

export type ClaimedOutboxEvent = {
  id: string
  incidentId: string
  destinationUrl: string
  eventType: 'DOWN' | 'RECOVERED'
  payload: unknown
  status: 'PENDING'
  attempts: number
  availableAt: Date
  leaseOwner: string
  leaseExpiresAt: Date
}

export type ClaimOutboxParams = {
  pool: Pool
  workerId: string
  leaseSeconds: number
  limit: number
  now?: Date
}

export function notificationWorkerId(mainWorkerId: string): string {
  return `${mainWorkerId}:notify`
}

export { claimCapacity as notificationClaimCapacity }

/**
 * Atomically claims pending outbox rows with FOR UPDATE SKIP LOCKED.
 * No network I/O inside the claim transaction (single statement).
 */
export async function claimPendingOutbox(params: ClaimOutboxParams): Promise<ClaimedOutboxEvent[]> {
  const { pool, workerId, leaseSeconds, limit } = params
  if (limit <= 0) {
    return []
  }

  const now = params.now ?? new Date()

  const result = await pool.query<{
    id: string
    incident_id: string
    destination_url: string
    event_type: 'DOWN' | 'RECOVERED'
    payload: unknown
    status: 'PENDING'
    attempts: number
    available_at: Date
    lease_owner: string
    lease_expires_at: Date
  }>(
    `
    WITH due AS (
      SELECT id
      FROM notification_outbox
      WHERE status = 'PENDING'
        AND available_at <= $1
        AND (
          lease_owner IS NULL
          OR lease_expires_at IS NULL
          OR lease_expires_at <= $1
        )
      ORDER BY available_at ASC, id ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_outbox AS o
    SET
      lease_owner = $3,
      lease_expires_at = $1 + make_interval(secs => $4)
    FROM due
    WHERE o.id = due.id
    RETURNING
      o.id,
      o.incident_id,
      o.destination_url,
      o.event_type,
      o.payload,
      o.status,
      o.attempts,
      o.available_at,
      o.lease_owner,
      o.lease_expires_at
    `,
    [now, limit, workerId, leaseSeconds],
  )

  return result.rows.map((row) => ({
    id: row.id,
    incidentId: row.incident_id,
    destinationUrl: row.destination_url,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
  }))
}
