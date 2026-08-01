import { safeErrorMessage } from './checker/safe-message.js'
import {
  safeHttpRequest,
  type SafeRequestDependencies,
  type SafeRequestResult,
} from './checker/safe-request.js'
import { classifyDeliveryDisposition, type DeliveryDisposition } from './outbox-retry.js'

export type DeliverWebhookInput = {
  destinationUrl: string
  payload: unknown
  timeoutMs: number
  signal?: AbortSignal
}

export type DeliverWebhookResult = {
  disposition: DeliveryDisposition
  statusCode: number | null
  responseMs: number | null
  errorMessage: string | null
}

function serializePayload(payload: unknown): string {
  return JSON.stringify(payload)
}

/**
 * Webhook delivery adapter: POST JSON; success only for HTTP 200–299.
 * Does not use monitor UP/DOWN classification.
 */
export async function deliverWebhook(
  input: DeliverWebhookInput,
  deps: SafeRequestDependencies = {},
): Promise<DeliverWebhookResult> {
  let body: string
  try {
    body = serializePayload(input.payload)
  } catch {
    return {
      disposition: 'terminal',
      statusCode: null,
      responseMs: null,
      errorMessage: safeErrorMessage('invalid payload', 'invalid payload'),
    }
  }

  const result: SafeRequestResult = await safeHttpRequest(
    {
      url: input.destinationUrl,
      method: 'POST',
      timeoutMs: input.timeoutMs,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body).toString(),
      },
      body,
      signal: input.signal,
    },
    deps,
  )

  if (result.ok) {
    const disposition = classifyDeliveryDisposition({
      transportOk: true,
      statusCode: result.statusCode,
      errorCode: null,
    })
    return {
      disposition,
      statusCode: result.statusCode,
      responseMs: result.responseMs,
      errorMessage:
        disposition === 'success'
          ? null
          : safeErrorMessage(`HTTP ${result.statusCode}`, `HTTP ${result.statusCode}`),
    }
  }

  const disposition = classifyDeliveryDisposition({
    transportOk: false,
    statusCode: result.statusCode,
    errorCode: result.errorCode,
  })

  return {
    disposition,
    statusCode: result.statusCode,
    responseMs: result.responseMs,
    errorMessage: result.errorMessage,
  }
}
