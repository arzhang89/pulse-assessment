import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('getWorkerConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/pulse'
    process.env.NODE_ENV = 'test'
    process.env.NUXT_PUBLIC_APP_URL = 'http://localhost:3000'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('applies approved defaults', async () => {
    const { getWorkerConfig } = await import('../worker/src/config')
    const config = getWorkerConfig(process.env)

    expect(config.concurrency).toBe(20)
    expect(config.pollIntervalMs).toBe(1_000)
    expect(config.leaseSeconds).toBe(60)
    expect(config.shutdownGraceMs).toBe(60_000)
  })

  it('rejects a lease that does not exceed timeout plus margin', async () => {
    process.env.WORKER_LEASE_SECONDS = '30'
    const { getWorkerConfig } = await import('../worker/src/config')

    expect(() => getWorkerConfig(process.env)).toThrow(/WORKER_LEASE_SECONDS/)
  })

  it('accepts a lease just above the minimum margin', async () => {
    process.env.WORKER_LEASE_SECONDS = '36'
    const { getWorkerConfig } = await import('../worker/src/config')

    expect(getWorkerConfig(process.env).leaseSeconds).toBe(36)
  })
})
