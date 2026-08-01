import { describe, expect, it } from 'vitest'
import { claimCapacity } from '../worker/src/claim'
import { databaseErrorBackoffMs } from '../worker/src/backoff'

describe('claimCapacity', () => {
  it('returns free slots under concurrency', () => {
    expect(claimCapacity(20, 0, 0)).toBe(20)
    expect(claimCapacity(20, 5, 3)).toBe(12)
    expect(claimCapacity(20, 20, 0)).toBe(0)
    expect(claimCapacity(20, 15, 10)).toBe(0)
  })
})

describe('databaseErrorBackoffMs', () => {
  it('grows exponentially and caps', () => {
    expect(databaseErrorBackoffMs(0, { baseMs: 100, maxMs: 800, random: () => 0.5 })).toBe(100)
    expect(databaseErrorBackoffMs(1, { baseMs: 100, maxMs: 800, random: () => 0.5 })).toBe(200)
    expect(databaseErrorBackoffMs(2, { baseMs: 100, maxMs: 800, random: () => 0.5 })).toBe(400)
    expect(databaseErrorBackoffMs(10, { baseMs: 100, maxMs: 800, random: () => 0.5 })).toBe(800)
  })

  it('applies jitter around the nominal delay', () => {
    const low = databaseErrorBackoffMs(0, { baseMs: 1000, maxMs: 30_000, random: () => 0 })
    const high = databaseErrorBackoffMs(0, { baseMs: 1000, maxMs: 30_000, random: () => 1 })
    expect(low).toBe(900)
    expect(high).toBe(1100)
  })
})
