import { MAX_ERROR_MESSAGE_LENGTH } from './types.js'

/** Bound and sanitize messages stored on check results / monitors. */
export function safeErrorMessage(message: string | undefined | null, fallback: string): string {
  const raw = (message ?? '').replace(/[\r\n\t]+/g, ' ').trim()
  const text = raw.length > 0 ? raw : fallback
  if (text.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return text
  }
  return `${text.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}…`
}
