import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fetch } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { notificationSettings } from '../db/schema'
import { assertTestDatabaseName, closeTestDb, getTestDb, truncateAllTables } from './helpers/db'
import { TEST_APP_ORIGIN, cookieHeader, getSessionCookie, jsonHeaders } from './helpers/http'
import { ensureNuxtHttpSetup } from './helpers/nuxt-http-setup'

await ensureNuxtHttpSetup()

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password: 'password123' }),
  })
  expect(response.status).toBe(201)
  const cookie = getSessionCookie(response)
  expect(cookie).not.toBeNull()
  const body = (await readJson(response)) as { user: { id: string } }
  return { token: cookie!.value, userId: body.user.id }
}

describe('notification settings HTTP API', () => {
  beforeAll(async () => {
    await assertTestDatabaseName()
  })

  beforeEach(async () => {
    await truncateAllTables()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('rejects unauthenticated access', async () => {
    const get = await fetch('/api/notification-settings')
    expect(get.status).toBe(401)

    const put = await fetch('/api/notification-settings', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com', enabled: true }),
    })
    expect(put.status).toBe(401)
  })

  it('returns null/false when no settings row exists', async () => {
    const { token } = await signup('a@example.com')
    const response = await fetch('/api/notification-settings', {
      headers: { cookie: cookieHeader(token) },
    })
    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      settings: { webhookUrl: null, enabled: false },
    })
  })

  it('isolates settings between users', async () => {
    const a = await signup('a@example.com')
    const b = await signup('b@example.com')

    await fetch('/api/notification-settings', {
      method: 'PUT',
      headers: { ...jsonHeaders(), cookie: cookieHeader(a.token) },
      body: JSON.stringify({ webhookUrl: 'https://hooks.a.example.com', enabled: true }),
    })

    const bGet = await fetch('/api/notification-settings', {
      headers: { cookie: cookieHeader(b.token) },
    })
    await expect(readJson(bGet)).resolves.toEqual({
      settings: { webhookUrl: null, enabled: false },
    })
  })

  it('accepts valid HTTP/HTTPS URLs and normalizes them', async () => {
    const { token, userId } = await signup('a@example.com')
    const response = await fetch('/api/notification-settings', {
      method: 'PUT',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com/pulse', enabled: true }),
    })
    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      settings: { webhookUrl: 'https://hooks.example.com/pulse', enabled: true },
    })

    const [row] = await getTestDb()
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
    expect(row!.webhookUrl).toBe('https://hooks.example.com/pulse')
  })

  it('rejects credentials, fragments via normalize, non-HTTP schemes, and unknown fields', async () => {
    const { token } = await signup('a@example.com')

    for (const body of [
      { webhookUrl: 'https://user:pass@hooks.example.com', enabled: true },
      { webhookUrl: 'ftp://hooks.example.com', enabled: true },
      { webhookUrl: 'https://hooks.example.com', enabled: true, extra: true },
      { webhookUrl: null, enabled: true },
    ]) {
      const response = await fetch('/api/notification-settings', {
        method: 'PUT',
        headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
    }
  })

  it('enforces Origin and JSON Content-Type', async () => {
    const { token } = await signup('a@example.com')

    const noOrigin = await fetch('/api/notification-settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: cookieHeader(token),
      },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com', enabled: true }),
    })
    expect(noOrigin.status).toBe(403)

    const badOrigin = await fetch('/api/notification-settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://evil.example',
        cookie: cookieHeader(token),
      },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com', enabled: true }),
    })
    expect(badOrigin.status).toBe(403)

    const badType = await fetch('/api/notification-settings', {
      method: 'PUT',
      headers: {
        'content-type': 'text/plain',
        origin: TEST_APP_ORIGIN,
        cookie: cookieHeader(token),
      },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com', enabled: true }),
    })
    expect(badType.status).toBe(415)
  })

  it('disables future creation while keeping a saved URL', async () => {
    const { token, userId } = await signup('a@example.com')
    await fetch('/api/notification-settings', {
      method: 'PUT',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com', enabled: true }),
    })

    const disabled = await fetch('/api/notification-settings', {
      method: 'PUT',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com', enabled: false }),
    })
    expect(disabled.status).toBe(200)
    await expect(readJson(disabled)).resolves.toEqual({
      settings: { webhookUrl: 'https://hooks.example.com/', enabled: false },
    })

    const [row] = await getTestDb()
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
    expect(row!.enabled).toBe(false)
  })

  it('deletes the settings row when disabled with null URL', async () => {
    const { token, userId } = await signup('a@example.com')
    await fetch('/api/notification-settings', {
      method: 'PUT',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({ webhookUrl: 'https://hooks.example.com', enabled: true }),
    })

    const cleared = await fetch('/api/notification-settings', {
      method: 'PUT',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({ webhookUrl: null, enabled: false }),
    })
    expect(cleared.status).toBe(200)
    await expect(readJson(cleared)).resolves.toEqual({
      settings: { webhookUrl: null, enabled: false },
    })

    const rows = await getTestDb()
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
    expect(rows).toHaveLength(0)
  })
})
