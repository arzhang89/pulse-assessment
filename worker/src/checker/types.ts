export const CHECK_ERROR_CODES = [
  'DNS_FAILED',
  'FORBIDDEN_ADDRESS',
  'CONNECT_FAILED',
  'TLS_FAILED',
  'TIMEOUT',
  'HTTP_STATUS',
  'INVALID_RESPONSE',
  'UNKNOWN_ERROR',
] as const

export type CheckErrorCode = (typeof CHECK_ERROR_CODES)[number]

export type CheckOutcome = 'UP' | 'DOWN'

export type HttpCheckResult = {
  outcome: CheckOutcome
  statusCode: number | null
  responseMs: number | null
  errorCode: CheckErrorCode | null
  errorMessage: string | null
}

/** Max stored error message length (safe, bounded). */
export const MAX_ERROR_MESSAGE_LENGTH = 200
