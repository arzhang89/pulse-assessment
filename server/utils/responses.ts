import type { H3Event } from 'h3'

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'ORIGIN_FORBIDDEN'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'NOT_FOUND'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'INTERNAL_ERROR'

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode
    message: string
    fields: Record<string, string>
  }
}

export function apiError(
  event: H3Event,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  fields: Record<string, string> = {},
): ApiErrorBody {
  setResponseStatus(event, statusCode)
  return {
    error: {
      code,
      message,
      fields,
    },
  }
}

export function zodFields(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>
}): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_root'
    if (!fields[key]) {
      fields[key] = issue.message
    }
  }
  return fields
}
