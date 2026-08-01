import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  applyCheckResult,
  CheckOutcome,
  TransitionAction,
  type MonitorStatus,
} from '../../shared/monitor-status.js'
import { computeNextCheckAfterResult } from '../../shared/monitor-cadence.js'
import type { ClaimedMonitor } from './claim.js'
import type { HttpCheckResult } from './checker/types.js'

export type PersistOutcome =
  | { kind: 'applied'; checkResultId: number }
  | { kind: 'duplicate' }
  | { kind: 'stale' }
  | { kind: 'missing' }

export type PersistLogger = {
  info: (msg: string, meta?: Record<string, unknown>) => void
  warn: (msg: string, meta?: Record<string, unknown>) => void
  error: (msg: string, meta?: Record<string, unknown>) => void
}

export type PersistCheckResultParams = {
  pool: Pool
  workerId: string
  claimed: ClaimedMonitor
  check: HttpCheckResult
  finishedAt?: Date
  logger?: PersistLogger
}

type LockedMonitor = {
  id: string
  user_id: string
  name: string
  interval_seconds: number
  status: MonitorStatus
  consecutive_failures: number
  consecutive_successes: number
  next_check_at: Date
  lease_owner: string | null
  enabled: boolean
}

async function clearLeaseIfOwned(
  client: PoolClient,
  monitorId: string,
  workerId: string,
): Promise<void> {
  await client.query(
    `
    UPDATE monitors
    SET lease_owner = NULL,
        lease_expires_at = NULL
    WHERE id = $1
      AND lease_owner = $2
    `,
    [monitorId, workerId],
  )
}

type OutboxPayload = {
  version: 1
  eventId: string
  eventType: 'DOWN' | 'RECOVERED'
  incidentId: string
  monitorId: string
  monitorName: string
  status: 'DOWN' | 'UP'
  occurredAt: string
}

async function insertOutboxEvent(
  client: PoolClient,
  args: {
    incidentId: string
    userId: string
    monitorId: string
    monitorName: string
    eventType: 'DOWN' | 'RECOVERED'
    status: 'DOWN' | 'UP'
    occurredAt: Date
  },
): Promise<void> {
  const settings = await client.query<{ webhook_url: string; enabled: boolean }>(
    `
    SELECT webhook_url, enabled
    FROM notification_settings
    WHERE user_id = $1
    `,
    [args.userId],
  )
  const row = settings.rows[0]
  if (!row || !row.enabled) {
    return
  }

  const eventId = randomUUID()
  const payload: OutboxPayload = {
    version: 1,
    eventId,
    eventType: args.eventType,
    incidentId: args.incidentId,
    monitorId: args.monitorId,
    monitorName: args.monitorName,
    status: args.status,
    occurredAt: args.occurredAt.toISOString(),
  }

  await client.query(
    `
    INSERT INTO notification_outbox (
      id,
      incident_id,
      destination_url,
      event_type,
      payload,
      status,
      attempts,
      available_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, 'PENDING', 0, NOW())
    ON CONFLICT (incident_id, event_type) DO NOTHING
    `,
    [eventId, args.incidentId, row.webhook_url, args.eventType, JSON.stringify(payload)],
  )
}

/**
 * Persist a completed check under stale-work guards, then apply status /
 * incident / outbox transitions atomically.
 */
