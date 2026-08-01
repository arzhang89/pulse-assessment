import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { TEST_APP_ORIGIN } from './http'

let setupPromise: Promise<void> | undefined

/** Start the Nuxt test server once for all HTTP contract files. */
export function ensureNuxtHttpSetup(): Promise<void> {
  if (!setupPromise) {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for HTTP tests')
    }

    process.env.DATABASE_URL = testDatabaseUrl
    process.env.NUXT_PUBLIC_APP_URL = TEST_APP_ORIGIN
    process.env.NODE_ENV = 'test'

    setupPromise = setup({
      rootDir: fileURLToPath(new URL('../..', import.meta.url)),
      server: true,
      browser: false,
      env: {
        DATABASE_URL: testDatabaseUrl,
        NUXT_PUBLIC_APP_URL: TEST_APP_ORIGIN,
        NODE_ENV: 'test',
      },
    }).then(() => undefined)
  }

  return setupPromise
}
