import { createHash, randomBytes } from 'node:crypto'

export const SESSION_TOKEN_BYTES = 32
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000
export const SESSION_COOKIE_NAME = 'pulse_session'

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url')
}

/** Only the SHA-256 digest is stored — never the raw cookie value. */
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('base64url')
}

export function sessionExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_MS)
}
