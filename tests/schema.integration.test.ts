import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { checkResults, incidents, monitors, notificationOutbox, users } from '../db/schema'
import { assertTestDatabaseName, closeTestDb, getTestDb, truncateAllTables } from './helpers/db'

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  if ('code' in error && typeof error.code === 'string') {
    return error.code
  }

  // Drizzle wraps node-postgres errors on `cause`.
  if ('cause' in error) {
    return postgresErrorCode(error.cause)
  }

  return undefined
}

function isDbRejection(error: unknown): boolean {
  const code = postgresErrorCode(error)
  // 23505 unique_violation, 23514 check_violation, 23503 foreign_key_violation
  return code === '23505' || code === '23514' || code === '23503'
}

async function expectDbRejection(operation: Promise<unknown>): Promise<void> {
  try {
    await operation
    expect.fail('expected database rejection')
  } catch (error) {
    expect(isDbRejection(error)).toBe(true)
  }
}

async function insertUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const db = getTestDb()
  const [row] = await db
    .insert(users)
    .values({
      email: overrides.email ?? 'user@example.com',
      passwordHash: overrides.passwordHash ?? 'hash',
      statusPageSlug: overrides.statusPageSlug ?? `slug-${randomUUID().slice(0, 8)}`,
      ...overrides,
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
      timeoutMs: overrides.timeoutMs ?? 10_000,
      nextCheckAt: overrides.nextCheckAt ?? new Date(),
      ...overrides,
    })
    .returning()
  return row!
}

