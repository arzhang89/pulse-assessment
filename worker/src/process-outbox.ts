import type { Pool } from 'pg'
import { deliverWebhook, type DeliverWebhookResult } from './deliver-webhook.js'
import { finalizeOutboxDelivery } from './finalize-outbox.js'
import type { ClaimedOutboxEvent } from './outbox-claim.js'
import type { SafeRequestDependencies } from './checker/safe-request.js'

export type ProcessOutboxDeps = {
  pool: Pool
  notificationWorkerId: string
  deliveryTimeoutMs: number
  requestDeps?: SafeRequestDependencies
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    warn: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
  deliver?: (event: ClaimedOutboxEvent, signal: AbortSignal) => Promise<DeliverWebhookResult>
  random?: () => number
}

export function createProcessOutbox(deps: ProcessOutboxDeps) {
  return async function processOutbox(
    event: ClaimedOutboxEvent,
    signal: AbortSignal,
  ): Promise<void> {
    const delivery = deps.deliver
      ? await deps.deliver(event, signal)
      : await deliverWebhook(
          {
            destinationUrl: event.destinationUrl,
            payload: event.payload,
            timeoutMs: deps.deliveryTimeoutMs,
            signal,
          },
          deps.requestDeps,
        )

    if (signal.aborted) {
      // Leave lease to expire naturally.
      return
    }

    const outcome = await finalizeOutboxDelivery({
      pool: deps.pool,
      notificationWorkerId: deps.notificationWorkerId,
      outboxId: event.id,
      currentAttempts: event.attempts,
      delivery,
      random: deps.random,
    })

    deps.logger?.info('worker_outbox_finalize', {
      notificationWorkerId: deps.notificationWorkerId,
      outboxId: event.id,
      disposition: delivery.disposition,
      outcome: outcome.kind,
      status: outcome.kind === 'applied' ? outcome.status : undefined,
    })
  }
}
