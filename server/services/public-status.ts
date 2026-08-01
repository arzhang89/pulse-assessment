import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { monitors, users } from '../../db/schema'
import { AppError } from '../utils/errors'

export type PublicStatusMonitor = {
  name: string
  status: 'UNKNOWN' | 'UP' | 'DOWN'
  lastCheckedAt: Date | null
  lastResponseMs: number | null
}

export type PublicStatusPage = {
  slug: string
  monitors: PublicStatusMonitor[]
}

/**
 * Unauthenticated public status page data.
 * Unknown slug → 404. Known slug with no public enabled monitors → empty list.
 */
export async function getPublicStatusBySlug(slug: string): Promise<PublicStatusPage> {
  const db = getDb()
  const [user] = await db
    .select({ id: users.id, statusPageSlug: users.statusPageSlug })
    .from(users)
    .where(eq(users.statusPageSlug, slug))
    .limit(1)

  if (!user) {
    throw new AppError(404, 'NOT_FOUND', 'Status page not found')
  }

  const rows = await db
    .select({
      name: monitors.name,
      status: monitors.status,
      lastCheckedAt: monitors.lastCheckedAt,
      lastResponseMs: monitors.lastResponseMs,
    })
    .from(monitors)
    .where(
      and(eq(monitors.userId, user.id), eq(monitors.enabled, true), eq(monitors.isPublic, true)),
    )
    .orderBy(asc(monitors.name))

  return {
    slug: user.statusPageSlug,
    monitors: rows,
  }
}
