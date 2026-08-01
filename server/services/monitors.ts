import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { monitors } from '../../db/schema'
import { computeNextCheckAt } from '../../shared/monitor-schedule'
import type { CreateMonitorInput, UpdateMonitorInput } from '../../shared/validation/monitors'
import { AppError } from '../utils/errors'

export type PublicMonitor = {
  id: string
  name: string
  url: string
  intervalSeconds: number
  enabled: boolean
  isPublic: boolean
  status: 'UNKNOWN' | 'UP' | 'DOWN'
  lastCheckedAt: Date | null
  lastResponseMs: number | null
  lastStatusCode: number | null
  createdAt: Date
  updatedAt: Date
}

function toPublicMonitor(row: typeof monitors.$inferSelect): PublicMonitor {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    intervalSeconds: row.intervalSeconds,
    enabled: row.enabled,
    isPublic: row.isPublic,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt,
    lastResponseMs: row.lastResponseMs,
    lastStatusCode: row.lastStatusCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * A monitor is a logical service whose endpoint may change over time.
 * URL changes therefore keep historical check_results attached to the same row.
 */
export async function listMonitorsForUser(userId: string): Promise<PublicMonitor[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(monitors)
    .where(eq(monitors.userId, userId))
    .orderBy(asc(monitors.createdAt))
  return rows.map(toPublicMonitor)
}

export async function getMonitorForUser(userId: string, monitorId: string): Promise<PublicMonitor> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(monitors)
    .where(and(eq(monitors.id, monitorId), eq(monitors.userId, userId)))
    .limit(1)

  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found')
  }

  return toPublicMonitor(row)
}

export async function createMonitorForUser(
  userId: string,
  input: CreateMonitorInput,
): Promise<PublicMonitor> {
  const db = getDb()
  const now = new Date()
  const [row] = await db
    .insert(monitors)
    .values({
      userId,
      name: input.name,
      url: input.url,
      intervalSeconds: input.intervalSeconds,
      enabled: input.enabled,
      isPublic: input.isPublic,
      status: 'UNKNOWN',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      nextCheckAt: computeNextCheckAt(input.intervalSeconds, now),
      updatedAt: now,
    })
    .returning()

  if (!row) {
    throw new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred')
  }

  return toPublicMonitor(row)
}

export async function updateMonitorForUser(
  userId: string,
  monitorId: string,
  input: UpdateMonitorInput,
): Promise<PublicMonitor> {
  const db = getDb()
  const [existing] = await db
    .select()
    .from(monitors)
    .where(and(eq(monitors.id, monitorId), eq(monitors.userId, userId)))
    .limit(1)

  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found')
  }

  const now = new Date()
  const patch: Partial<typeof monitors.$inferInsert> = {
    updatedAt: now,
  }

  if (input.name !== undefined) {
    patch.name = input.name
  }
  if (input.isPublic !== undefined) {
    patch.isPublic = input.isPublic
  }

  const urlChanged = input.url !== undefined && input.url !== existing.url
  const intervalChanged =
    input.intervalSeconds !== undefined && input.intervalSeconds !== existing.intervalSeconds
  const enabling = input.enabled === true && existing.enabled === false
  const disabling = input.enabled === false && existing.enabled === true

  if (input.url !== undefined) {
    patch.url = input.url
  }
  if (input.intervalSeconds !== undefined) {
    patch.intervalSeconds = input.intervalSeconds
  }
  if (input.enabled !== undefined) {
    patch.enabled = input.enabled
  }

  // URL/interval/enable changes invalidate in-flight work by clearing the
  // lease pair and advancing next_check_at (except disable, which only clears).
  if (urlChanged) {
    patch.status = 'UNKNOWN'
    patch.consecutiveFailures = 0
    patch.consecutiveSuccesses = 0
    patch.lastCheckedAt = null
    patch.lastResponseMs = null
    patch.lastStatusCode = null
    patch.lastErrorCode = null
    patch.lastErrorMessage = null
    patch.leaseOwner = null
    patch.leaseExpiresAt = null
    patch.nextCheckAt = computeNextCheckAt(input.intervalSeconds ?? existing.intervalSeconds, now)
  } else if (intervalChanged) {
    patch.leaseOwner = null
    patch.leaseExpiresAt = null
    patch.nextCheckAt = computeNextCheckAt(input.intervalSeconds!, now)
  }

  if (disabling) {
    patch.leaseOwner = null
    patch.leaseExpiresAt = null
  }

  if (enabling) {
    patch.leaseOwner = null
    patch.leaseExpiresAt = null
    patch.nextCheckAt = computeNextCheckAt(input.intervalSeconds ?? existing.intervalSeconds, now)
  }

  const [row] = await db
    .update(monitors)
    .set(patch)
    .where(and(eq(monitors.id, monitorId), eq(monitors.userId, userId)))
    .returning()

  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found')
  }

  return toPublicMonitor(row)
}

export async function deleteMonitorForUser(userId: string, monitorId: string): Promise<void> {
  const db = getDb()
  const deleted = await db
    .delete(monitors)
    .where(and(eq(monitors.id, monitorId), eq(monitors.userId, userId)))
    .returning({ id: monitors.id })

  if (deleted.length === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found')
  }
}
