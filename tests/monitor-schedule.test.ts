import { describe, expect, it } from 'vitest'
import { computeNextCheckAt } from '../shared/monitor-schedule'

describe('computeNextCheckAt', () => {
  it('applies bounded jitter of at most 30 seconds', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    // Math.random is in [0, 1); near-1 yields the inclusive upper bound.
    const next = computeNextCheckAt(3600, from, () => 0.999999)
    expect(next.getTime() - from.getTime()).toBe(30_000)
  })

  it('caps jitter by the monitor interval', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const next = computeNextCheckAt(10, from, () => 0.999999)
    expect(next.getTime() - from.getTime()).toBe(10_000)
  })

  it('can schedule immediately when random is zero', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const next = computeNextCheckAt(60, from, () => 0)
    expect(next.getTime()).toBe(from.getTime())
  })
})
