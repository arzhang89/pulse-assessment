import type { H3Event } from 'h3'
import { type ApiErrorBody, type ApiErrorCode, apiError } from './responses'

export class AppError extends Error {
  readonly statusCode: number
  readonly code: ApiErrorCode
  readonly fields: Record<string, string>

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    fields: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.fields = fields
  }
}

export function defineApiHandler(
  handler: (event: H3Event) => unknown | Promise<unknown>,
): ReturnType<typeof defineEventHandler> {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    } catch (error) {
      if (error instanceof AppError) {
        return apiError(event, error.statusCode, error.code, error.message, error.fields)
      }

      console.error('[api]', error)
      return apiError(event, 500, 'INTERNAL_ERROR', 'An unexpected error occurred')
    }
  })
}

export function toApiErrorBody(error: AppError, event: H3Event): ApiErrorBody {
  return apiError(event, error.statusCode, error.code, error.message, error.fields)
}
