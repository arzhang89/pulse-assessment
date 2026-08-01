import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { incidents, monitors, notificationOutbox, users } from '../db/schema'
import {
  assertTestDatabaseName,
  closeTestDb,
  getTestDb,
  getTestPool,
  truncateAllTables,
} from './helpers/db'
import { claimPendingOutbox, notificationWorkerId } from '../worker/src/outbox-claim'
import { finalizeOutboxDelivery } from '../worker/src/finalize-outbox'
import { createProcessOutbox } from '../worker/src/process-outbox'
import { startWorkerRuntime } from '../worker/src/runtime'
import type { WorkerConfig } from '../worker/src/config'
import type { DeliverWebhookResult } from '../worker/src/deliver-webhook'

const WORKER = 'delivery-worker'
const NOTIFY = notificationWorkerId(WORKER)

async function seedOutbox(overrides: Partial<typeof notificationOutbox.$inferInsert> = {}) {
  const db = getTestDb()
  const [user] = await db
    .insert(users)
    .values({
      email: `u-${randomUUID()}@example.com`,
      passwordHash: 'hash',
      statusPageSlug: `slug-${randomUUID().slice(0, 8)}`,
    })
    .returning()
  const [monitor] = await db
    .insert(monitors)
    .values({
      userId: user!.id,
      name: 'Site',
      url: 'https://example.com',
      intervalSeconds: 60,
      nextCheckAt: new Date(),
    })
    .returning()
  const [incident] = await db
    .insert(incidents)
    .values({ monitorId: monitor!.id, startedAt: new Date() })
    .returning()

  const id = overrides.id ?? randomUUID()
  const payload = {
    version: 1,
    eventId: id,
    eventType: 'DOWN',
    incidentId: incident!.id,
    monitorId: monitor!.id,
    monitorName: 'Site',
    status: 'DOWN',
    occurredAt: new Date().toISOString(),
  }

  const [row] = await db
    .insert(notificationOutbox)
    .values({
      id,
      incidentId: incident!.id,
      destinationUrl: 'https://hooks.example.com/pulse',
      eventType: 'DOWN',
      payload,
      status: 'PENDING',
      attempts: 0,
      availableAt: new Date(Date.now() - 1_000),
      ...overrides,
    })
    .returning()

  return { user: user!, monitor: monitor!, incident: incident!, outbox: row!, payload }
}

function testConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    databaseUrl: process.env.TEST_DATABASE_URL!,
    nodeEnv: 'test',
    concurrency: 1,
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

