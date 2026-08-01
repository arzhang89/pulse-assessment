import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_MAX_ATTEMPTS,
  classifyDeliveryDisposition,
  retryDelayMs,
} from '../worker/src/outbox-retry'

describe('classifyDeliveryDisposition', () => {
  it('treats 2xx as success', () => {
    expect(
      classifyDeliveryDisposition({ transportOk: true, statusCode: 200, errorCode: null }),
    ).toBe('success')
    expect(
      classifyDeliveryDisposition({ transportOk: true, statusCode: 204, errorCode: null }),
    ).toBe('success')
  })

  it('treats 3xx as terminal without following redirects', () => {
    expect(
      classifyDeliveryDisposition({ transportOk: true, statusCode: 301, errorCode: null }),
    ).toBe('terminal')
    expect(
      classifyDeliveryDisposition({ transportOk: true, statusCode: 302, errorCode: null }),
    ).toBe('terminal')
  })

  it('classifies retryable and terminal HTTP statuses', () => {
    expect(
      classifyDeliveryDisposition({ transportOk: true, statusCode: 408, errorCode: null }),
    ).toBe('retryable')
    expect(
      classifyDeliveryDisposition({ transportOk: true, statusCode: 425, errorCode: null }),
    ).toBe('retryable')
    expect(
      classifyDeliveryDisposition({ transportOk: true, statusCode: 429, errorCode: null }),
    ).toBe('retryable')
    expect(
      classifyDeliveryDisposition({ transportOk: true, statusCode: 500, errorCode: null }),
    ).toBe('retryable')
    expect(
      classifyDeliveryDisposition({ transportOk: true, statusCode: 400, errorCode: null }),
    ).toBe('terminal')
    expect(
      classifyDeliveryDisposition({ transportOk: true, statusCode: 404, errorCode: null }),
    ).toBe('terminal')
  })

  it('does not retry forbidden or invalid destinations', () => {
    expect(
      classifyDeliveryDisposition({
        transportOk: false,
        statusCode: null,
        errorCode: 'FORBIDDEN_ADDRESS',
      }),
    ).toBe('terminal')
    expect(
      classifyDeliveryDisposition({
        transportOk: false,
        statusCode: null,
        errorCode: 'INVALID_RESPONSE',
      }),
    ).toBe('terminal')
  })

  it('retries transport failures', () => {
    for (const errorCode of ['DNS_FAILED', 'CONNECT_FAILED', 'TLS_FAILED', 'TIMEOUT']) {
      expect(classifyDeliveryDisposition({ transportOk: false, statusCode: null, errorCode })).toBe(
        'retryable',
      )
    }
  })
})

describe('retryDelayMs', () => {
  it('follows the approved schedule without jitter', () => {
    expect(retryDelayMs(1)).toBe(30_000)
    expect(retryDelayMs(2)).toBe(120_000)
    expect(retryDelayMs(3)).toBe(600_000)
    expect(retryDelayMs(4)).toBe(3_600_000)
    expect(retryDelayMs(8)).toBe(3_600_000)
  })

  it('applies deterministic jitter when a random source is injected', () => {
    expect(retryDelayMs(1, { random: () => 0.5, jitterRatio: 0.1 })).toBe(30_000)
    expect(retryDelayMs(1, { random: () => 1, jitterRatio: 0.1 })).toBe(33_000)
    expect(retryDelayMs(1, { random: () => 0, jitterRatio: 0.1 })).toBe(27_000)
  })

  it('caps attempts at 8', () => {
    expect(NOTIFICATION_MAX_ATTEMPTS).toBe(8)
  })
})
