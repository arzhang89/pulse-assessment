import { EventEmitter } from 'node:events'
import { setImmediate as defer } from 'node:timers'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { performHttpCheck } from '../worker/src/checker/http-check'
import { MAX_ERROR_MESSAGE_LENGTH, safeErrorMessage } from '../worker/src/checker'

function mockResponse(statusCode: number): IncomingMessage {
  const res = new EventEmitter() as IncomingMessage
  res.statusCode = statusCode
  res.resume = vi.fn()
  res.destroy = vi.fn()
  return res
}

function mockRequest(handler: (options: Record<string, unknown>) => IncomingMessage | Error) {
  return vi.fn((options: Record<string, unknown>, callback: (res: IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void
      destroy: () => void
    }
    req.end = () => {
      const result = handler(options)
      if (result instanceof Error) {
        defer(() => req.emit('error', result))
        return
      }
      defer(() => callback(result))
    }
    req.destroy = vi.fn()
    return req
  })
}

describe('performHttpCheck', () => {
  it('classifies HTTP 500 as DOWN with HTTP_STATUS', async () => {
    const httpsRequest = mockRequest(() => mockResponse(500))
    const result = await performHttpCheck(
      { url: 'https://example.com/health', timeoutMs: 5_000 },
      {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpsRequest: httpsRequest as never,
      },
    )

    expect(result).toMatchObject({
      outcome: 'DOWN',
      statusCode: 500,
      errorCode: 'HTTP_STATUS',
    })
    expect(result.errorMessage).toContain('500')
  })

  it('classifies 2xx/3xx as UP', async () => {
    const httpsRequest = mockRequest(() => mockResponse(301))
    const result = await performHttpCheck(
      { url: 'https://example.com/', timeoutMs: 5_000 },
      {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpsRequest: httpsRequest as never,
      },
    )
    expect(result).toMatchObject({ outcome: 'UP', statusCode: 301, errorCode: null })
  })

  it('pins validated IP via lookup while retaining hostname for SNI', async () => {
    let seenOptions: Record<string, unknown> | undefined
    const httpsRequest = mockRequest((options) => {
      seenOptions = options
      return mockResponse(200)
    })

    await performHttpCheck(
      { url: 'https://example.com/path', timeoutMs: 5_000 },
      {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpsRequest: httpsRequest as never,
      },
    )

    expect(seenOptions).toBeDefined()
    expect(seenOptions!.hostname).toBe('example.com')
    expect(seenOptions!.agent).toBe(false)
    expect(seenOptions!.servername).toBeUndefined()
    expect(seenOptions!.rejectUnauthorized).toBeUndefined()
    expect(typeof seenOptions!.lookup).toBe('function')

    type LookupCb = (
      host: string,
      options: object,
      callback: (err: Error | null, address: string, family: number) => void,
    ) => void
    const pinned = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      ;(seenOptions!.lookup as LookupCb)(
        'example.com',
        {},
        (err: Error | null, address: string, family: number) => {
          if (err) reject(err)
          else resolve({ address, family })
        },
      )
    })
    expect(pinned).toEqual({ address: '93.184.216.34', family: 4 })

    // Node autoSelectFamily uses lookup(..., { all: true }, cb).
    type LookupAllCb = (
      host: string,
      options: { all: true },
      callback: (err: Error | null, addresses: Array<{ address: string; family: number }>) => void,
    ) => void
    const pinnedAll = await new Promise<Array<{ address: string; family: number }>>(
      (resolve, reject) => {
        ;(seenOptions!.lookup as LookupAllCb)('example.com', { all: true }, (err, addresses) => {
          if (err) reject(err)
          else resolve(addresses)
        })
      },
    )
    expect(pinnedAll).toEqual([{ address: '93.184.216.34', family: 4 }])
  })

  it('does not force IP SNI for literal HTTPS IP URLs', async () => {
    let seenOptions: Record<string, unknown> | undefined
    const httpsRequest = mockRequest((options) => {
      seenOptions = options
      return mockResponse(200)
    })

    // Use a public unicast literal so classification allows the request.
    const result = await performHttpCheck(
      { url: 'https://93.184.216.34/', timeoutMs: 5_000 },
      { httpsRequest: httpsRequest as never },
    )

    expect(result.outcome).toBe('UP')
    expect(seenOptions!.hostname).toBe('93.184.216.34')
    expect(seenOptions!.lookup).toBeUndefined()
    expect(seenOptions!.servername).toBeUndefined()
    expect(seenOptions!.agent).toBe(false)
  })

  it('rejects forbidden resolved addresses without creating a request', async () => {
    const httpsRequest = mockRequest(() => mockResponse(200))
    const result = await performHttpCheck(
      { url: 'https://internal.example/', timeoutMs: 5_000 },
      {
        lookup: async () => [{ address: '10.0.0.5', family: 4 }],
        httpsRequest: httpsRequest as never,
      },
    )

    expect(result.errorCode).toBe('FORBIDDEN_ADDRESS')
    expect(httpsRequest).not.toHaveBeenCalled()
  })

  it('rejects when any resolved address is forbidden', async () => {
    const httpsRequest = mockRequest(() => mockResponse(200))
    const result = await performHttpCheck(
      { url: 'https://mixed.example/', timeoutMs: 5_000 },
      {
        lookup: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
        httpsRequest: httpsRequest as never,
      },
    )
    expect(result.errorCode).toBe('FORBIDDEN_ADDRESS')
    expect(httpsRequest).not.toHaveBeenCalled()
  })

  it('times out when DNS finishes after the deadline and does not create a request', async () => {
    let clock = 1_000
    const httpsRequest = mockRequest(() => mockResponse(200))

    const result = await performHttpCheck(
      { url: 'https://slow-dns.example/', timeoutMs: 100 },
      {
        now: () => clock,
        lookup: async () => {
          clock += 200
          return [{ address: '93.184.216.34', family: 4 }]
        },
        httpsRequest: httpsRequest as never,
      },
    )

    expect(result.errorCode).toBe('TIMEOUT')
    expect(httpsRequest).not.toHaveBeenCalled()
  })

  it('uses agent:false so sockets are not pooled across checks', async () => {
    const agents: unknown[] = []
    const httpsRequest = mockRequest((options) => {
      agents.push(options.agent)
      return mockResponse(200)
    })

    await performHttpCheck(
      { url: 'https://example.com/a', timeoutMs: 5_000 },
      {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpsRequest: httpsRequest as never,
      },
    )
    await performHttpCheck(
      { url: 'https://example.com/b', timeoutMs: 5_000 },
      {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpsRequest: httpsRequest as never,
      },
    )

    expect(agents).toEqual([false, false])
  })

  it('maps DNS failures to DNS_FAILED', async () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    const result = await performHttpCheck(
      { url: 'https://missing.example/', timeoutMs: 5_000 },
      {
        lookup: async () => {
          throw err
        },
      },
    )
    expect(result.errorCode).toBe('DNS_FAILED')
  })

  it('rejects literal loopback without a production bypass', async () => {
    const result = await performHttpCheck({ url: 'http://127.0.0.1/', timeoutMs: 1_000 })
    expect(result.errorCode).toBe('FORBIDDEN_ADDRESS')
  })
})

describe('safeErrorMessage', () => {
  it('bounds arbitrary upstream text', () => {
    const long = 'x'.repeat(MAX_ERROR_MESSAGE_LENGTH + 50)
    const safe = safeErrorMessage(long, 'fallback')
    expect(safe.length).toBeLessThanOrEqual(MAX_ERROR_MESSAGE_LENGTH)
  })
})
