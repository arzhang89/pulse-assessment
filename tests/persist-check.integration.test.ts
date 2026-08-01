import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkResults,
  incidents,
  monitors,
  notificationOutbox,
  notificationSettings,
  users,
} from '../db/schema'
import {
  assertTestDatabaseName,
  closeTestDb,
  getTestDb,
  getTestPool,
  truncateAllTables,
} from './helpers/db'
import { claimDueMonitors, type ClaimedMonitor } from '../worker/src/claim'
import { persistCheckResult } from '../worker/src/persist'
import { updateMonitorForUser } from '../server/services/monitors'
import type { HttpCheckResult } from '../worker/src/checker/types'

const WORKER_ID = 'persist-worker'

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

async function claimOne(monitorId: string): Promise<ClaimedMonitor> {
  // Ensure due
  await getTestDb()
    .update(monitors)
    .set({ nextCheckAt: new Date(Date.now() - 1_000), leaseOwner: null, leaseExpiresAt: null })
    .where(eq(monitors.id, monitorId))

  const claimed = await claimDueMonitors({
    pool: getTestPool(),
    workerId: WORKER_ID,
    leaseSeconds: 60,
    limit: 10,
  })
  const match = claimed.find((c) => c.id === monitorId)
  if (!match) {
    throw new Error('expected monitor to be claimed')
  }
  return match
}

function upCheck(overrides: Partial<HttpCheckResult> = {}): HttpCheckResult {
  return {
    outcome: 'UP',
    statusCode: 200,
    responseMs: 12,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  }
}

function downCheck(overrides: Partial<HttpCheckResult> = {}): HttpCheckResult {
  return {
    outcome: 'DOWN',
    statusCode: 500,
    responseMs: 15,
    errorCode: 'HTTP_STATUS',
    errorMessage: 'HTTP 500',
    ...overrides,
  }
}

