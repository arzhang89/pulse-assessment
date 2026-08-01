import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fetch } from '@nuxt/test-utils/e2e'
import { assertTestDatabaseName, closeTestDb, truncateAllTables } from './helpers/db'
import { cookieHeader, getSessionCookie, jsonHeaders } from './helpers/http'
import { ensureNuxtHttpSetup } from './helpers/nuxt-http-setup'

await ensureNuxtHttpSetup()

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function signup(email: string): Promise<{ token: string; slug: string }> {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password: 'password123' }),
  })
  expect(response.status).toBe(201)
  const cookie = getSessionCookie(response)
  const body = (await readJson(response)) as { user: { statusPageSlug: string } }
  return { token: cookie!.value, slug: body.user.statusPageSlug }
}

describe('public status page HTTP API', () => {
  beforeAll(async () => {
    await assertTestDatabaseName()
  })

  beforeEach(async () => {
    await truncateAllTables()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('returns 404 for unknown slugs', async () => {
    const response = await fetch('/api/public/status/does-not-exist')
    expect(response.status).toBe(404)
  })

  it('returns an empty list for a valid slug with no public monitors', async () => {
    const { slug } = await signup('empty@example.com')
    const response = await fetch(`/api/public/status/${slug}`)
    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      page: { slug, monitors: [] },
    })
  })

  it('exposes only enabled public monitors and omits private fields', async () => {
    const { token, slug } = await signup('pub@example.com')

    await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({
        name: 'Public API',
        url: 'https://example.com/public',
        intervalSeconds: 60,
        enabled: true,
        isPublic: true,
      }),
    })
    await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({
        name: 'Private API',
        url: 'https://example.com/private',
        intervalSeconds: 60,
        enabled: true,
        isPublic: false,
      }),
    })
    await fetch('/api/monitors', {
      method: 'POST',
      headers: { ...jsonHeaders(), cookie: cookieHeader(token) },
      body: JSON.stringify({
        name: 'Disabled public',
        url: 'https://example.com/disabled',
        intervalSeconds: 60,
        enabled: false,
        isPublic: true,
      }),
    })

    const response = await fetch(`/api/public/status/${slug}`)
    expect(response.status).toBe(200)
    const body = (await readJson(response)) as {
      page: {
        slug: string
        monitors: Array<Record<string, unknown>>
      }
    }
    expect(body.page.slug).toBe(slug)
    expect(body.page.monitors).toHaveLength(1)
    expect(body.page.monitors[0]).toMatchObject({
      name: 'Public API',
      status: 'UNKNOWN',
    })
    expect(body.page.monitors[0]).toHaveProperty('lastCheckedAt')
    expect(body.page.monitors[0]).toHaveProperty('lastResponseMs')
    expect(body.page.monitors[0]).not.toHaveProperty('url')
    expect(body.page.monitors[0]).not.toHaveProperty('statusCode')
    expect(body.page.monitors[0]).not.toHaveProperty('errorCode')
    expect(JSON.stringify(body)).not.toContain('example.com')
    expect(JSON.stringify(body)).not.toContain('pub@example.com')
  })

  it('does not require authentication', async () => {
    const { slug } = await signup('open@example.com')
    const response = await fetch(`/api/public/status/${slug}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
