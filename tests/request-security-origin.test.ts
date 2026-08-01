import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const ORIGINAL_ENV = { ...process.env }

function eventWithOrigin(origin: string | undefined): H3Event {
  return {
    node: {
      req: {
        headers: origin ? { origin } : {},
      },
    },
  } as unknown as H3Event
}

describe('trusted Origin uses runtime NUXT_PUBLIC_APP_URL', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/pulse'
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('accepts the configured production origin and rejects localhost mismatch', async () => {
    process.env.NUXT_PUBLIC_APP_URL = 'https://pulse.example.com'

    const { assertTrustedOrigin } = await import('../server/utils/request-security')
    const { AppError } = await import('../server/utils/errors')

    expect(() => assertTrustedOrigin(eventWithOrigin('https://pulse.example.com'))).not.toThrow()

    try {
      assertTrustedOrigin(eventWithOrigin('http://localhost:3000'))
      expect.fail('expected ORIGIN_FORBIDDEN')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as InstanceType<typeof AppError>).code).toBe('ORIGIN_FORBIDDEN')
    }
  })
})
