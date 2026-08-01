import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { setImmediate as defer } from 'node:timers'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { checkResults, monitors, users } from '../db/schema'
import {
  assertTestDatabaseName,
  closeTestDb,
  getTestDb,
  getTestPool,
  truncateAllTables,
} from './helpers/db'
import { startWorkerRuntime } from '../worker/src/runtime'
import { createProcessClaimed } from '../worker/src/process-claimed'
import type { WorkerConfig } from '../worker/src/config'

function testConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    databaseUrl: process.env.TEST_DATABASE_URL!,
    nodeEnv: 'test',
    concurrency: 2,
    notificationConcurrency: 2,
    deliveryTimeoutMs: 10_000,
    pollIntervalMs: 20,
    leaseSeconds: 60,
    shutdownGraceMs: 1_000,
    workerId: undefined,
    maxCheckTimeoutMs: 30_000,
    persistenceMarginMs: 5_000,
    ...overrides,
  }
}

describe('worker claim-check-persist once mode', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!
    getTestDb()
    await assertTestDatabaseName()
  })

  beforeEach(async () => {
    await truncateAllTables()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('runs one claim-check-persist batch with injected checker', async () => {
    const db = getTestDb()
    const [user] = await db
      .insert(users)
      .values({
        email: `rt-${randomUUID()}@example.com`,
        passwordHash: 'hash',
        statusPageSlug: `slug-${randomUUID().slice(0, 8)}`,
      })
      .returning()

    const [monitor] = await db
      .insert(monitors)
      .values({
        userId: user!.id,
        name: 'Runtime',
        url: 'https://example.com',
        intervalSeconds: 60,
        nextCheckAt: new Date(Date.now() - 1_000),
      })
      .returning()

    const httpsRequest = ((
      _options: Record<string, unknown>,
      cb: (
        res: EventEmitter & { statusCode: number; resume: () => void; destroy: () => void },
      ) => void,
    ) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void }
      req.end = () => {
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number
          resume: () => void
          destroy: () => void
        }
        res.statusCode = 200
        res.resume = () => undefined
        res.destroy = () => undefined
        defer(() => cb(res))
      }
      return req
    }) as never

    const processClaimed = createProcessClaimed({
      pool: getTestPool(),
      workerId: 'runtime-worker',
      checkDeps: {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpsRequest,
      },
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })

    const runtime = startWorkerRuntime({
      pool: getTestPool(),
      config: testConfig(),
      workerId: 'runtime-worker',
      processClaimed,
      processOutbox: async () => undefined,
      once: true,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })

    await runtime.done

    const [row] = await db.select().from(monitors).where(eq(monitors.id, monitor!.id))
    expect(row!.status).toBe('UP')
    expect(row!.leaseOwner).toBeNull()
    const results = await db.select().from(checkResults)
    expect(results).toHaveLength(1)
  })
})
