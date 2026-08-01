import { Client } from 'pg'

const REQUIRED_TEST_DB_NAME = 'pulse_test'
const ADMIN_DB_NAME = 'postgres'

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error('TEST_DATABASE_URL is required for db:test:setup')
  }
  return url
}

function parseDatabaseName(connectionString: string): string {
  let pathname: string
  try {
    pathname = new URL(connectionString).pathname
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL connection URL')
  }

  const name = decodeURIComponent(pathname.replace(/^\//, ''))
  if (!name) {
    throw new Error('TEST_DATABASE_URL must include a database name')
  }
  return name
}

function toAdminConnectionString(connectionString: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${ADMIN_DB_NAME}`
  return url.toString()
}

async function main(): Promise<void> {
  const testDatabaseUrl = requireTestDatabaseUrl()
  const databaseName = parseDatabaseName(testDatabaseUrl)

  if (databaseName !== REQUIRED_TEST_DB_NAME) {
    throw new Error(
      `Refusing to continue: TEST_DATABASE_URL database name must be exactly "${REQUIRED_TEST_DB_NAME}" (got "${databaseName}")`,
    )
  }

  const adminUrl = toAdminConnectionString(testDatabaseUrl)
  const client = new Client({ connectionString: adminUrl })

  await client.connect()
  try {
    const existing = await client.query<{ exists: boolean }>(
      `select exists(
         select 1 from pg_database where datname = $1
       ) as exists`,
      [REQUIRED_TEST_DB_NAME],
    )

    if (existing.rows[0]?.exists) {
      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'test database already exists',
          database: REQUIRED_TEST_DB_NAME,
        }),
      )
      return
    }

    // CREATE DATABASE cannot run inside a transaction block.
    await client.query(`CREATE DATABASE ${REQUIRED_TEST_DB_NAME}`)
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'created test database',
        database: REQUIRED_TEST_DB_NAME,
      }),
    )
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
