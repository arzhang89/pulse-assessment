import { z } from 'zod'

/**
 * The environment contract shared by the Nuxt/Nitro server process and the
 * standalone worker process. Both processes must be able to validate their
 * own environment independently (they run in separate containers), so this
 * module has no dependency on Nuxt's runtime config.
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .url({ message: 'DATABASE_URL must be a valid PostgreSQL connection string' }),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NUXT_PUBLIC_APP_URL: z.string().url({ message: 'NUXT_PUBLIC_APP_URL must be a valid URL' }),
})

export type Env = z.infer<typeof envSchema>

let cachedEnv: Env | undefined

/**
 * Parses and validates `process.env` against {@link envSchema}.
 *
 * Throws a single descriptive error listing every missing/invalid variable
 * instead of letting the app or worker continue with undefined config and
 * fail later with a confusing, unrelated error (e.g. a raw `pg` connection
 * failure). The result is cached after the first successful parse for the
 * lifetime of the process.
 */
export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv
  }

  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  cachedEnv = parsed.data
  return cachedEnv
}
