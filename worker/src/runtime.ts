import pLimit from 'p-limit'
import type { Pool } from 'pg'
import { claimCapacity, claimDueMonitors, type ClaimedMonitor } from './claim.js'
import { databaseErrorBackoffMs } from './backoff.js'
import type { WorkerConfig } from './config.js'

export type ProcessClaimedMonitor = (claimed: ClaimedMonitor, signal: AbortSignal) => Promise<void>

export type WorkerRuntimeOptions = {
  pool: Pool
  config: WorkerConfig
  workerId: string
  processClaimed: ProcessClaimedMonitor
  /**
   * When true, claim and process at most one batch then exit (after in-flight
   * work settles). Used by worker:once and tests.
   */
  once?: boolean
  /** Injectable clock for tests. */
  sleep?: (ms: number) => Promise<void>
  /** Called when the runtime has stopped claiming and finished/aborted work. */
  onStopped?: () => void
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    warn: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
}

export type WorkerRuntime = {
  /** Resolves when the loop has fully stopped. */
  done: Promise<void>
  /** Request graceful shutdown (stop claiming; wait / abort in-flight). */
  shutdown: () => void
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function defaultLogger() {
  return {
    info: (msg: string, meta?: Record<string, unknown>) => {
      console.log(JSON.stringify({ level: 'info', msg, ...meta }))
    },
    warn: (msg: string, meta?: Record<string, unknown>) => {
      console.warn(JSON.stringify({ level: 'warn', msg, ...meta }))
    },
    error: (msg: string, meta?: Record<string, unknown>) => {
      console.error(JSON.stringify({ level: 'error', msg, ...meta }))
    },
  }
}

/**
 * Shared continuous / once worker loop.
 *
 * Shutdown: stop claiming → wait for in-flight checks → on grace expiry abort
 * remaining AbortSignals. Leases are not forcibly cleared; they expire naturally.
 */
export function startWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const {
    pool,
    config,
    workerId,
    processClaimed,
    once = false,
    sleep = defaultSleep,
    onStopped,
    logger = defaultLogger(),
  } = options

  const limit = pLimit(config.concurrency)
  let claiming = true
  let shuttingDown = false
  let dbErrorAttempt = 0
  const inFlightControllers = new Set<AbortController>()

  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  const enforceGrace = async () => {
    const deadline = Date.now() + config.shutdownGraceMs
    while (Date.now() < deadline && (limit.activeCount > 0 || limit.pendingCount > 0)) {
      await sleep(50)
    }

    if (limit.activeCount > 0 || limit.pendingCount > 0 || inFlightControllers.size > 0) {
      logger.warn('worker_shutdown_grace_expired', {
        workerId,
        aborting: inFlightControllers.size,
      })
      for (const controller of inFlightControllers) {
        controller.abort()
      }
    }
  }

  const shutdown = () => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    claiming = false
    logger.info('worker_shutdown_requested', { workerId })
    void enforceGrace()
  }

  const run = async () => {
    try {
      while (true) {
        if (claiming) {
          const capacity = claimCapacity(config.concurrency, limit.activeCount, limit.pendingCount)

          if (capacity > 0) {
            try {
              const claimed = await claimDueMonitors({
                pool,
                workerId,
                leaseSeconds: config.leaseSeconds,
                limit: capacity,
              })
              dbErrorAttempt = 0

              for (const monitor of claimed) {
                const controller = new AbortController()
                inFlightControllers.add(controller)

                void limit(async () => {
                  try {
                    await processClaimed(monitor, controller.signal)
                  } catch (error) {
                    logger.error('worker_process_failed', {
                      workerId,
                      monitorId: monitor.id,
                      error: error instanceof Error ? error.message : 'unknown',
                    })
                  } finally {
                    inFlightControllers.delete(controller)
                  }
                })
              }

              if (once) {
                claiming = false
              }
            } catch (error) {
              const delay = databaseErrorBackoffMs(dbErrorAttempt)
              dbErrorAttempt += 1
              logger.error('worker_claim_failed', {
                workerId,
                attempt: dbErrorAttempt,
                backoffMs: delay,
                error: error instanceof Error ? error.message : 'unknown',
              })
              if (once) {
                claiming = false
              } else if (claiming) {
                await sleep(delay)
                continue
              }
            }
          } else if (once) {
            // No free slots and once mode already claimed its batch elsewhere —
            // wait for in-flight work below.
            claiming = false
          }
        }

        const busy = limit.activeCount > 0 || limit.pendingCount > 0

        if (!claiming && !busy) {
          break
        }

        if (claiming && !once) {
          await sleep(config.pollIntervalMs)
          continue
        }

        // Waiting for in-flight work (once mode or post-shutdown).
        await sleep(50)
      }
    } finally {
      onStopped?.()
      resolveDone()
    }
  }

  void run()

  return { done, shutdown }
}
