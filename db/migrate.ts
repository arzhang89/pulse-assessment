import { accessSync, constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { getEnv } from '../shared/env.js'

function resolveMigrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(process.cwd(), 'db/migrations'),
    path.resolve(here, '../../db/migrations'),
    path.resolve(here, '../migrations'),
  ]

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.R_OK)
      return candidate
    } catch {
      // try next
    }
  }

  throw new Error('Could not locate db/migrations directory')
}

/**
 * Production migration entry point.
 *
 * Uses drizzle-orm's node-postgres migrator (not drizzle-kit) so the migrate
 * container only needs production dependencies.
 */
async function main(): Promise<void> {
  const env = getEnv()
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  const db = drizzle(pool)
  const migrationsFolder = resolveMigrationsFolder()

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'migrate_start',
      migrationsFolder,
      timestamp: new Date().toISOString(),
    }),
  )

  try {
    await migrate(db, { migrationsFolder })
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'migrate_success',
        timestamp: new Date().toISOString(),
      }),
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'migrate_failed',
        error: error instanceof Error ? error.message : 'unknown',
        timestamp: new Date().toISOString(),
      }),
    )
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'migrate_fatal',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }),
  )
  process.exit(1)
})