describe('domain schema constraints', () => {
  beforeAll(async () => {
    getTestDb()
    await assertTestDatabaseName()
  })

  beforeEach(async () => {
    await truncateAllTables()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('rejects duplicate user emails', async () => {
    await insertUser({ email: 'dup@example.com', statusPageSlug: 'slug-a' })
    await expectDbRejection(insertUser({ email: 'dup@example.com', statusPageSlug: 'slug-b' }))
  })

  it('rejects duplicate status-page slugs', async () => {
    await insertUser({ email: 'a@example.com', statusPageSlug: 'same-slug' })
    await expectDbRejection(insertUser({ email: 'b@example.com', statusPageSlug: 'same-slug' }))
  })

  it('rejects unnormalized email values via CHECK', async () => {
    await expectDbRejection(insertUser({ email: 'User@Example.com' }))
    await expectDbRejection(insertUser({ email: ' user@example.com ' }))
    await insertUser({ email: 'user@example.com' })
  })

  it('rejects invalid monitor intervals', async () => {
    const user = await insertUser()
    await expectDbRejection(insertMonitor(user.id, { intervalSeconds: 120 }))
  })

  it('rejects invalid monitor timeouts', async () => {
    const user = await insertUser()
    await expectDbRejection(insertMonitor(user.id, { timeoutMs: 500 }))
    await expectDbRejection(insertMonitor(user.id, { timeoutMs: 60_000 }))
  })

  it('rejects blank monitor names', async () => {
    const user = await insertUser()
    await expectDbRejection(insertMonitor(user.id, { name: '' }))
    await expectDbRejection(insertMonitor(user.id, { name: '   ' }))
  })

  it('rejects negative consecutive counters', async () => {
    const user = await insertUser()
    await expectDbRejection(insertMonitor(user.id, { consecutiveFailures: -1 }))
    await expectDbRejection(insertMonitor(user.id, { consecutiveSuccesses: -1 }))
  })

  it('rejects negative response times', async () => {
    const user = await insertUser()
    await expectDbRejection(insertMonitor(user.id, { lastResponseMs: -1 }))

    const monitor = await insertMonitor(user.id)
    const db = getTestDb()
    await expectDbRejection(
      db.insert(checkResults).values({
        monitorId: monitor.id,
        scheduledFor: new Date('2026-01-01T00:00:00Z'),
        checkedAt: new Date('2026-01-01T00:00:01Z'),
        outcome: 'UP',
        responseMs: -5,
      }),
    )
  })

  it('rejects invalid HTTP status codes', async () => {
    const user = await insertUser()
    await expectDbRejection(insertMonitor(user.id, { lastStatusCode: 99 }))
    await expectDbRejection(insertMonitor(user.id, { lastStatusCode: 600 }))

    const monitor = await insertMonitor(user.id)
    const db = getTestDb()
    await expectDbRejection(
      db.insert(checkResults).values({
        monitorId: monitor.id,
        scheduledFor: new Date('2026-01-01T00:00:00Z'),
        checkedAt: new Date('2026-01-01T00:00:01Z'),
        outcome: 'DOWN',
        statusCode: 99,
      }),
    )
  })

  it('rejects duplicate check-result schedule slots', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const db = getTestDb()
    const scheduledFor = new Date('2026-01-01T00:00:00Z')

    await db.insert(checkResults).values({
      monitorId: monitor.id,
      scheduledFor,
      checkedAt: new Date('2026-01-01T00:00:01Z'),
      outcome: 'UP',
    })

    await expectDbRejection(
      db.insert(checkResults).values({
        monitorId: monitor.id,
        scheduledFor,
        checkedAt: new Date('2026-01-01T00:00:02Z'),
        outcome: 'DOWN',
      }),
    )
  })

  it('rejects two unresolved incidents for one monitor', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const db = getTestDb()

    await db.insert(incidents).values({
      monitorId: monitor.id,
      startedAt: new Date('2026-01-01T00:00:00Z'),
    })

    await expectDbRejection(
      db.insert(incidents).values({
        monitorId: monitor.id,
        startedAt: new Date('2026-01-01T01:00:00Z'),
      }),
    )
  })

  it('rejects duplicate DOWN or RECOVERED events for one incident', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const db = getTestDb()
    const [incident] = await db
      .insert(incidents)
      .values({
        monitorId: monitor.id,
        startedAt: new Date('2026-01-01T00:00:00Z'),
      })
      .returning()

    await db.insert(notificationOutbox).values({
      incidentId: incident!.id,
      destinationUrl: 'https://hooks.example.com/a',
      eventType: 'DOWN',
      payload: { kind: 'DOWN' },
    })

    await expectDbRejection(
      db.insert(notificationOutbox).values({
        incidentId: incident!.id,
        destinationUrl: 'https://hooks.example.com/b',
        eventType: 'DOWN',
        payload: { kind: 'DOWN' },
      }),
    )

    await db.insert(notificationOutbox).values({
      incidentId: incident!.id,
      destinationUrl: 'https://hooks.example.com/a',
      eventType: 'RECOVERED',
      payload: { kind: 'RECOVERED' },
    })

    await expectDbRejection(
      db.insert(notificationOutbox).values({
        incidentId: incident!.id,
        destinationUrl: 'https://hooks.example.com/a',
        eventType: 'RECOVERED',
        payload: { kind: 'RECOVERED' },
      }),
    )
  })

  it('rejects half-populated monitor leases', async () => {
    const user = await insertUser()
    await expectDbRejection(
      insertMonitor(user.id, {
        leaseOwner: 'worker-1',
        leaseExpiresAt: null,
      }),
    )
    await expectDbRejection(
      insertMonitor(user.id, {
        leaseOwner: null,
        leaseExpiresAt: new Date(),
      }),
    )
  })

  it('rejects half-populated outbox leases', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const db = getTestDb()
    const [incident] = await db
      .insert(incidents)
      .values({
        monitorId: monitor.id,
        startedAt: new Date(),
      })
      .returning()

    await expectDbRejection(
      db.insert(notificationOutbox).values({
        incidentId: incident!.id,
        destinationUrl: 'https://hooks.example.com/a',
        eventType: 'DOWN',
        payload: {},
        leaseOwner: 'worker-1',
        leaseExpiresAt: null,
      }),
    )

    await expectDbRejection(
      db.insert(notificationOutbox).values({
        incidentId: incident!.id,
        destinationUrl: 'https://hooks.example.com/a',
        eventType: 'DOWN',
        payload: {},
        leaseOwner: null,
        leaseExpiresAt: new Date(),
      }),
    )
  })

  it('cascades monitor deletion through incidents and pending outbox rows', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const db = getTestDb()

    const [incident] = await db
      .insert(incidents)
      .values({
        monitorId: monitor.id,
        startedAt: new Date(),
      })
      .returning()

    await db.insert(notificationOutbox).values({
      incidentId: incident!.id,
      destinationUrl: 'https://hooks.example.com/a',
      eventType: 'DOWN',
      payload: { kind: 'DOWN' },
      status: 'PENDING',
    })

    await db.delete(monitors).where(eq(monitors.id, monitor.id))

    const remainingIncidents = await db.select().from(incidents)
    const remainingOutbox = await db.select().from(notificationOutbox)
    expect(remainingIncidents).toHaveLength(0)
    expect(remainingOutbox).toHaveLength(0)
  })
})
