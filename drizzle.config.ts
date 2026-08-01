import { defineConfig } from 'drizzle-kit'
import { getEnv } from './shared/env'

const env = getEnv()

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
})