describe('outbox claim and delivery finalization', () => {
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

  it('gives disjoint rows to two claimers and respects batch size', async () => {
    await seedOutbox()
    await seedOutbox()
    await seedOutbox()

    const a = await claimPendingOutbox({
      pool: getTestPool(),
      workerId: 'n1',
      leaseSeconds: 60,
      limit: 2,
    })
    const b = await claimPendingOutbox({
      pool: getTestPool(),
      workerId: 'n2',
      leaseSeconds: 60,
      limit: 2,
    })

    expect(a).toHaveLength(2)
    expect(b).toHaveLength(1)
    const ids = new Set([...a, ...b].map((r) => r.id))
    expect(ids.size).toBe(3)
  })

  it('skips active leases, future available_at, and non-PENDING rows', async () => {
    const active = await seedOutbox({
      leaseOwner: 'other',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    await seedOutbox({ availableAt: new Date(Date.now() + 60_000) })
    await seedOutbox({ status: 'SENT', sentAt: new Date() })
    const due = await seedOutbox()

    const claimed = await claimPendingOutbox({
      pool: getTestPool(),
      workerId: NOTIFY,
      leaseSeconds: 60,
      limit: 10,
    })
    expect(claimed.map((c) => c.id)).toEqual([due.outbox.id])
    expect(claimed[0]!.payload).toMatchObject({ eventId: due.outbox.id })
    void active
  })

  it('reclaims expired leases', async () => {
    const { outbox } = await seedOutbox({
      leaseOwner: 'stale',
      leaseExpiresAt: new Date(Date.now() - 1_000),
    })
    const claimed = await claimPendingOutbox({
      pool: getTestPool(),
      workerId: NOTIFY,
      leaseSeconds: 60,
      limit: 10,
    })
    expect(claimed[0]!.id).toBe(outbox.id)
    expect(claimed[0]!.leaseOwner).toBe(NOTIFY)
  })

  it('marks SENT on success and clears lease', async () => {
    const { outbox, payload } = await seedOutbox()
    const [claimed] = await claimPendingOutbox({
      pool: getTestPool(),
      workerId: NOTIFY,
      leaseSeconds: 60,
      limit: 1,
    })
    expect(claimed!.payload).toEqual(payload)

    const outcome = await finalizeOutboxDelivery({
      pool: getTestPool(),
      notificationWorkerId: NOTIFY,
      outboxId: claimed!.id,
      currentAttempts: claimed!.attempts,
      delivery: {
        disposition: 'success',
        statusCode: 200,
        responseMs: 10,
        errorMessage: null,
      },
    })
    expect(outcome).toEqual({ kind: 'applied', status: 'SENT' })

    const [row] = await getTestDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, outbox.id))
    expect(row!.status).toBe('SENT')
    expect(row!.attempts).toBe(1)
    expect(row!.leaseOwner).toBeNull()
    expect(row!.lastError).toBeNull()
    expect(row!.payload).toEqual(payload)
  })

  it('schedules retry for retryable failure and fails terminally for 404', async () => {
    const retryable = await seedOutbox()
    await getTestDb()
      .update(notificationOutbox)
      .set({
        leaseOwner: NOTIFY,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(notificationOutbox.id, retryable.outbox.id))

    const now = new Date('2020-01-01T00:00:00.000Z')
    await finalizeOutboxDelivery({
      pool: getTestPool(),
      notificationWorkerId: NOTIFY,
      outboxId: retryable.outbox.id,
      currentAttempts: 0,
      now,
      random: () => 0.5,
      delivery: {
        disposition: 'retryable',
        statusCode: 500,
        responseMs: 5,
        errorMessage: 'HTTP 500',
      },
    })
    let [row] = await getTestDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, retryable.outbox.id))
    expect(row!.status).toBe('PENDING')
    expect(row!.attempts).toBe(1)
    expect(row!.availableAt.toISOString()).toBe('2020-01-01T00:00:30.000Z')
    expect(row!.leaseOwner).toBeNull()

    const terminal = await seedOutbox()
    await getTestDb()
      .update(notificationOutbox)
      .set({
        leaseOwner: NOTIFY,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(notificationOutbox.id, terminal.outbox.id))

    await finalizeOutboxDelivery({
      pool: getTestPool(),
      notificationWorkerId: NOTIFY,
      outboxId: terminal.outbox.id,
      currentAttempts: 0,
      delivery: {
        disposition: 'terminal',
        statusCode: 404,
        responseMs: 5,
        errorMessage: 'HTTP 404',
      },
    })
    ;[row] = await getTestDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, terminal.outbox.id))
    expect(row!.status).toBe('FAILED')
    expect(row!.attempts).toBe(1)
    expect(row!.leaseOwner).toBeNull()
  })

  it('stale finalization cannot overwrite another worker decision', async () => {
    const { outbox } = await seedOutbox()
    await claimPendingOutbox({
      pool: getTestPool(),
      workerId: NOTIFY,
      leaseSeconds: 60,
      limit: 1,
    })

    const stale = await finalizeOutboxDelivery({
      pool: getTestPool(),
      notificationWorkerId: 'other:notify',
      outboxId: outbox.id,
      currentAttempts: 0,
      delivery: {
        disposition: 'success',
        statusCode: 200,
        responseMs: 1,
        errorMessage: null,
      },
    })
    expect(stale.kind).toBe('stale')

    const [row] = await getTestDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, outbox.id))
    expect(row!.status).toBe('PENDING')
    expect(row!.leaseOwner).toBe(NOTIFY)
  })

  it('notification loop delivers with injected transport and bounds concurrency', async () => {
    await seedOutbox()
    await seedOutbox()
    let inFlight = 0
    let maxInFlight = 0
    const deliveries: string[] = []

    const processOutbox = createProcessOutbox({
      pool: getTestPool(),
      notificationWorkerId: NOTIFY,
      deliveryTimeoutMs: 10_000,
      deliver: async (event) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 30))
        inFlight -= 1
        deliveries.push(event.id)
        const result: DeliverWebhookResult = {
          disposition: 'success',
          statusCode: 200,
          responseMs: 1,
          errorMessage: null,
        }
        return result
      },
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })

    const runtime = startWorkerRuntime({
      pool: getTestPool(),
      config: testConfig({ notificationConcurrency: 1, concurrency: 1 }),
      workerId: WORKER,
      once: true,
      processClaimed: async () => undefined,
      processOutbox,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })

    await runtime.done
    // once = one claim iteration; concurrency 1 → one event this run.
    expect(deliveries).toHaveLength(1)
    expect(maxInFlight).toBe(1)

    // Second once drain for the remaining event.
    const runtime2 = startWorkerRuntime({
      pool: getTestPool(),
      config: testConfig({ notificationConcurrency: 1, concurrency: 1 }),
      workerId: WORKER,
      once: true,
      processClaimed: async () => undefined,
      processOutbox,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })
    await runtime2.done
    expect(deliveries).toHaveLength(2)

    const rows = await getTestDb().select().from(notificationOutbox)
    expect(rows.every((r) => r.status === 'SENT')).toBe(true)
    expect(rows.every((r) => (r.payload as { eventId: string }).eventId === r.id)).toBe(true)
  })
})
