export const NOTIFICATION_MAX_ATTEMPTS = 8

export type DeliveryDisposition = 'success' | 'retryable' | 'terminal'

const RETRYABLE_CLIENT_STATUSES = new Set([408, 425, 429])

/**
 * Classify a completed delivery attempt for the outbox state machine.
 * Redirects are not followed; 3xx is terminal. Forbidden/invalid destinations
 * are terminal (no retry of deterministic SSRF policy rejection).
 */
export function classifyDeliveryDisposition(args: {
  transportOk: boolean
  statusCode: number | null
  errorCode: string | null
}): DeliveryDisposition {
  if (args.transportOk && args.statusCode !== null) {
    const status = args.statusCode
    if (status >= 200 && status <= 299) {
      return 'success'
    }
    if (status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)) {
      return 'retryable'
    }
    if (status >= 300 && status <= 399) {
      return 'terminal'
    }
    if (status >= 400 && status <= 499) {
      return RETRYABLE_CLIENT_STATUSES.has(status) ? 'retryable' : 'terminal'
    }
    return 'terminal'
  }

  const code = args.errorCode
  if (code === 'FORBIDDEN_ADDRESS' || code === 'INVALID_RESPONSE') {
    return 'terminal'
  }
  if (
    code === 'DNS_FAILED' ||
    code === 'CONNECT_FAILED' ||
    code === 'TLS_FAILED' ||
    code === 'TIMEOUT' ||
    code === 'UNKNOWN_ERROR' ||
    code === 'HTTP_STATUS'
  ) {
    return 'retryable'
  }

  return 'terminal'
}

/**
 * Delay after a failed attempt number (1-based completed attempts).
 * failed attempt 1 → 30s; 2 → 2m; 3 → 10m; 4+ → 1h.
 */
export function retryDelayMs(
  failedAttemptNumber: number,
  options: { random?: () => number; jitterRatio?: number } = {},
): number {
  let base: number
  if (failedAttemptNumber <= 1) {
    base = 30_000
  } else if (failedAttemptNumber === 2) {
    base = 2 * 60_000
  } else if (failedAttemptNumber === 3) {
    base = 10 * 60_000
  } else {
    base = 60 * 60_000
  }

  const random = options.random
  const jitterRatio = options.jitterRatio ?? 0
  if (!random || jitterRatio <= 0) {
    return base
  }

  const jitter = base * jitterRatio * (random() * 2 - 1)
  return Math.max(0, Math.round(base + jitter))
}
