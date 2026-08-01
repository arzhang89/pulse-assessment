import { SESSION_COOKIE_NAME } from '../../shared/session-token'

export const TEST_APP_ORIGIN = 'http://localhost:3000'

export function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    origin: TEST_APP_ORIGIN,
    ...extra,
  }
}

export function parseSetCookie(headerValue: string | null): {
  name: string
  value: string
  attributes: Record<string, string | boolean>
} | null {
  if (!headerValue) {
    return null
  }

  const [pair, ...attrs] = headerValue.split(';').map((part) => part.trim())
  if (!pair) {
    return null
  }

  const eq = pair.indexOf('=')
  const name = eq === -1 ? pair : pair.slice(0, eq)
  const value = eq === -1 ? '' : pair.slice(eq + 1)
  const attributes: Record<string, string | boolean> = {}

  for (const attr of attrs) {
    const [key, ...rest] = attr.split('=')
    if (!key) continue
    attributes[key.toLowerCase()] = rest.length === 0 ? true : rest.join('=')
  }

  return { name, value, attributes }
}

export function getSessionCookie(response: Response): {
  value: string
  attributes: Record<string, string | boolean>
} | null {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter((value): value is string => Boolean(value))

  for (const header of cookies) {
    const parsed = parseSetCookie(header)
    if (parsed?.name === SESSION_COOKIE_NAME) {
      return { value: parsed.value, attributes: parsed.attributes }
    }
  }
  return null
}

export function cookieHeader(rawToken: string): string {
  return `${SESSION_COOKIE_NAME}=${rawToken}`
}
