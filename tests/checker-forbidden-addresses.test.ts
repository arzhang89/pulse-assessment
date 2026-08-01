import { describe, expect, it } from 'vitest'
import {
  classifyIpAddress,
  dedupeAddresses,
  isForbiddenIpAddress,
} from '../worker/src/checker/forbidden-addresses'

describe('classifyIpAddress', () => {
  it('allows public unicast addresses', () => {
    expect(classifyIpAddress('8.8.8.8')).toMatchObject({ ok: true, family: 4 })
    expect(classifyIpAddress('1.1.1.1')).toMatchObject({ ok: true })
    expect(classifyIpAddress('2606:4700:4700::1111')).toMatchObject({ ok: true, family: 6 })
  })

  it('rejects unspecified, loopback, private, and link-local', () => {
    expect(classifyIpAddress('0.0.0.0')).toMatchObject({ ok: false, reason: 'unspecified' })
    expect(classifyIpAddress('127.0.0.1')).toMatchObject({ ok: false, reason: 'loopback' })
    expect(classifyIpAddress('10.0.0.1')).toMatchObject({ ok: false, reason: 'private' })
    expect(classifyIpAddress('172.16.5.1')).toMatchObject({ ok: false, reason: 'private' })
    expect(classifyIpAddress('192.168.1.1')).toMatchObject({ ok: false, reason: 'private' })
    expect(classifyIpAddress('169.254.1.1')).toMatchObject({ ok: false, reason: 'link_local' })
    expect(classifyIpAddress('::')).toMatchObject({ ok: false, reason: 'unspecified' })
    expect(classifyIpAddress('::1')).toMatchObject({ ok: false, reason: 'loopback' })
    expect(classifyIpAddress('fe80::1')).toMatchObject({ ok: false, reason: 'link_local' })
  })

  it('rejects multicast, reserved, CGNAT, benchmarking, and documentation', () => {
    expect(classifyIpAddress('224.0.0.1')).toMatchObject({ ok: false, reason: 'multicast' })
    expect(classifyIpAddress('240.0.0.1')).toMatchObject({ ok: false, reason: 'reserved' })
    expect(classifyIpAddress('100.64.0.1')).toMatchObject({
      ok: false,
      reason: 'carrier_grade_nat',
    })
    expect(classifyIpAddress('198.18.0.1')).toMatchObject({ ok: false, reason: 'benchmarking' })
    expect(classifyIpAddress('192.0.2.1')).toMatchObject({ ok: false, reason: 'documentation' })
    expect(classifyIpAddress('198.51.100.1')).toMatchObject({ ok: false, reason: 'documentation' })
    expect(classifyIpAddress('203.0.113.1')).toMatchObject({ ok: false, reason: 'documentation' })
    expect(classifyIpAddress('2001:db8::1')).toMatchObject({ ok: false, reason: 'documentation' })
  })

  it('rejects IPv6 unique-local addresses', () => {
    expect(classifyIpAddress('fc00::1')).toMatchObject({ ok: false, reason: 'unique_local' })
    expect(classifyIpAddress('fd12:3456:789a::1')).toMatchObject({
      ok: false,
      reason: 'unique_local',
    })
  })

  it('normalizes IPv4-mapped IPv6 before classification', () => {
    expect(classifyIpAddress('::ffff:127.0.0.1')).toMatchObject({
      ok: false,
      reason: 'loopback',
    })
    expect(classifyIpAddress('::ffff:10.0.0.1')).toMatchObject({ ok: false, reason: 'private' })
    expect(classifyIpAddress('::ffff:8.8.8.8')).toMatchObject({
      ok: true,
      family: 4,
      normalized: '8.8.8.8',
    })
  })

  it('exposes isForbiddenIpAddress helper', () => {
    expect(isForbiddenIpAddress('8.8.8.8')).toBe(false)
    expect(isForbiddenIpAddress('127.0.0.1')).toBe(true)
  })
})

describe('dedupeAddresses', () => {
  it('deduplicates equivalent IPv4 and mapped forms', () => {
    expect(dedupeAddresses(['8.8.8.8', '8.8.8.8', '::ffff:8.8.8.8', '1.1.1.1'])).toEqual([
      '8.8.8.8',
      '1.1.1.1',
    ])
  })
})
