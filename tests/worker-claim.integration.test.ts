import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { monitors, users } from '../db/schema'
import {
  assertTestDatabaseName,
  closeTestDb,
  getTestDb,
  getTestPool,
  truncateAllTables,
} from './helpers/db'
import { claimCapacity, claimDueMonitors } from '../worker/src/claim'
import { updateMonitorForUser } from '../server/services/monitors'
import { startWorkerRuntime } from '../worker/src/runtime'
import type { WorkerConfig } from '../worker/src/config'

async function insertUser() {
  const db = getTestDb()
  const [row] = await db
    .insert(users)
    .values({
      email: `user-${randomUUID()}@example.com`,
      passwordHash: 'hash',
      statusPageSlug: `slug-${randomUUID().slice(0, 8)}`,
    })
    .returning()
  return row!
}

async function insertMonitor(
  userId: string,
  overrides: Partial<typeof monitors.$inferInsert> = {},
) {
  const db = getTestDb()
  const [row] = await db
    .insert(monitors)
    .values({
      userId,
      name: overrides.name ?? 'Homepage',
      url: overrides.url ?? 'https://example.com',
      intervalSeconds: overrides.intervalSeconds ?? 60,
      nextCheckAt: overrides.nextCheckAt ?? new Date(Date.now() - 1_000),
      ...overrides,
    })
    .returning()
  return row!
}

function testWorkerConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    databaseUrl: process.env.TEST_DATABASE_URL!,
    nodeEnv: 'test',
    concurrency: 2,
    pollIntervalMs: 10,
    leaseSeconds: 60,
    shutdownGraceMs: 200,
    workerId: undefined,
    maxCheckTimeoutMs: 30_000,
    persistenceMarginMs: 5_000,
    ...overrides,
  }
}

