import { getEnv } from '../../shared/env.js'
import { getPool } from '../../db/client.js'

/**
 * Phase 1 worker entry point.
 *
 * This intentionally does NOT schedule or run checks yet. It only proves
 * that the worker can validate its own environment (independently of the
 * Nuxt app) and reach PostgreSQL through the same shared `db/client`
 * module used by the server. Scheduling, leasing, and check execution are
 * added in a later phase.
 *
 * By design this process runs once and exits — it must not loop or be
 * configured to auto-restart, so failures are visible immediately rather
 * than hidden behind a restart policy.
 */
async function main(): Promise<void> {
  getEnv()
  const pool = getPool()

  try {
    const result = await pool.query('select 1 as ok')
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'worker database connectivity check succeeded',
        result: result.rows[0],
        timestamp: new Date().toISOString(),
      }),
    )
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'worker database connectivity check failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }),
  )
  process.exit(1)
})
