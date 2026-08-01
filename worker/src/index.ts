import { getPool } from '../../db/client.js'
import { getWorkerConfig } from './config.js'
import { createProcessClaimed } from './process-claimed.js'
import { createProcessOutbox } from './process-outbox.js'
import { notificationWorkerId } from './outbox-claim.js'
import { startWorkerRuntime } from './runtime.js'
import { createWorkerId } from './worker-id.js'

function parseOnceFlag(argv: string[]): boolean {
  return argv.includes('--once') || process.env.WORKER_ONCE === '1'
}

function structuredLogger() {
  return {
    info: (msg: string, meta?: Record<string, unknown>) => {
      console.log(
        JSON.stringify({ level: 'info', msg, ...meta, timestamp: new Date().toISOString() }),
      )
    },
    warn: (msg: string, meta?: Record<string, unknown>) => {
      console.warn(
        JSON.stringify({ level: 'warn', msg, ...meta, timestamp: new Date().toISOString() }),
      )
    },
    error: (msg: string, meta?: Record<string, unknown>) => {
      console.error(
        JSON.stringify({ level: 'error', msg, ...meta, timestamp: new Date().toISOString() }),
      )
    },
  }
}

async function main(): Promise<void> {
  const once = parseOnceFlag(process.argv)
  const config = getWorkerConfig()
  const workerId = createWorkerId(config.workerId)
  const notifyId = notificationWorkerId(workerId)
  const pool = getPool()
  const logger = structuredLogger()

  logger.info('worker_starting', {
    workerId,
    notificationWorkerId: notifyId,
    once,
    concurrency: config.concurrency,
    notificationConcurrency: config.notificationConcurrency,
    pollIntervalMs: config.pollIntervalMs,
    leaseSeconds: config.leaseSeconds,
    deliveryTimeoutMs: config.deliveryTimeoutMs,
    shutdownGraceMs: config.shutdownGraceMs,
  })

  const processClaimed = createProcessClaimed({
    pool,
    workerId,
    logger,
  })

  const processOutbox = createProcessOutbox({
    pool,
    notificationWorkerId: notifyId,
    deliveryTimeoutMs: config.deliveryTimeoutMs,
    logger,
  })

  const runtime = startWorkerRuntime({
    pool,
    config,
    workerId,
    processClaimed,
    processOutbox,
    once,
    logger,
  })

  const onSignal = (signal: string) => {
    logger.info('worker_signal', { workerId, signal })
    runtime.shutdown()
  }

  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  await runtime.done
  await pool.end()
  logger.info('worker_stopped', { workerId, once })
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'worker_fatal',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }),
  )
  process.exit(1)
})
