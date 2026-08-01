import { getEnv } from '../../shared/env'

/**
 * Validates required environment variables when the Nitro server boots, so
 * misconfiguration fails immediately with a clear error instead of
 * surfacing later as an obscure runtime failure on the first request.
 */
export default defineNitroPlugin(() => {
  getEnv()
})
