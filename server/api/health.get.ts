import { sql } from 'drizzle-orm'
import { getDb } from '../../db/client'

/**
 * Liveness/readiness probe.
 *
 * Runs a trivial round-trip query (`select 1`) rather than just returning
 * a static 200, so a reachable-but-broken database (down, wrong
 * credentials, network partition) shows up here instead of only surfacing
 * later as a confusing failure elsewhere. On failure this deliberately
 * returns a generic body — the underlying error is logged server-side
 * only, since this is effectively a public endpoint and must never leak
 * connection strings, driver errors, or other internal details.
 */
export default defineEventHandler(async (event) => {
  try {
    await getDb().execute(sql`select 1`)
    return {
      status: 'ok' as const,
      database: 'up' as const,
    }
  } catch (error) {
    console.error('[health] database check failed', error)
    setResponseStatus(event, 503)
    return {
      status: 'unavailable' as const,
      database: 'down' as const,
    }
  }
})