describe('claimDueMonitors', () => {
  beforeAll(async () => {
    // Point shared db/client (used by monitor update service) at pulse_test.
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

  it('claims due enabled monitors and returns scheduledFor as original next_check_at', async () => {
    const user = await insertUser()
    const scheduledFor = new Date('2020-01-01T00:00:00.000Z')
    const monitor = await insertMonitor(user.id, { nextCheckAt: scheduledFor })
    const updatedAtBefore = monitor.updatedAt

    const claimed = await claimDueMonitors({
      pool: getTestPool(),
      workerId: 'worker-a',
      leaseSeconds: 60,
      limit: 10,
      now: new Date('2020-01-01T00:01:00.000Z'),
    })

    expect(claimed).toHaveLength(1)
    expect(claimed[0]!.id).toBe(monitor.id)
    expect(claimed[0]!.scheduledFor.toISOString()).toBe(scheduledFor.toISOString())
    expect(claimed[0]!.leaseOwner).toBe('worker-a')

    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.leaseOwner).toBe('worker-a')
    expect(row!.leaseExpiresAt).not.toBeNull()
    expect(row!.nextCheckAt.toISOString()).toBe(scheduledFor.toISOString())
    expect(row!.updatedAt.toISOString()).toBe(updatedAtBefore.toISOString())
  })

  it('skips disabled monitors and unexpired leases', async () => {
    const user = await insertUser()
    await insertMonitor(user.id, { enabled: false, name: 'Disabled' })
    await insertMonitor(user.id, {
      name: 'Leased',
      leaseOwner: 'other',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    const due = await insertMonitor(user.id, { name: 'Due' })

    const claimed = await claimDueMonitors({
      pool: getTestPool(),
      workerId: 'worker-a',
      leaseSeconds: 60,
      limit: 10,
    })

    expect(claimed.map((c) => c.id)).toEqual([due.id])
  })

  it('reclaims monitors with expired leases', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id, {
      leaseOwner: 'stale-worker',
      leaseExpiresAt: new Date(Date.now() - 1_000),
    })

    const claimed = await claimDueMonitors({
      pool: getTestPool(),
      workerId: 'worker-b',
      leaseSeconds: 60,
      limit: 10,
    })

    expect(claimed).toHaveLength(1)
    expect(claimed[0]!.id).toBe(monitor.id)
    expect(claimed[0]!.leaseOwner).toBe('worker-b')
  })

  it('respects the claim limit for concurrency capacity', async () => {
    const user = await insertUser()
    await insertMonitor(user.id, { name: 'A' })
    await insertMonitor(user.id, { name: 'B' })
    await insertMonitor(user.id, { name: 'C' })

    const capacity = claimCapacity(2, 0, 0)
    const claimed = await claimDueMonitors({
      pool: getTestPool(),
      workerId: 'worker-a',
      leaseSeconds: 60,
      limit: capacity,
    })

    expect(claimed).toHaveLength(2)
  })

  it('does not claim when limit is zero', async () => {
    const user = await insertUser()
    await insertMonitor(user.id)

    const claimed = await claimDueMonitors({
      pool: getTestPool(),
      workerId: 'worker-a',
      leaseSeconds: 60,
      limit: 0,
    })

    expect(claimed).toHaveLength(0)
  })
})

describe('monitor update lease invalidation', () => {
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

  async function leasedMonitor(userId: string) {
    return insertMonitor(userId, {
      leaseOwner: 'worker-in-flight',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      nextCheckAt: new Date(Date.now() - 5_000),
    })
  }

  it('clears lease and reschedules on URL change', async () => {
    const user = await insertUser()
    const monitor = await leasedMonitor(user.id)
    const before = monitor.nextCheckAt

    await updateMonitorForUser(user.id, monitor.id, { url: 'https://changed.example.com' })

    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.leaseOwner).toBeNull()
    expect(row!.leaseExpiresAt).toBeNull()
    expect(row!.nextCheckAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })

  it('clears lease and reschedules on interval change', async () => {
    const user = await insertUser()
    const monitor = await leasedMonitor(user.id)

    await updateMonitorForUser(user.id, monitor.id, { intervalSeconds: 300 })

    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.leaseOwner).toBeNull()
    expect(row!.leaseExpiresAt).toBeNull()
    expect(row!.intervalSeconds).toBe(300)
  })

  it('clears lease on disable without requiring name/url change', async () => {
    const user = await insertUser()
    const monitor = await leasedMonitor(user.id)

    await updateMonitorForUser(user.id, monitor.id, { enabled: false })

    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.enabled).toBe(false)
    expect(row!.leaseOwner).toBeNull()
    expect(row!.leaseExpiresAt).toBeNull()
  })

  it('clears lease and reschedules on re-enable', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id, {
      enabled: false,
      leaseOwner: 'worker-in-flight',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })

    await updateMonitorForUser(user.id, monitor.id, { enabled: true })

    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.enabled).toBe(true)
    expect(row!.leaseOwner).toBeNull()
    expect(row!.leaseExpiresAt).toBeNull()
  })

  it('does not clear lease on name-only or isPublic-only changes', async () => {
    const user = await insertUser()
    const monitor = await leasedMonitor(user.id)

    await updateMonitorForUser(user.id, monitor.id, { name: 'Renamed' })
    let [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.leaseOwner).toBe('worker-in-flight')
    expect(row!.name).toBe('Renamed')

    await updateMonitorForUser(user.id, monitor.id, { isPublic: true })
    ;[row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.leaseOwner).toBe('worker-in-flight')
    expect(row!.isPublic).toBe(true)
  })
})

describe('worker runtime once mode', () => {
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

  it('claims at most one batch then stops', async () => {
    const user = await insertUser()
    await insertMonitor(user.id, { name: 'A' })
    await insertMonitor(user.id, { name: 'B' })

    const processed: string[] = []
    const runtime = startWorkerRuntime({
      pool: getTestPool(),
      config: testWorkerConfig({ concurrency: 2 }),
      workerId: 'runtime-once',
      once: true,
      processClaimed: async (claimed) => {
        processed.push(claimed.id)
      },
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })

    await runtime.done
    expect(processed).toHaveLength(2)

    const stillDue = await claimDueMonitors({
      pool: getTestPool(),
      workerId: 'other',
      leaseSeconds: 60,
      limit: 10,
    })
    expect(stillDue).toHaveLength(0)
  })

  it('stops claiming on shutdown and does not clear leases', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const runtime = startWorkerRuntime({
      pool: getTestPool(),
      config: testWorkerConfig({ concurrency: 1, shutdownGraceMs: 5_000 }),
      workerId: 'runtime-shutdown',
      processClaimed: async () => {
        await gate
      },
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })

    // Allow one claim to start.
    await new Promise((r) => setTimeout(r, 100))
    runtime.shutdown()
    release()
    await runtime.done

    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.leaseOwner).toBe('runtime-shutdown')
    expect(row!.leaseExpiresAt).not.toBeNull()
  })
})
