import { z } from 'zod'
import { getEnv } from '../../shared/env.js'

/** Matches monitors.last_response_ms / check timeout budget (30s). */
export const MAX_CHECK_TIMEOUT_MS = 30_000

/** Extra time reserved after the check for DB persistence before lease expiry. */
export const PERSISTENCE_MARGIN_MS = 5_000

const workerEnvSchema = z.object({
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(20),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
  WORKER_SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(60_000),
  WORKER_ID: z.string().min(1).optional(),
})

export type WorkerConfig = {
  databaseUrl: string
  nodeEnv: 'development' | 'production' | 'test'
  concurrency: number
  pollIntervalMs: number
  leaseSeconds: number
  shutdownGraceMs: number
  workerId: string | undefined
  maxCheckTimeoutMs: number
  persistenceMarginMs: number
}

/**
 * Loads worker configuration. Validates that the lease duration exceeds the
 * maximum check timeout plus a persistence margin so in-flight work is not
 * reclaimed mid-check under normal operation.
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
  const minLeaseMs = MAX_CHECK_TIMEOUT_MS + PERSISTENCE_MARGIN_MS
  const leaseMs = data.WORKER_LEASE_SECONDS * 1_000

  if (leaseMs <= minLeaseMs) {
    throw new Error(
      `WORKER_LEASE_SECONDS (${data.WORKER_LEASE_SECONDS}s) must exceed ` +
        `MAX_CHECK_TIMEOUT_MS + PERSISTENCE_MARGIN_MS ` +
        `(${MAX_CHECK_TIMEOUT_MS}ms + ${PERSISTENCE_MARGIN_MS}ms = ${minLeaseMs}ms)`,
    )
  }

  return {
    databaseUrl: base.DATABASE_URL,
    nodeEnv: base.NODE_ENV,
    concurrency: data.WORKER_CONCURRENCY,
    pollIntervalMs: data.WORKER_POLL_INTERVAL_MS,
    leaseSeconds: data.WORKER_LEASE_SECONDS,
    shutdownGraceMs: data.WORKER_SHUTDOWN_GRACE_MS,
    workerId: data.WORKER_ID,
    maxCheckTimeoutMs: MAX_CHECK_TIMEOUT_MS,
    persistenceMarginMs: PERSISTENCE_MARGIN_MS,
  }
}
