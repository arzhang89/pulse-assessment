import { hostname } from 'node:os'
import { randomBytes } from 'node:crypto'

/**
 * Stable-ish worker identity for lease ownership. Prefer an explicit
 * WORKER_ID; otherwise hostname + short random suffix for multi-instance hosts.
 */
export function createWorkerId(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim()
  }

  const host =
    hostname()
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .slice(0, 48) || 'worker'
  const suffix = randomBytes(4).toString('hex')
  return `${host}-${suffix}`
}
