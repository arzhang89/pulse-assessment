import { z } from 'zod'
import { getEnv } from '../../shared/env.js'

/** Matches monitors timeout upper bound (30s). */
export const MAX_CHECK_TIMEOUT_MS = 30_000

/** Extra time reserved after work for DB persistence before lease expiry. */
export const PERSISTENCE_MARGIN_MS = 5_000

const workerEnvSchema = z.object({
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(20),
  WORKER_NOTIFICATION_CONCURRENCY: z.coerce.number().int().positive().default(10),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
  WORKER_SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(60_000),
  WORKER_DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Compose often interpolates unset optional vars as "". Treat blank as unset.
  WORKER_ID: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
})

export type WorkerConfig = {
  databaseUrl: string
  nodeEnv: 'development' | 'production' | 'test'
  concurrency: number
  notificationConcurrency: number
  pollIntervalMs: number
  leaseSeconds: number
  shutdownGraceMs: number
  deliveryTimeoutMs: number
  workerId: string | undefined
  maxCheckTimeoutMs: number
  persistenceMarginMs: number
}

/**
 * Loads worker configuration. Lease must exceed max(check timeout, delivery
 * timeout) plus persistence margin.
 */
export function getWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const base = getEnv()
  const parsed = workerEnvSchema.safeParse(env)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid worker configuration:\n${issues}`)
  }

  const data = parsed.data
  const maxWorkMs = Math.max(MAX_CHECK_TIMEOUT_MS, data.WORKER_DELIVERY_TIMEOUT_MS)
  const minLeaseMs = maxWorkMs + PERSISTENCE_MARGIN_MS
  const leaseMs = data.WORKER_LEASE_SECONDS * 1_000

  if (leaseMs <= minLeaseMs) {
    throw new Error(
      `WORKER_LEASE_SECONDS (${data.WORKER_LEASE_SECONDS}s) must exceed ` +
        `max(check timeout, delivery timeout) + PERSISTENCE_MARGIN_MS ` +
        `(${maxWorkMs}ms + ${PERSISTENCE_MARGIN_MS}ms = ${minLeaseMs}ms)`,
    )
  }

  if (data.WORKER_LEASE_SECONDS * 1000 <= data.WORKER_DELIVERY_TIMEOUT_MS + PERSISTENCE_MARGIN_MS) {
    throw new Error(
      `WORKER_LEASE_SECONDS must exceed WORKER_DELIVERY_TIMEOUT_MS + persistence margin`,
    )
  }

  return {
    databaseUrl: base.DATABASE_URL,
    nodeEnv: base.NODE_ENV,
    concurrency: data.WORKER_CONCURRENCY,
    notificationConcurrency: data.WORKER_NOTIFICATION_CONCURRENCY,
    pollIntervalMs: data.WORKER_POLL_INTERVAL_MS,
    leaseSeconds: data.WORKER_LEASE_SECONDS,
    shutdownGraceMs: data.WORKER_SHUTDOWN_GRACE_MS,
    deliveryTimeoutMs: data.WORKER_DELIVERY_TIMEOUT_MS,
    workerId: data.WORKER_ID,
    maxCheckTimeoutMs: MAX_CHECK_TIMEOUT_MS,
    persistenceMarginMs: PERSISTENCE_MARGIN_MS,
  }
}