export async function persistCheckResult(
  params: PersistCheckResultParams,
): Promise<PersistOutcome> {
  const { pool, workerId, claimed, check } = params
  const finishedAt = params.finishedAt ?? new Date()
  const logger = params.logger

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const locked = await client.query<LockedMonitor>(
      `
      SELECT
        id,
        user_id,
        name,
        interval_seconds,
        status,
        consecutive_failures,
        consecutive_successes,
        next_check_at,
        lease_owner,
        enabled
      FROM monitors
      WHERE id = $1
      FOR UPDATE
      `,
      [claimed.id],
    )

    const monitor = locked.rows[0]
    if (!monitor) {
      await client.query('COMMIT')
      return { kind: 'missing' }
    }

    const scheduleMatches =
      monitor.next_check_at.getTime() === claimed.scheduledFor.getTime() ||
      monitor.next_check_at.toISOString() === claimed.scheduledFor.toISOString()

    if (monitor.lease_owner !== workerId || !scheduleMatches) {
      await client.query('COMMIT')
      return { kind: 'stale' }
    }

    const inserted = await client.query<{ id: string }>(
      `
      INSERT INTO check_results (
        monitor_id,
        scheduled_for,
        checked_at,
        outcome,
        response_ms,
        status_code,
        error_code,
        error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (monitor_id, scheduled_for) DO NOTHING
      RETURNING id
      `,
      [
        claimed.id,
        claimed.scheduledFor,
        finishedAt,
        check.outcome,
        check.responseMs,
        check.statusCode,
        check.errorCode,
        check.errorMessage,
      ],
    )

    if (inserted.rowCount === 0 || !inserted.rows[0]) {
      await clearLeaseIfOwned(client, claimed.id, workerId)
      await client.query('COMMIT')
      return { kind: 'duplicate' }
    }

    const checkResultId = Number(inserted.rows[0].id)
    const transition = applyCheckResult(
      {
        status: monitor.status,
        consecutiveFailures: monitor.consecutive_failures,
        consecutiveSuccesses: monitor.consecutive_successes,
      },
      check.outcome === 'UP' ? CheckOutcome.UP : CheckOutcome.DOWN,
    )

    const nextCheckAt = computeNextCheckAfterResult(
      claimed.scheduledFor,
      monitor.interval_seconds,
      finishedAt,
    )

    await client.query(
      `
      UPDATE monitors
      SET
        status = $2,
        consecutive_failures = $3,
        consecutive_successes = $4,
        last_checked_at = $5,
        last_response_ms = $6,
        last_status_code = $7,
        last_error_code = $8,
        last_error_message = $9,
        next_check_at = $10,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = $5
      WHERE id = $1
      `,
      [
        claimed.id,
        transition.nextStatus,
        transition.nextConsecutiveFailures,
        transition.nextConsecutiveSuccesses,
        finishedAt,
        check.responseMs,
        check.statusCode,
        check.errorCode,
        check.errorMessage,
        nextCheckAt,
      ],
    )

    if (transition.transition === TransitionAction.OPEN_INCIDENT) {
      const open = await client.query<{ id: string }>(
        `
        SELECT id
        FROM incidents
        WHERE monitor_id = $1
          AND resolved_at IS NULL
        LIMIT 1
        FOR UPDATE
        `,
        [claimed.id],
      )

      let incidentId = open.rows[0]?.id
      if (incidentId) {
        logger?.warn('invariant_open_incident_exists', {
          monitorId: claimed.id,
          incidentId,
          workerId,
        })
      } else {
        const created = await client.query<{ id: string }>(
          `
          INSERT INTO incidents (monitor_id, started_at)
          VALUES ($1, $2)
          RETURNING id
          `,
          [claimed.id, finishedAt],
        )
        incidentId = created.rows[0]!.id
        await insertOutboxEvent(client, {
          incidentId,
          userId: monitor.user_id,
          monitorId: claimed.id,
          monitorName: monitor.name,
          eventType: 'DOWN',
          status: 'DOWN',
          occurredAt: finishedAt,
        })
      }
    } else if (transition.transition === TransitionAction.RESOLVE_INCIDENT) {
      const open = await client.query<{ id: string }>(
        `
        SELECT id
        FROM incidents
        WHERE monitor_id = $1
          AND resolved_at IS NULL
        LIMIT 1
        FOR UPDATE
        `,
        [claimed.id],
      )
      const incidentId = open.rows[0]?.id
      if (!incidentId) {
        logger?.warn('invariant_resolve_without_open_incident', {
          monitorId: claimed.id,
          workerId,
        })
      } else {
        await client.query(
          `
          UPDATE incidents
          SET resolved_at = $2
          WHERE id = $1
            AND resolved_at IS NULL
          `,
          [incidentId, finishedAt],
        )
        await insertOutboxEvent(client, {
          incidentId,
          userId: monitor.user_id,
          monitorId: claimed.id,
          monitorName: monitor.name,
          eventType: 'RECOVERED',
          status: 'UP',
          occurredAt: finishedAt,
        })
      }
    }

    await client.query('COMMIT')
    return { kind: 'applied', checkResultId }
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback errors
    }
    throw error
  } finally {
    client.release()
  }
}
