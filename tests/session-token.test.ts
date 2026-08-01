import { describe, expect, it } from 'vitest'
import {
  SESSION_TOKEN_BYTES,
  generateSessionToken,
  hashSessionToken,
  sessionExpiryDate,
} from '../shared/session-token'

describe('session tokens', () => {
  it('generates high-entropy raw tokens', () => {
    const token = generateSessionToken()
    // base64url of 32 bytes is 43 characters without padding.
    expect(token.length).toBeGreaterThanOrEqual(43)
    const decoded = Buffer.from(token, 'base64url')
    expect(decoded.length).toBe(SESSION_TOKEN_BYTES)
  })

  it('stores only a hash of the raw token', () => {
    const token = generateSessionToken()
    const hash = hashSessionToken(token)
    expect(hash).not.toBe(token)
    expect(hash).toBe(hashSessionToken(token))
    expect(hash).not.toBe(hashSessionToken(generateSessionToken()))
  })

  it('creates a 14-day expiry', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const expires = sessionExpiryDate(from)
    expect(expires.getTime() - from.getTime()).toBe(14 * 24 * 60 * 60 * 1000)
  })
})
