import { safeErrorMessage } from './safe-message.js'
import { safeHttpRequest, type DnsLookupFn, type SafeRequestDependencies } from './safe-request.js'
import type { HttpCheckResult } from './types.js'

export type HttpCheckDependencies = SafeRequestDependencies

export type PerformHttpCheckInput = {
  url: string
  timeoutMs: number
  signal?: AbortSignal
}

export type { DnsLookupFn }

/**
 * Monitor-check adapter: GET; 200–399 → UP; other statuses → DOWN/HTTP_STATUS.
 */
export async function performHttpCheck(
  input: PerformHttpCheckInput,
  deps: HttpCheckDependencies = {},
): Promise<HttpCheckResult> {
  const result = await safeHttpRequest(
    {
      url: input.url,
      method: 'GET',
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    },
    deps,
  )

  if (!result.ok) {
    return {
      outcome: 'DOWN',
      statusCode: result.statusCode,
      responseMs: result.responseMs,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    }
  }

  const { statusCode, responseMs } = result

  if (statusCode >= 200 && statusCode <= 399) {
    return {
      outcome: 'UP',
      statusCode,
      responseMs,
      errorCode: null,
      errorMessage: null,
    }
  }

  if (statusCode >= 400 && statusCode <= 599) {
    return {
      outcome: 'DOWN',
      statusCode,
      responseMs,
      errorCode: 'HTTP_STATUS',
      errorMessage: safeErrorMessage(`HTTP ${statusCode}`, `HTTP ${statusCode}`),
    }
  }

  return {
    outcome: 'DOWN',
    statusCode: statusCode || null,
    responseMs,
    errorCode: 'INVALID_RESPONSE',
    errorMessage: safeErrorMessage('invalid HTTP status', 'invalid response'),
  }
}
