import { getEnv } from '../../shared/env.js'
import { getPool } from '../../db/client.js'

/**
 * Worker entry point (Commit 1 boundary).
 *
 * Claim SQL, concurrency, and shutdown primitives live under worker/src/,
 * but this production entry must NOT claim real monitors until the checker
 * and persistence pipeline exist (Commit 3). Until then this process only
 * validates env and proves database connectivity, then exits.
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
