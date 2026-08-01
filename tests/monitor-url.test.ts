import { describe, expect, it } from 'vitest'
import { normalizeMonitorUrl } from '../shared/monitor-url'

describe('normalizeMonitorUrl', () => {
  it('accepts http and https URLs and strips fragments', () => {
    expect(normalizeMonitorUrl('https://example.com/path#frag')).toEqual({
      ok: true,
      href: 'https://example.com/path',
    })
    expect(normalizeMonitorUrl('http://example.com')).toEqual({
      ok: true,
      href: 'http://example.com/',
    })
  })

  it('rejects non-http schemes', () => {
    expect(normalizeMonitorUrl('ftp://example.com')).toMatchObject({ ok: false })
  })

  it('rejects embedded credentials', () => {
    expect(normalizeMonitorUrl('https://user:pass@example.com')).toMatchObject({ ok: false })
  })
})
