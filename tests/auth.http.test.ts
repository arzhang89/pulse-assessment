import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fetch } from '@nuxt/test-utils/e2e'
import { assertTestDatabaseName, closeTestDb, truncateAllTables } from './helpers/db'
import { TEST_APP_ORIGIN, cookieHeader, getSessionCookie, jsonHeaders } from './helpers/http'
import { ensureNuxtHttpSetup } from './helpers/nuxt-http-setup'

await ensureNuxtHttpSetup()

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

describe('auth HTTP API', () => {
  beforeAll(async () => {
    await assertTestDatabaseName()
  })

  beforeEach(async () => {
    await truncateAllTables()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('rejects state-changing requests without Origin', async () => {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: {
        code: 'ORIGIN_FORBIDDEN',
        message: 'Origin is not allowed',
        fields: {},
      },
    })
  })

  it('rejects JSON endpoints without application/json', async () => {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: {
        origin: TEST_APP_ORIGIN,
        'content-type': 'text/plain',
      },
      body: '{"email":"a@example.com","password":"password123"}',
    })

    expect(response.status).toBe(415)
    await expect(readJson(response)).resolves.toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type must be application/json',
        fields: {},
      },
    })
  })

  it('signs up, sets a secure session cookie, and resolves /api/auth/me', async () => {
    const signup = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'User@Example.com', password: 'password123' }),
    })

    expect(signup.status).toBe(201)
    const signupBody = (await readJson(signup)) as {
      user: { email: string; statusPageSlug: string }
    }
    expect(signupBody.user.email).toBe('user@example.com')
    expect(signupBody.user.statusPageSlug).toMatch(/^[A-Za-z0-9_-]+$/)

    const cookie = getSessionCookie(signup)
    expect(cookie).not.toBeNull()
    expect(cookie!.value.length).toBeGreaterThan(20)
    expect(cookie!.attributes.httponly).toBe(true)
    expect(cookie!.attributes.path).toBe('/')
    expect(String(cookie!.attributes.samesite).toLowerCase()).toBe('lax')
    expect(cookie!.attributes.secure).toBeUndefined()
    expect(Number(cookie!.attributes['max-age'])).toBe(14 * 24 * 60 * 60)

    const me = await fetch('/api/auth/me', {
      headers: { cookie: cookieHeader(cookie!.value) },
    })
    expect(me.status).toBe(200)
    await expect(readJson(me)).resolves.toMatchObject({
      user: { email: 'user@example.com' },
    })
  })

  it('returns EMAIL_TAKEN for duplicate signup without SQL details', async () => {
    await fetch('/api/auth/signup', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'dup@example.com', password: 'password123' }),
    })

    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'dup@example.com', password: 'password123' }),
    })

    expect(response.status).toBe(409)
    const body = (await readJson(response)) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('EMAIL_TAKEN')
    expect(JSON.stringify(body).toLowerCase()).not.toContain('constraint')
    expect(JSON.stringify(body).toLowerCase()).not.toContain('sql')
  })

  it('returns the same INVALID_CREDENTIALS for unknown email and bad password', async () => {
    await fetch('/api/auth/signup', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'known@example.com', password: 'password123' }),
    })

    const unknown = await fetch('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'missing@example.com', password: 'password123' }),
    })
    const badPassword = await fetch('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'known@example.com', password: 'wrong-password' }),
    })

    expect(unknown.status).toBe(401)
    expect(badPassword.status).toBe(401)
    await expect(readJson(unknown)).resolves.toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        fields: {},
      },
    })
    await expect(readJson(badPassword)).resolves.toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        fields: {},
      },
    })
  })

  it('logs out by clearing the cookie and rejecting subsequent /me', async () => {
    const signup = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'logout@example.com', password: 'password123' }),
    })
    const cookie = getSessionCookie(signup)!

    const logout = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        origin: TEST_APP_ORIGIN,
        cookie: cookieHeader(cookie.value),
      },
    })
    expect(logout.status).toBe(204)

    const cleared = getSessionCookie(logout)
    expect(cleared).not.toBeNull()
    expect(cleared!.value === '' || Number(cleared!.attributes['max-age']) === 0).toBe(true)

    const me = await fetch('/api/auth/me', {
      headers: { cookie: cookieHeader(cookie.value) },
    })
    expect(me.status).toBe(401)
  })

  it('rejects unauthenticated private access', async () => {
    const response = await fetch('/api/auth/me')
    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        fields: {},
      },
    })
  })
})
