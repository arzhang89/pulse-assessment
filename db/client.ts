import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { getEnv } from '../shared/env.js'
import * as schema from './schema.js'

/**
 * Lazy shared `pg` pool and Drizzle instance, used by both the Nuxt/Nitro
 * server process and the standalone worker process.
 *
 * Initialization is deferred until the first call so `nuxt build` / Docker
 * image builds do not require a live `DATABASE_URL`. Runtime startup still
 * fails fast via the env-validation plugin (web) or `getEnv()` in the
 * worker entry point before any query runs.
 */
let poolInstance: Pool | undefined
let dbInstance: NodePgDatabase<typeof schema> | undefined

export function getPool(): Pool {
  if (!poolInstance) {
    poolInstance = new Pool({ connectionString: getEnv().DATABASE_URL })
  }
  return poolInstance
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema })
  }
  return dbInstance
}
