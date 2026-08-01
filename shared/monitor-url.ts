export type ParsedMonitorUrl = { ok: true; href: string } | { ok: false; message: string }

/**
 * Create-time URL checks only (scheme + credentials + normalize).
 * Full DNS/IP SSRF enforcement belongs with the outbound checker.
 */
export function normalizeMonitorUrl(raw: string): ParsedMonitorUrl {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, message: 'URL must be a valid absolute HTTP or HTTPS URL' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: 'URL scheme must be http or https' }
  }

  if (url.username || url.password) {
    return { ok: false, message: 'URL must not contain credentials' }
  }

  url.hash = ''
  return { ok: true, href: url.href }
}
