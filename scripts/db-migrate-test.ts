import { spawnSync } from 'node:child_process'

const REQUIRED_TEST_DB_NAME = 'pulse_test'

function parseDatabaseName(connectionString: string): string {
  const pathname = new URL(connectionString).pathname
  return decodeURIComponent(pathname.replace(/^\//, ''))
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) {
  console.error('TEST_DATABASE_URL is required for db:migrate:test')
  process.exit(1)
}

const databaseName = parseDatabaseName(testDatabaseUrl)
if (databaseName !== REQUIRED_TEST_DB_NAME) {
  console.error(
    `Refusing to migrate: TEST_DATABASE_URL database name must be exactly "${REQUIRED_TEST_DB_NAME}" (got "${databaseName}")`,
  )
  process.exit(1)
}

// drizzle.config.ts reads DATABASE_URL via getEnv(); point it at pulse_test.
const result = spawnSync('npx', ['drizzle-kit', 'migrate'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
  },
})

process.exit(result.status ?? 1)
