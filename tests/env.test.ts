import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('getEnv', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('parses a fully valid environment', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/pulse'
    process.env.NODE_ENV = 'test'
    process.env.NUXT_PUBLIC_APP_URL = 'http://localhost:3000'

    const { getEnv } = await import('../shared/env')
    const env = getEnv()

    expect(env).toEqual({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/pulse',
      NODE_ENV: 'test',
      NUXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
  })

  it('defaults NODE_ENV to development when unset', async () => {
    delete process.env.NODE_ENV
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/pulse'
    process.env.NUXT_PUBLIC_APP_URL = 'http://localhost:3000'

    const { getEnv } = await import('../shared/env')

    expect(getEnv().NODE_ENV).toBe('development')
  })

  it('throws a descriptive error when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL
    process.env.NUXT_PUBLIC_APP_URL = 'http://localhost:3000'

    const { getEnv } = await import('../shared/env')

    expect(() => getEnv()).toThrow(/DATABASE_URL/)
  })

  it('throws a descriptive error when NUXT_PUBLIC_APP_URL is not a valid URL', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/pulse'
    process.env.NUXT_PUBLIC_APP_URL = 'not-a-url'

    const { getEnv } = await import('../shared/env')

    expect(() => getEnv()).toThrow(/NUXT_PUBLIC_APP_URL/)
  })

  it('rejects an invalid NODE_ENV value', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/pulse'
    process.env.NUXT_PUBLIC_APP_URL = 'http://localhost:3000'
    process.env.NODE_ENV = 'staging'

    const { getEnv } = await import('../shared/env')

    expect(() => getEnv()).toThrow(/NODE_ENV/)
  })

  it('caches the parsed result across repeated calls', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/pulse'
    process.env.NUXT_PUBLIC_APP_URL = 'http://localhost:3000'

    const { getEnv } = await import('../shared/env')
    const first = getEnv()

    // Mutating process.env after the first call must not change the
    // cached result — this documents the intentional caching behavior.
    process.env.NUXT_PUBLIC_APP_URL = 'http://changed.example.com'
    const second = getEnv()

    expect(second).toBe(first)
    expect(second.NUXT_PUBLIC_APP_URL).toBe('http://localhost:3000')
  })
})