describe('persistCheckResult', () => {
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

  it('applies a new result, advances cadence, and clears the lease', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const claimed = await claimOne(monitor.id)
    const finishedAt = new Date(claimed.scheduledFor.getTime() + 5_000)

    const outcome = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: upCheck(),
      finishedAt,
    })

    expect(outcome.kind).toBe('applied')
    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.status).toBe('UP')
    expect(row!.leaseOwner).toBeNull()
    expect(row!.nextCheckAt.toISOString()).toBe(
      new Date(claimed.scheduledFor.getTime() + 60_000).toISOString(),
    )
    const results = await getTestDb()
      .select()
      .from(checkResults)
      .where(eq(checkResults.monitorId, monitor.id))
    expect(results).toHaveLength(1)
  })

  it('duplicate slot uses ON CONFLICT and never reapplies transitions', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id, { status: 'UNKNOWN' })
    const claimed = await claimOne(monitor.id)

    const first = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: upCheck(),
    })
    expect(first.kind).toBe('applied')

    // Re-lease with the same scheduledFor to simulate a duplicate persist attempt.
    await getTestDb()
      .update(monitors)
      .set({
        leaseOwner: WORKER_ID,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        nextCheckAt: claimed.scheduledFor,
        status: 'UNKNOWN',
        consecutiveSuccesses: 0,
      })
      .where(eq(monitors.id, monitor.id))

    const second = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: downCheck(),
    })
    expect(second.kind).toBe('duplicate')

    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.status).toBe('UNKNOWN')
    expect(row!.leaseOwner).toBeNull()
    const results = await getTestDb()
      .select()
      .from(checkResults)
      .where(eq(checkResults.monitorId, monitor.id))
    expect(results).toHaveLength(1)
    expect(results[0]!.outcome).toBe('UP')
  })

  it('next_check_at mismatch rejects stale persistence', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const claimed = await claimOne(monitor.id)

    await getTestDb()
      .update(monitors)
      .set({ nextCheckAt: new Date(claimed.scheduledFor.getTime() + 1_000) })
      .where(eq(monitors.id, monitor.id))

    const outcome = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: upCheck(),
    })
    expect(outcome.kind).toBe('stale')
    const results = await getTestDb().select().from(checkResults)
    expect(results).toHaveLength(0)
  })

  it('interval update clears a lease and invalidates the result', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const claimed = await claimOne(monitor.id)

    await updateMonitorForUser(user.id, monitor.id, { intervalSeconds: 300 })

    const outcome = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: upCheck(),
    })
    expect(outcome.kind).toBe('stale')
    expect(await getTestDb().select().from(checkResults)).toHaveLength(0)
  })

  it('URL change clears a lease and invalidates the result', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const claimed = await claimOne(monitor.id)

    await updateMonitorForUser(user.id, monitor.id, { url: 'https://changed.example.com' })

    const outcome = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: upCheck(),
    })
    expect(outcome.kind).toBe('stale')
    expect(await getTestDb().select().from(checkResults)).toHaveLength(0)
  })

  it('disabling invalidates the result rather than persisting it', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const claimed = await claimOne(monitor.id)

    await updateMonitorForUser(user.id, monitor.id, { enabled: false })

    const outcome = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: upCheck(),
    })
    expect(outcome.kind).toBe('stale')
    expect(await getTestDb().select().from(checkResults)).toHaveLength(0)
  })

  it('name/isPublic edits do not invalidate a valid result', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const claimed = await claimOne(monitor.id)

    await updateMonitorForUser(user.id, monitor.id, { name: 'Renamed', isPublic: true })

    const outcome = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: upCheck(),
    })
    expect(outcome.kind).toBe('applied')
    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.name).toBe('Renamed')
    expect(row!.isPublic).toBe(true)
    expect(row!.status).toBe('UP')
  })

  it('deleted monitor is a clean no-op', async () => {
    const user = await insertUser()
    const monitor = await insertMonitor(user.id)
    const claimed = await claimOne(monitor.id)
    await getTestDb().delete(monitors).where(eq(monitors.id, monitor.id))

    const outcome = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: upCheck(),
    })
    expect(outcome.kind).toBe('missing')
  })

  it('opens an incident and queues a DOWN outbox event without URL', async () => {
    const user = await insertUser()
    await getTestDb().insert(notificationSettings).values({
      userId: user.id,
      webhookUrl: 'https://hooks.example.com/pulse',
      enabled: true,
    })
    const monitor = await insertMonitor(user.id, {
      status: 'UP',
      consecutiveFailures: 1,
      consecutiveSuccesses: 0,
    })
    const claimed = await claimOne(monitor.id)

    const outcome = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: downCheck(),
    })
    expect(outcome.kind).toBe('applied')

    const openIncidents = await getTestDb()
      .select()
      .from(incidents)
      .where(and(eq(incidents.monitorId, monitor.id), isNull(incidents.resolvedAt)))
    expect(openIncidents).toHaveLength(1)

    const outbox = await getTestDb().select().from(notificationOutbox)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.eventType).toBe('DOWN')
    expect(outbox[0]!.destinationUrl).toBe('https://hooks.example.com/pulse')
    const payload = outbox[0]!.payload as Record<string, unknown>
    expect(payload.eventId).toBe(outbox[0]!.id)
    expect(payload.eventType).toBe('DOWN')
    expect(payload.monitorId).toBe(monitor.id)
    expect(payload.monitorName).toBe('Homepage')
    expect(payload).not.toHaveProperty('url')
    expect(JSON.stringify(payload)).not.toContain('example.com')
  })

  it('handles resolve-without-open-incident invariant', async () => {
    const warn = vi.fn()
    const user = await insertUser()
    const monitor = await insertMonitor(user.id, {
      status: 'DOWN',
      consecutiveFailures: 2,
      consecutiveSuccesses: 1,
    })
    const claimed = await claimOne(monitor.id)

    const outcome = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: upCheck(),
      logger: { info: () => undefined, warn, error: () => undefined },
    })

    expect(outcome.kind).toBe('applied')
    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.status).toBe('UP')
    expect(await getTestDb().select().from(incidents)).toHaveLength(0)
    expect(await getTestDb().select().from(notificationOutbox)).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(
      'invariant_resolve_without_open_incident',
      expect.objectContaining({ monitorId: monitor.id }),
    )
  })

  it('handles open-when-incident-exists invariant without duplicate DOWN', async () => {
    const warn = vi.fn()
    const user = await insertUser()
    await getTestDb().insert(notificationSettings).values({
      userId: user.id,
      webhookUrl: 'https://hooks.example.com/pulse',
      enabled: true,
    })
    const monitor = await insertMonitor(user.id, {
      status: 'UP',
      consecutiveFailures: 1,
      consecutiveSuccesses: 0,
    })
    const [existing] = await getTestDb()
      .insert(incidents)
      .values({ monitorId: monitor.id, startedAt: new Date() })
      .returning()
    const claimed = await claimOne(monitor.id)

    const outcome = await persistCheckResult({
      pool: getTestPool(),
      workerId: WORKER_ID,
      claimed,
      check: downCheck(),
      logger: { info: () => undefined, warn, error: () => undefined },
    })

    expect(outcome.kind).toBe('applied')
    const allIncidents = await getTestDb().select().from(incidents)
    expect(allIncidents).toHaveLength(1)
    expect(allIncidents[0]!.id).toBe(existing!.id)
    expect(await getTestDb().select().from(notificationOutbox)).toHaveLength(0)
    const [row] = await getTestDb().select().from(monitors).where(eq(monitors.id, monitor.id))
    expect(row!.status).toBe('DOWN')
    expect(warn).toHaveBeenCalledWith(
      'invariant_open_incident_exists',
      expect.objectContaining({ incidentId: existing!.id }),
    )
  })
})
