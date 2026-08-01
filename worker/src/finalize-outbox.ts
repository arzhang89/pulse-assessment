import type { Pool } from 'pg'
import { safeErrorMessage } from './checker/safe-message.js'
import type { DeliverWebhookResult } from './deliver-webhook.js'
import {
  NOTIFICATION_MAX_ATTEMPTS,
  retryDelayMs,
  type DeliveryDisposition,
} from './outbox-retry.js'

export type FinalizeOutboxOutcome =
  { kind: 'applied'; status: 'SENT' | 'FAILED' | 'PENDING' } | { kind: 'stale' }

export type FinalizeOutboxParams = {
  pool: Pool
  notificationWorkerId: string
  outboxId: string
  currentAttempts: number
  delivery: DeliverWebhookResult
  now?: Date
  random?: () => number
}

/**
 * Short transaction after network I/O. Finalizes only when the row is still
 * PENDING and leased by this notification worker.
 */
export async function finalizeOutboxDelivery(
  params: FinalizeOutboxParams,
): Promise<FinalizeOutboxOutcome> {
  const now = params.now ?? new Date()
  const nextAttempts = params.currentAttempts + 1
  const disposition = resolveDisposition(params.delivery.disposition, nextAttempts)
  const lastError =
    disposition === 'success'
      ? null
      : safeErrorMessage(params.delivery.errorMessage, 'delivery failed')

  const client = await params.pool.connect()
  try {
    await client.query('BEGIN')

    const locked = await client.query<{
      id: string
      status: string
      lease_owner: string | null
    }>(
      `
      SELECT id, status, lease_owner
      FROM notification_outbox
      WHERE id = $1
      FOR UPDATE
      `,
      [params.outboxId],
    )

    const row = locked.rows[0]
    if (!row || row.status !== 'PENDING' || row.lease_owner !== params.notificationWorkerId) {
      await client.query('COMMIT')
      return { kind: 'stale' }
    }

    if (disposition === 'success') {
      await client.query(
        `
        UPDATE notification_outbox
        SET
          status = 'SENT',
          attempts = $2,
          sent_at = $3,
          last_error = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL
        WHERE id = $1
        `,
        [params.outboxId, nextAttempts, now],
      )
      await client.query('COMMIT')
      return { kind: 'applied', status: 'SENT' }
    }

    if (disposition === 'terminal' || nextAttempts >= NOTIFICATION_MAX_ATTEMPTS) {
      await client.query(
        `
        UPDATE notification_outbox
        SET
          status = 'FAILED',
          attempts = $2,
          last_error = $3,
          lease_owner = NULL,
          lease_expires_at = NULL
        WHERE id = $1
        `,
        [params.outboxId, nextAttempts, lastError],
      )
      await client.query('COMMIT')
      return { kind: 'applied', status: 'FAILED' }
    }

    const delay = retryDelayMs(nextAttempts, { random: params.random })
    const availableAt = new Date(now.getTime() + delay)

    await client.query(
      `
      UPDATE notification_outbox
      SET
        status = 'PENDING',
        attempts = $2,
        available_at = $3,
        last_error = $4,
        lease_owner = NULL,
        lease_expires_at = NULL
      WHERE id = $1
      `,
      [params.outboxId, nextAttempts, availableAt, lastError],
    )
    await client.query('COMMIT')
    return { kind: 'applied', status: 'PENDING' }
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore
    }
    throw error
  } finally {
    client.release()
  }
}

function resolveDisposition(
  disposition: DeliveryDisposition,
  nextAttempts: number,
): DeliveryDisposition {
  if (disposition === 'success') {
    return 'success'
  }
  if (disposition === 'terminal' || nextAttempts >= NOTIFICATION_MAX_ATTEMPTS) {
    return 'terminal'
  }
  return 'retryable'
}
