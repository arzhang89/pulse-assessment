import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fetch } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { checkResults, incidents, notificationOutbox } from '../db/schema'
import { assertTestDatabaseName, closeTestDb, getTestDb, truncateAllTables } from './helpers/db'
import { TEST_APP_ORIGIN, cookieHeader, getSessionCookie, jsonHeaders } from './helpers/http'
import { ensureNuxtHttpSetup } from './helpers/nuxt-http-setup'

await ensureNuxtHttpSetup()
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function signup(email: string): Promise<string> {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password: 'password123' }),
  })
  expect(response.status).toBe(201)
  const cookie = getSessionCookie(response)
  expect(cookie).not.toBeNull()
  return cookie!.value
}

describe('monitors HTTP API', () => {
  beforeAll(async () => {
    await assertTestDatabaseName()
  })

  beforeEach(async () => {
    await truncateAllTables()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('creates, lists, updates, and deletes monitors for the owner', async () => {
    const token = await signup('owner@example.com')

    const created = await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({
        name: 'Homepage',
        url: 'https://example.com',
        intervalSeconds: 60,
      }),
    })
    expect(created.status).toBe(201)
    const createdBody = (await readJson(created)) as {
      monitor: { id: string; status: string; url: string }
    }
    expect(createdBody.monitor.status).toBe('UNKNOWN')
    expect(createdBody.monitor.url).toBe('https://example.com/')

    const list = await fetch('/api/monitors', {
      headers: { cookie: cookieHeader(token) },
    })
    expect(list.status).toBe(200)
    const listBody = (await readJson(list)) as { monitors: unknown[] }
    expect(listBody.monitors).toHaveLength(1)

    const patched = await fetch(`/api/monitors/${createdBody.monitor.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({ name: 'Renamed', isPublic: true }),
    })
    expect(patched.status).toBe(200)
    await expect(readJson(patched)).resolves.toMatchObject({
      monitor: { name: 'Renamed', isPublic: true, status: 'UNKNOWN' },
    })

    const deleted = await fetch(`/api/monitors/${createdBody.monitor.id}`, {
      method: 'DELETE',
      headers: { origin: TEST_APP_ORIGIN, cookie: cookieHeader(token) },
    })
    expect(deleted.status).toBe(204)
  })

  it('rejects invalid monitor payloads with the stable error shape', async () => {
    const token = await signup('validate@example.com')

    const badInterval = await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({
        name: 'Bad',
        url: 'https://example.com',
        intervalSeconds: 120,
      }),
    })
    expect(badInterval.status).toBe(400)

    const credentials = await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({
        name: 'Bad',
        url: 'https://user:pass@example.com',
        intervalSeconds: 60,
      }),
    })
    expect(credentials.status).toBe(400)

    const blankName = await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({
        name: '   ',
        url: 'https://example.com',
        intervalSeconds: 60,
      }),
    })
    expect(blankName.status).toBe(400)

    const created = await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({
        name: 'Ok',
        url: 'https://example.com',
        intervalSeconds: 60,
      }),
    })
    const createdBody = (await readJson(created)) as { monitor: { id: string } }

    const emptyPatch = await fetch(`/api/monitors/${createdBody.monitor.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({}),
    })
    expect(emptyPatch.status).toBe(400)

    const unknownField = await fetch(`/api/monitors/${createdBody.monitor.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({ name: 'x', status: 'UP' }),
    })
    expect(unknownField.status).toBe(400)
    const unknownBody = (await readJson(unknownField)) as { error: { code: string } }
    expect(unknownBody.error.code).toBe('VALIDATION_ERROR')
    expect(JSON.stringify(unknownBody).toLowerCase()).not.toContain('constraint')
  })

  it('returns the same 404 for malformed, missing, and other-tenant monitors', async () => {
    const tokenA = await signup('a@example.com')
    const tokenB = await signup('b@example.com')

    const created = await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(tokenB) },
      body: JSON.stringify({
        name: 'B only',
        url: 'https://example.com',
        intervalSeconds: 60,
      }),
    })
    const createdBody = (await readJson(created)) as { monitor: { id: string } }

    const cases = [
      await fetch('/api/monitors/not-a-uuid', {
        headers: { cookie: cookieHeader(tokenA) },
      }),
      await fetch(`/api/monitors/${randomUUID()}`, {
        headers: { cookie: cookieHeader(tokenA) },
      }),
      await fetch(`/api/monitors/${createdBody.monitor.id}`, {
        headers: { cookie: cookieHeader(tokenA) },
      }),
      await fetch(`/api/monitors/${createdBody.monitor.id}`, {
        method: 'PATCH',
        headers: { ...jsonHeaders(), cookie: cookieHeader(tokenA) },
        body: JSON.stringify({ name: 'stolen' }),
      }),
      await fetch(`/api/monitors/${createdBody.monitor.id}`, {
        method: 'DELETE',
        headers: { origin: TEST_APP_ORIGIN, cookie: cookieHeader(tokenA) },
      }),
    ]

    for (const response of cases) {
      expect(response.status).toBe(404)
      await expect(readJson(response)).resolves.toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'Monitor not found',
          fields: {},
        },
      })
    }

    const list = await fetch('/api/monitors', {
      headers: { cookie: cookieHeader(tokenA) },
    })
    const listBody = (await readJson(list)) as { monitors: unknown[] }
    expect(listBody.monitors).toHaveLength(0)
  })

  it('resets current state on URL change but preserves check history', async () => {
    const token = await signup('history@example.com')
    const created = await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({
        name: 'Svc',
        url: 'https://example.com/a',
        intervalSeconds: 60,
      }),
    })
    const createdBody = (await readJson(created)) as { monitor: { id: string } }
    const db = getTestDb()

    await db.insert(checkResults).values({
      monitorId: createdBody.monitor.id,
      scheduledFor: new Date('2026-01-01T00:00:00Z'),
      checkedAt: new Date('2026-01-01T00:00:01Z'),
      outcome: 'UP',
      responseMs: 12,
      statusCode: 200,
    })

    const patched = await fetch(`/api/monitors/${createdBody.monitor.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({ url: 'https://example.com/b' }),
    })
    expect(patched.status).toBe(200)
    await expect(readJson(patched)).resolves.toMatchObject({
      monitor: {
        url: 'https://example.com/b',
        status: 'UNKNOWN',
        lastCheckedAt: null,
      },
    })

    const history = await db
      .select()
      .from(checkResults)
      .where(eq(checkResults.monitorId, createdBody.monitor.id))
    expect(history).toHaveLength(1)
  })

  it('returns owner-scoped history newest first with bounded limit', async () => {
    const tokenA = await signup('hist-a@example.com')
    const tokenB = await signup('hist-b@example.com')
    const created = await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(tokenA) },
      body: JSON.stringify({
        name: 'Hist',
        url: 'https://example.com',
        intervalSeconds: 60,
      }),
    })
    const createdBody = (await readJson(created)) as { monitor: { id: string } }
    const db = getTestDb()

    await db.insert(checkResults).values([
      {
        monitorId: createdBody.monitor.id,
        scheduledFor: new Date('2026-01-01T00:00:00Z'),
        checkedAt: new Date('2026-01-01T00:00:01Z'),
        outcome: 'UP',
        responseMs: 10,
        statusCode: 200,
      },
      {
        monitorId: createdBody.monitor.id,
        scheduledFor: new Date('2026-01-01T00:01:00Z'),
        checkedAt: new Date('2026-01-01T00:01:02Z'),
        outcome: 'DOWN',
        responseMs: 20,
        statusCode: 500,
        errorCode: 'HTTP_STATUS',
        errorMessage: 'HTTP 500',
      },
    ])

    const empty = await fetch(`/api/monitors/${createdBody.monitor.id}/history`, {
      headers: { cookie: cookieHeader(tokenA) },
    })
    // With results present — also cover empty via other monitor
    expect(empty.status).toBe(200)
    const body = (await readJson(empty)) as {
      results: Array<{ checkedAt: string; outcome: string; statusCode: number | null }>
    }
    expect(body.results).toHaveLength(2)
    expect(body.results[0]!.outcome).toBe('DOWN')
    expect(body.results[0]!.statusCode).toBe(500)
    expect(body.results[1]!.outcome).toBe('UP')

    const limited = await fetch(`/api/monitors/${createdBody.monitor.id}/history?limit=1`, {
      headers: { cookie: cookieHeader(tokenA) },
    })
    const limitedBody = (await readJson(limited)) as { results: unknown[] }
    expect(limitedBody.results).toHaveLength(1)

    const badLimit = await fetch(`/api/monitors/${createdBody.monitor.id}/history?limit=0`, {
      headers: { cookie: cookieHeader(tokenA) },
    })
    expect(badLimit.status).toBe(400)

    const other = await fetch(`/api/monitors/${createdBody.monitor.id}/history`, {
      headers: { cookie: cookieHeader(tokenB) },
    })
    expect(other.status).toBe(404)

    const missing = await fetch(`/api/monitors/${randomUUID()}/history`, {
      headers: { cookie: cookieHeader(tokenA) },
    })
    expect(missing.status).toBe(404)

    const fresh = await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(tokenA) },
      body: JSON.stringify({
        name: 'Empty',
        url: 'https://example.com/empty',
        intervalSeconds: 60,
      }),
    })
    const freshBody = (await readJson(fresh)) as { monitor: { id: string } }
    const noChecks = await fetch(`/api/monitors/${freshBody.monitor.id}/history`, {
      headers: { cookie: cookieHeader(tokenA) },
    })
    expect(noChecks.status).toBe(200)
    await expect(readJson(noChecks)).resolves.toEqual({ results: [] })
  })

  it('cascades delete through incidents and pending outbox rows', async () => {
    const token = await signup('cascade@example.com')
    const created = await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({
        name: 'Svc',
        url: 'https://example.com',
        intervalSeconds: 60,
      }),
    })
    const createdBody = (await readJson(created)) as { monitor: { id: string } }
    const db = getTestDb()

    const [incident] = await db
      .insert(incidents)
      .values({
        monitorId: createdBody.monitor.id,
        startedAt: new Date(),
      })
      .returning()

    await db.insert(notificationOutbox).values({
      incidentId: incident!.id,
      destinationUrl: 'https://hooks.example.com',
      eventType: 'DOWN',
      payload: { kind: 'DOWN' },
    })

    const deleted = await fetch(`/api/monitors/${createdBody.monitor.id}`, {
      method: 'DELETE',
      headers: { origin: TEST_APP_ORIGIN, cookie: cookieHeader(token) },
    })
    expect(deleted.status).toBe(204)

    expect(await db.select().from(incidents)).toHaveLength(0)
    expect(await db.select().from(notificationOutbox)).toHaveLength(0)
  })
})
