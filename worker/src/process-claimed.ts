import type { Pool } from 'pg'
import type { ClaimedMonitor } from './claim.js'
import { performHttpCheck, type HttpCheckDependencies } from './checker/http-check.js'
import { persistCheckResult, type PersistLogger } from './persist.js'

export type ProcessClaimedDeps = {
  pool: Pool
  workerId: string
  checkDeps?: HttpCheckDependencies
  logger?: PersistLogger
}

/**
 * Claimed-monitor processor: run SSRF-safe check, then persist under lease guards.
 */
export function createProcessClaimed(deps: ProcessClaimedDeps) {
  return async function processClaimed(
    claimed: ClaimedMonitor,
    signal: AbortSignal,
  ): Promise<void> {
    const check = await performHttpCheck(
      {
        url: claimed.url,
        timeoutMs: claimed.timeoutMs,
        signal,
      },
      deps.checkDeps,
    )

    if (signal.aborted) {
      // Grace abort: do not persist; leave lease to expire naturally.
      return
    }

    const outcome = await persistCheckResult({
      pool: deps.pool,
      workerId: deps.workerId,
      claimed,
      check,
      logger: deps.logger,
    })

    deps.logger?.info('worker_persist_outcome', {
      workerId: deps.workerId,
      monitorId: claimed.id,
      outcome: outcome.kind,
      checkOutcome: check.outcome,
      errorCode: check.errorCode,
    })
  }
}
