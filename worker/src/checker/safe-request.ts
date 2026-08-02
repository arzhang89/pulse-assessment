import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import type { LookupAddress } from 'node:dns'
import type { LookupFunction } from 'node:net'
import ipaddr from 'ipaddr.js'
import { classifyIpAddress, dedupeAddresses, type ForbiddenReason } from './forbidden-addresses.js'
import { safeErrorMessage } from './safe-message.js'
import type { CheckErrorCode } from './types.js'

export type DnsLookupFn = (
  hostname: string,
  options: { all: true; family?: number },
) => Promise<LookupAddress[]>

export type SafeRequestDependencies = {
  lookup?: DnsLookupFn
  httpRequest?: typeof http.request
  httpsRequest?: typeof https.request
  now?: () => number
}

export type SafeRequestInput = {
  url: string
  method: 'GET' | 'POST'
  timeoutMs: number
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export type SafeRequestSuccess = {
  ok: true
  statusCode: number
  responseMs: number
}

export type SafeRequestFailure = {
  ok: false
  statusCode: number | null
  responseMs: number | null
  errorCode: CheckErrorCode
  errorMessage: string
}

export type SafeRequestResult = SafeRequestSuccess | SafeRequestFailure

const defaultLookup: DnsLookupFn = (hostname) => dns.promises.lookup(hostname, { all: true })

function hostnameIsIpLiteral(hostname: string): boolean {
  return ipaddr.isValid(hostname)
}

function forbiddenMessage(reason: ForbiddenReason): string {
  return safeErrorMessage(`forbidden address (${reason})`, 'forbidden address')
}

function classifyTransportError(error: unknown): {
  errorCode: CheckErrorCode
  errorMessage: string
} {
  const err = error as NodeJS.ErrnoException & { code?: string }
  const code = err.code ?? ''
  const message = safeErrorMessage(err.message, 'request failed')

  if (
    code === 'ABORT_ERR' ||
    code === 'ERR_CANCELED' ||
    (error instanceof Error && error.name === 'AbortError') ||
    /aborted/i.test(message)
  ) {
    return { errorCode: 'TIMEOUT', errorMessage: safeErrorMessage('request timed out', 'timeout') }
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ESERVFAIL' || code === 'ENODATA') {
    return { errorCode: 'DNS_FAILED', errorMessage: safeErrorMessage(message, 'dns lookup failed') }
  }

  if (
    code.startsWith('ERR_TLS_') ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    /ssl|tls|certificate/i.test(message)
  ) {
    return { errorCode: 'TLS_FAILED', errorMessage: safeErrorMessage(message, 'tls failed') }
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ECONNABORTED' ||
    code === 'EPIPE'
  ) {
    return {
      errorCode: 'CONNECT_FAILED',
      errorMessage: safeErrorMessage(message, 'connection failed'),
    }
  }

  return { errorCode: 'UNKNOWN_ERROR', errorMessage: safeErrorMessage(message, 'unknown error') }
}

/**
 * Lower-level SSRF-safe HTTP(S) request.
 *
 * Owns URL parsing, DNS, public-IP validation, validated-IP pinning, TLS
 * hostname/certificate verification, agent:false, timeout, no redirect
 * following, header collection, and bounded (destroyed) response bodies.
 * Callers classify status codes for their own semantics.
 */
export async function safeHttpRequest(
  input: SafeRequestInput,
  deps: SafeRequestDependencies = {},
): Promise<SafeRequestResult> {
  const lookup = deps.lookup ?? defaultLookup
  const httpRequest = deps.httpRequest ?? http.request
  const httpsRequest = deps.httpsRequest ?? https.request
  const now = deps.now ?? Date.now

  const startedAt = now()
  const deadlineAt = startedAt + input.timeoutMs

  let settled = false
  const settle = (result: SafeRequestResult): SafeRequestResult => {
    if (settled) {
      return result
    }
    settled = true
    return result
  }

  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return settle({
      ok: false,
      statusCode: null,
      responseMs: null,
      errorCode: 'INVALID_RESPONSE',
      errorMessage: safeErrorMessage('invalid URL', 'invalid URL'),
    })
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return settle({
      ok: false,
      statusCode: null,
      responseMs: null,
      errorCode: 'INVALID_RESPONSE',
      errorMessage: safeErrorMessage('unsupported URL scheme', 'unsupported scheme'),
    })
  }

  const remaining = () => deadlineAt - now()
  if (remaining() <= 0) {
    return settle({
      ok: false,
      statusCode: null,
      responseMs: input.timeoutMs,
      errorCode: 'TIMEOUT',
      errorMessage: safeErrorMessage('request timed out', 'timeout'),
    })
  }

  const hostname = url.hostname
  const isHttps = url.protocol === 'https:'
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80
  const path = `${url.pathname}${url.search}`

  let pinnedLookup: LookupFunction | undefined

  if (hostnameIsIpLiteral(hostname)) {
    const classified = classifyIpAddress(hostname)
    if (!classified.ok) {
      return settle({
        ok: false,
        statusCode: null,
        responseMs: Math.max(0, now() - startedAt),
        errorCode: 'FORBIDDEN_ADDRESS',
        errorMessage: forbiddenMessage(classified.reason),
      })
    }
  } else {
    let addresses: LookupAddress[]
    try {
      addresses = await lookup(hostname, { all: true })
    } catch (error) {
      if (remaining() <= 0) {
        return settle({
          ok: false,
          statusCode: null,
          responseMs: input.timeoutMs,
          errorCode: 'TIMEOUT',
          errorMessage: safeErrorMessage('request timed out', 'timeout'),
        })
      }
      const classified = classifyTransportError(error)
      return settle({
        ok: false,
        statusCode: null,
        responseMs: Math.max(0, now() - startedAt),
        errorCode: classified.errorCode === 'UNKNOWN_ERROR' ? 'DNS_FAILED' : classified.errorCode,
        errorMessage: classified.errorMessage,
      })
    }

    if (remaining() <= 0) {
      return settle({
        ok: false,
        statusCode: null,
        responseMs: input.timeoutMs,
        errorCode: 'TIMEOUT',
        errorMessage: safeErrorMessage('request timed out', 'timeout'),
      })
    }

    const unique = dedupeAddresses(addresses.map((a) => a.address))
    if (unique.length === 0) {
      return settle({
        ok: false,
        statusCode: null,
        responseMs: Math.max(0, now() - startedAt),
        errorCode: 'DNS_FAILED',
        errorMessage: safeErrorMessage('dns returned no addresses', 'dns failed'),
      })
    }

    for (const address of unique) {
      const classified = classifyIpAddress(address)
      if (!classified.ok) {
        return settle({
          ok: false,
          statusCode: null,
          responseMs: Math.max(0, now() - startedAt),
          errorCode: 'FORBIDDEN_ADDRESS',
          errorMessage: forbiddenMessage(classified.reason),
        })
      }
    }

    const selected = classifyIpAddress(unique[0]!)
    if (!selected.ok) {
      return settle({
        ok: false,
        statusCode: null,
        responseMs: Math.max(0, now() - startedAt),
        errorCode: 'FORBIDDEN_ADDRESS',
        errorMessage: forbiddenMessage(selected.reason),
      })
    }

    const selectedIp = selected.normalized
    const family = selected.family
    // Node 20.19+/22 may call lookup with { all: true } (autoSelectFamily / happy eyeballs).
    // Support both the single-address and all-addresses callback shapes.
    pinnedLookup = ((_host, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (
        ...args: unknown[]
      ) => void
      const opts = (typeof options === 'function' ? undefined : options) as
        { all?: boolean } | undefined

      if (opts?.all) {
        cb(null, [{ address: selectedIp, family }])
        return
      }

      cb(null, selectedIp, family)
    }) as LookupFunction
  }

  const requestFn = isHttps ? httpsRequest : httpRequest
  const msLeft = remaining()
  if (msLeft <= 0) {
    return settle({
      ok: false,
      statusCode: null,
      responseMs: input.timeoutMs,
      errorCode: 'TIMEOUT',
      errorMessage: safeErrorMessage('request timed out', 'timeout'),
    })
  }

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort()
    } else {
      input.signal.addEventListener('abort', onExternalAbort, { once: true })
    }
  }
  const timer = setTimeout(() => controller.abort(), msLeft)

  return await new Promise<SafeRequestResult>((resolve) => {
    const finish = (result: SafeRequestResult) => {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', onExternalAbort)
      resolve(settle(result))
    }

    const options: http.RequestOptions = {
      protocol: url.protocol,
      hostname,
      port,
      path,
      method: input.method,
      headers: input.headers,
      agent: false,
      signal: controller.signal,
      ...(pinnedLookup ? { lookup: pinnedLookup } : {}),
    }

    let req: http.ClientRequest
    try {
      req = requestFn(options, (res) => {
        const responseMs = Math.max(0, now() - startedAt)
        const statusCode = res.statusCode ?? 0
        // Do not buffer the body; Node does not follow redirects.
        res.resume()
        res.destroy()
        finish({ ok: true, statusCode, responseMs })
      })
    } catch (error) {
      const classified = classifyTransportError(error)
      finish({
        ok: false,
        statusCode: null,
        responseMs: Math.max(0, now() - startedAt),
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
      })
      return
    }

    req.on('error', (error) => {
      if (settled) {
        return
      }
      if (remaining() <= 0 || controller.signal.aborted) {
        finish({
          ok: false,
          statusCode: null,
          responseMs: input.timeoutMs,
          errorCode: 'TIMEOUT',
          errorMessage: safeErrorMessage('request timed out', 'timeout'),
        })
        return
      }
      const classified = classifyTransportError(error)
      finish({
        ok: false,
        statusCode: null,
        responseMs: Math.max(0, now() - startedAt),
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
      })
    })

    if (input.body !== undefined) {
      req.end(input.body)
    } else {
      req.end()
    }
  })
}
