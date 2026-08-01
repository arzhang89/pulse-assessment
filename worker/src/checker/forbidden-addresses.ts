import ipaddr from 'ipaddr.js'

export type ForbiddenReason =
  | 'unspecified'
  | 'loopback'
  | 'private'
  | 'link_local'
  | 'multicast'
  | 'reserved'
  | 'carrier_grade_nat'
  | 'benchmarking'
  | 'documentation'
  | 'unique_local'
  | 'invalid'

type Cidr = [ipaddr.IPv4 | ipaddr.IPv6, number]

function cidr4(text: string): Cidr {
  return ipaddr.IPv4.parseCIDR(text) as Cidr
}

function cidr6(text: string): Cidr {
  return ipaddr.IPv6.parseCIDR(text) as Cidr
}

/**
 * Explicit forbidden-range policy used by the outbound checker.
 * IPv4-mapped IPv6 addresses are normalized to IPv4 before matching.
 */
export const FORBIDDEN_IPV4_RANGES: ReadonlyArray<{ reason: ForbiddenReason; cidr: Cidr }> = [
  { reason: 'unspecified', cidr: cidr4('0.0.0.0/8') },
  { reason: 'loopback', cidr: cidr4('127.0.0.0/8') },
  { reason: 'private', cidr: cidr4('10.0.0.0/8') },
  { reason: 'private', cidr: cidr4('172.16.0.0/12') },
  { reason: 'private', cidr: cidr4('192.168.0.0/16') },
  { reason: 'link_local', cidr: cidr4('169.254.0.0/16') },
  { reason: 'multicast', cidr: cidr4('224.0.0.0/4') },
  { reason: 'reserved', cidr: cidr4('240.0.0.0/4') },
  { reason: 'reserved', cidr: cidr4('255.255.255.255/32') },
  { reason: 'carrier_grade_nat', cidr: cidr4('100.64.0.0/10') },
  { reason: 'benchmarking', cidr: cidr4('198.18.0.0/15') },
  { reason: 'documentation', cidr: cidr4('192.0.2.0/24') },
  { reason: 'documentation', cidr: cidr4('198.51.100.0/24') },
  { reason: 'documentation', cidr: cidr4('203.0.113.0/24') },
]

export const FORBIDDEN_IPV6_RANGES: ReadonlyArray<{ reason: ForbiddenReason; cidr: Cidr }> = [
  { reason: 'unspecified', cidr: cidr6('::/128') },
  { reason: 'loopback', cidr: cidr6('::1/128') },
  { reason: 'unique_local', cidr: cidr6('fc00::/7') },
  { reason: 'link_local', cidr: cidr6('fe80::/10') },
  { reason: 'multicast', cidr: cidr6('ff00::/8') },
  { reason: 'documentation', cidr: cidr6('2001:db8::/32') },
  // IETF protocol assignments / discard / reserved blocks commonly treated as non-public.
  { reason: 'reserved', cidr: cidr6('100::/64') },
  { reason: 'reserved', cidr: cidr6('2001::/23') },
]

export type AddressClassification =
  | { ok: true; address: string; family: 4 | 6; normalized: string }
  | { ok: false; address: string; reason: ForbiddenReason }

/**
 * Normalize IPv4-mapped IPv6 to IPv4, then classify against the forbidden policy.
 */
export function classifyIpAddress(raw: string): AddressClassification {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6
  try {
    parsed = ipaddr.parse(raw)
  } catch {
    return { ok: false, address: raw, reason: 'invalid' }
  }

  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6
    if (v6.isIPv4MappedAddress()) {
      parsed = v6.toIPv4Address()
    }
  }

  const normalized = parsed.toString()
  const family: 4 | 6 = parsed.kind() === 'ipv4' ? 4 : 6
  const ranges = family === 4 ? FORBIDDEN_IPV4_RANGES : FORBIDDEN_IPV6_RANGES

  for (const entry of ranges) {
    if (parsed.match(entry.cidr)) {
      return { ok: false, address: raw, reason: entry.reason }
    }
  }

  return { ok: true, address: raw, family, normalized }
}

export function isForbiddenIpAddress(raw: string): boolean {
  return !classifyIpAddress(raw).ok
}

/** Deduplicate DNS answers while preserving first-seen order. */
export function dedupeAddresses(addresses: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const address of addresses) {
    let key = address
    try {
      const parsed = ipaddr.parse(address)
      key =
        parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
          ? (parsed as ipaddr.IPv6).toIPv4Address().toString()
          : parsed.toString()
    } catch {
      // keep raw key
    }
    if (!seen.has(key)) {
      seen.add(key)
      out.push(address)
    }
  }
  return out
}
