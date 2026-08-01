import { describe, expect, it } from 'vitest'
import { computeNextCheckAfterResult } from '../shared/monitor-cadence'

describe('computeNextCheckAfterResult', () => {
  it('keeps the scheduled cadence when finishing early', () => {
    const scheduledFor = new Date('2020-01-01T00:00:00.000Z')
    const finishedAt = new Date('2020-01-01T00:00:05.000Z')
    const next = computeNextCheckAfterResult(scheduledFor, 60, finishedAt)
    expect(next.toISOString()).toBe('2020-01-01T00:01:00.000Z')
  })

  it('advances from finishedAt when the check overruns the slot', () => {
    const scheduledFor = new Date('2020-01-01T00:00:00.000Z')
    const finishedAt = new Date('2020-01-01T00:01:30.000Z')
    const next = computeNextCheckAfterResult(scheduledFor, 60, finishedAt)
    expect(next.toISOString()).toBe('2020-01-01T00:02:30.000Z')
  })
})
