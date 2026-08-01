import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../../db/schema.js'

const REQUIRED_TEST_DB_NAME = 'pulse_test'

let pool: Pool | undefined
let db: NodePgDatabase<typeof schema> | undefined

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error('TEST_DATABASE_URL is required for integration tests')
  }
  return url
}

function parseDatabaseName(connectionString: string): string {
  const pathname = new URL(connectionString).pathname
  return decodeURIComponent(pathname.replace(/^\//, ''))
}

export function getTestDb(): NodePgDatabase<typeof schema> {
  if (!db) {
    const connectionString = requireTestDatabaseUrl()
    const databaseName = parseDatabaseName(connectionString)

    if (databaseName !== REQUIRED_TEST_DB_NAME) {
      throw new Error(
        `Refusing destructive integration tests: connected database must be exactly "${REQUIRED_TEST_DB_NAME}" (got "${databaseName}")`,
      )
    }

    pool = new Pool({ connectionString })
    db = drizzle(pool, { schema })
  }

  return db
}

export function getTestPool(): Pool {
  if (!pool) {
    getTestDb()
  }
  if (!pool) {
    throw new Error('Test pool was not initialized')
  }
  return pool
}

export async function assertTestDatabaseName(): Promise<void> {
  if (!pool) {
    getTestDb()
  }
  if (!pool) {
    throw new Error('Test pool was not initialized')
  }

  const result = await pool.query<{ current_database: string }>('select current_database()')
  const current = result.rows[0]?.current_database
  if (current !== REQUIRED_TEST_DB_NAME) {
    throw new Error(
      `Refusing destructive integration tests: current_database() is "${current}", expected "${REQUIRED_TEST_DB_NAME}"`,
    )
  }
}

export async function truncateAllTables(): Promise<void> {
  await assertTestDatabaseName()
  if (!pool) {
    throw new Error('Test pool was not initialized')
  }

  await pool.query(`
    truncate table
      notification_outbox,
      notification_settings,
      check_results,
      incidents,
      sessions,
      monitors,
      users
    restart identity cascade
  `)
}

export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = undefined
    db = undefined
  }
}
