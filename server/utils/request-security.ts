import type { H3Event } from 'h3'
import { getEnv } from '../../shared/env'
import { AppError } from './errors'

/**
 * CSRF defense for cookie-authenticated mutations.
 * Trusted origin comes only from NUXT_PUBLIC_APP_URL — never from Host.
 * Missing Origin is rejected; curl/evaluators must send Origin explicitly.
 */
export function assertTrustedOrigin(event: H3Event): void {
  const trustedOrigin = new URL(getEnv().NUXT_PUBLIC_APP_URL).origin
  const origin = getHeader(event, 'origin')

  if (!origin || origin !== trustedOrigin) {
    throw new AppError(403, 'ORIGIN_FORBIDDEN', 'Origin is not allowed')
  }
}

export function assertJsonContentType(event: H3Event): void {
  const contentType = getHeader(event, 'content-type')
  if (!contentType || !contentType.toLowerCase().startsWith('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
  }
}

export function assertStateChangingGuards(
  event: H3Event,
  options: { jsonBody?: boolean } = {},
): void {
  assertTrustedOrigin(event)
  if (options.jsonBody !== false) {
    assertJsonContentType(event)
  }
}
