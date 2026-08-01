import pLimit from 'p-limit'
import type { Pool } from 'pg'
import { claimCapacity, claimDueMonitors, type ClaimedMonitor } from './claim.js'
import { databaseErrorBackoffMs } from './backoff.js'
import type { WorkerConfig } from './config.js'
import {
  claimPendingOutbox,
  notificationWorkerId,
  type ClaimedOutboxEvent,
} from './outbox-claim.js'

export type ProcessClaimedMonitor = (claimed: ClaimedMonitor, signal: AbortSignal) => Promise<void>

export type ProcessClaimedOutbox = (
  claimed: ClaimedOutboxEvent,
  signal: AbortSignal,
) => Promise<void>

export type WorkerRuntimeOptions = {
  pool: Pool
  config: WorkerConfig
  workerId: string
  processClaimed: ProcessClaimedMonitor
  processOutbox: ProcessClaimedOutbox
  once?: boolean
  sleep?: (ms: number) => Promise<void>
  onStopped?: () => void
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    warn: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
}

export type WorkerRuntime = {
  done: Promise<void>
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

type LoopShared = {
  claiming: boolean
  shuttingDown: boolean
}

/**
 * Two independent loops (monitors + notifications) in one process.
 * Shared shutdown/grace; separate p-limit pools and DB-error backoff.
 */
export function startWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const {
    pool,
    config,
    workerId,
    processClaimed,
    processOutbox,
    once = false,
    sleep = defaultSleep,
    onStopped,
    logger = defaultLogger(),
  } = options

  const notifyId = notificationWorkerId(workerId)
  const monitorLimit = pLimit(config.concurrency)
  const notifyLimit = pLimit(config.notificationConcurrency)
  const inFlightControllers = new Set<AbortController>()

  const shared: LoopShared = { claiming: true, shuttingDown: false }

  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  const poolsBusy = () =>
    monitorLimit.activeCount > 0 ||
    monitorLimit.pendingCount > 0 ||
    notifyLimit.activeCount > 0 ||
    notifyLimit.pendingCount > 0

  const enforceGrace = async () => {
    const deadline = Date.now() + config.shutdownGraceMs
    while (Date.now() < deadline && poolsBusy()) {
      await sleep(50)
    }

    if (poolsBusy() || inFlightControllers.size > 0) {
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
    if (shared.shuttingDown) {
      return
    }
    shared.shuttingDown = true
    shared.claiming = false
    logger.info('worker_shutdown_requested', { workerId })
    void enforceGrace()
  }

  const runMonitorLoop = () =>
    runClaimLoop({
      name: 'monitor',
      shared,
      once,
      sleep,
      pollIntervalMs: config.pollIntervalMs,
      limit: monitorLimit,
      claim: async (capacity) =>
        claimDueMonitors({
          pool,
          workerId,
          leaseSeconds: config.leaseSeconds,
          limit: capacity,
        }),
      concurrency: config.concurrency,
      processItem: processClaimed,
      inFlightControllers,
      logger,
      workerId,
      itemKey: (m) => m.id,
    })

  const runNotifyLoop = () =>
    runClaimLoop({
      name: 'notification',
      shared,
      once,
      sleep,
      pollIntervalMs: config.pollIntervalMs,
      limit: notifyLimit,
      claim: async (capacity) =>
        claimPendingOutbox({
          pool,
          workerId: notifyId,
          leaseSeconds: config.leaseSeconds,
          limit: capacity,
        }),
      concurrency: config.notificationConcurrency,
      processItem: processOutbox,
      inFlightControllers,
      logger,
      workerId: notifyId,
      itemKey: (e) => e.id,
    })

  void (async () => {
    try {
      await Promise.all([runMonitorLoop(), runNotifyLoop()])
    } finally {
      onStopped?.()
      resolveDone()
    }
  })()

  return { done, shutdown }
}

async function runClaimLoop<T>(options: {
  name: string
  shared: LoopShared
  once: boolean
  sleep: (ms: number) => Promise<void>
  pollIntervalMs: number
  limit: ReturnType<typeof pLimit>
  concurrency: number
  claim: (capacity: number) => Promise<T[]>
  processItem: (item: T, signal: AbortSignal) => Promise<void>
  inFlightControllers: Set<AbortController>
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    warn: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
  workerId: string
  itemKey: (item: T) => string
}): Promise<void> {
  let loopClaiming = true
  let dbErrorAttempt = 0

  while (true) {
    const mayClaim = options.shared.claiming && loopClaiming

    if (mayClaim) {
      const capacity = claimCapacity(
        options.concurrency,
        options.limit.activeCount,
        options.limit.pendingCount,
      )

      if (capacity > 0) {
        try {
          const claimed = await options.claim(capacity)
          dbErrorAttempt = 0

          for (const item of claimed) {
            const controller = new AbortController()
            options.inFlightControllers.add(controller)

            void options.limit(async () => {
              try {
                await options.processItem(item, controller.signal)
              } catch (error) {
                options.logger.error('worker_process_failed', {
                  loop: options.name,
                  workerId: options.workerId,
                  itemId: options.itemKey(item),
                  error: error instanceof Error ? error.message : 'unknown',
                })
              } finally {
                options.inFlightControllers.delete(controller)
              }
            })
          }

          if (options.once) {
            loopClaiming = false
          }
        } catch (error) {
          const delay = databaseErrorBackoffMs(dbErrorAttempt)
          dbErrorAttempt += 1
          options.logger.error('worker_claim_failed', {
            loop: options.name,
            workerId: options.workerId,
            attempt: dbErrorAttempt,
            backoffMs: delay,
            error: error instanceof Error ? error.message : 'unknown',
          })
          if (options.once) {
            loopClaiming = false
          } else if (options.shared.claiming && loopClaiming) {
            await options.sleep(delay)
            continue
          }
        }
      } else if (options.once) {
        loopClaiming = false
      }
    }

    const busy = options.limit.activeCount > 0 || options.limit.pendingCount > 0

    if (!options.shared.claiming) {
      loopClaiming = false
    }

    if (!loopClaiming && !busy) {
      break
    }

    if (loopClaiming && options.shared.claiming && !options.once) {
      await options.sleep(options.pollIntervalMs)
      continue
    }

    await options.sleep(50)
  }
}
