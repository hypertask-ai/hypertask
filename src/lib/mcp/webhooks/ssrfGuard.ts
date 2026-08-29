import dns from 'dns/promises'
import net from 'net'

/**
 * SSRF guard for outbound webhooks. We POST to a caller-supplied URL from our
 * own servers, so a target that resolves to an internal address could reach the
 * cloud metadata endpoint, loopback, or a private-network service.
 *
 * Two layers:
 *  - assertSafeWebhookTarget(): fast create-time validation (nice error).
 *  - resolveSafeAddresses(): used by delivery to PIN the connection to the exact
 *    validated IPs, closing the DNS-rebinding gap between check and connect.
 *
 * Classification is byte/CIDR based so near-miss literals (e.g. fe90:: which is
 * NOT fe80::/10) can't slip through a string-prefix check.
 */

// Parse an IPv4/IPv6 literal to its raw bytes (4 or 16). null if not an IP.
function ipToBytes(host: string): number[] | null {
  if (net.isIPv4(host)) {
    return host.split('.').map((p) => Number(p))
  }
  if (!net.isIPv6(host)) return null
  let s = host
  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1) → convert tail to two hextets.
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = tail.split('.').map((p) => Number(p))
    if (v4.length !== 4 || v4.some((n) => n < 0 || n > 255)) return null
    const hex = ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16)
    s = s.slice(0, lastColon + 1) + hex
  }
  const [head, tailPart] = s.split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = tailPart ? tailPart.split(':') : []
  const missing = 8 - (headGroups.length + tailGroups.length)
  if (missing < 0) return null
  const groups = [...headGroups, ...Array(s.includes('::') ? missing : 0).fill('0'), ...tailGroups]
  if (groups.length !== 8) return null
  const bytes: number[] = []
  for (const g of groups) {
    const v = parseInt(g || '0', 16)
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null
    bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  return bytes
}

function inCidr(bytes: number[], prefix: number[], prefixLen: number): boolean {
  if (bytes.length !== prefix.length) return false
  let bits = prefixLen
  for (let i = 0; i < bytes.length && bits > 0; i++) {
    const take = Math.min(8, bits)
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff
    if ((bytes[i] & mask) !== (prefix[i] & mask)) return false
    bits -= take
  }
  return true
}

const v4 = (a: number, b: number, c: number, d: number) => [a, b, c, d]

// Every non-globally-routable IPv4 range.
const BLOCKED_V4: Array<[number[], number]> = [
  [v4(0, 0, 0, 0), 8], // "this" network
  [v4(10, 0, 0, 0), 8], // private
  [v4(100, 64, 0, 0), 10], // CGNAT
  [v4(127, 0, 0, 0), 8], // loopback
  [v4(169, 254, 0, 0), 16], // link-local + cloud metadata (169.254.169.254)
  [v4(172, 16, 0, 0), 12], // private
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments
  [v4(192, 0, 2, 0), 24], // TEST-NET-1
  [v4(192, 88, 99, 0), 24], // 6to4 relay anycast
  [v4(192, 168, 0, 0), 16], // private
  [v4(198, 18, 0, 0), 15], // benchmarking
  [v4(198, 51, 100, 0), 24], // TEST-NET-2
  [v4(203, 0, 113, 0), 24], // TEST-NET-3
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // reserved (incl. 255.255.255.255)
]

function isPrivateV4Bytes(b: number[]): boolean {
  return BLOCKED_V4.some(([p, len]) => inCidr(b, p, len))
}

function isPrivateIpBytes(bytes: number[]): boolean {
  if (bytes.length === 4) return isPrivateV4Bytes(bytes)
  if (bytes.length !== 16) return true // unknown → unsafe

  // IPv4-mapped ::ffff:0:0/96 → apply IPv4 rules to the embedded address.
  const isV4Mapped =
    bytes.slice(0, 10).every((x) => x === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  if (isV4Mapped) return isPrivateV4Bytes(bytes.slice(12))

  // NAT64 64:ff9b::/96 → embedded IPv4 in the last 4 bytes.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return isPrivateV4Bytes(bytes.slice(12))
  }

  const first = bytes[0]
  const unspecifiedOrLoopback =
    bytes.slice(0, 15).every((x) => x === 0) && (bytes[15] === 0 || bytes[15] === 1)
  if (unspecifiedOrLoopback) return true // :: and ::1
  if ((first & 0xfe) === 0xfc) return true // fc00::/7 unique-local
  if (first === 0xfe && (bytes[1] & 0xc0) === 0x80) return true // fe80::/10 link-local
  if (first === 0xff) return true // ff00::/8 multicast
  // 100::/64 discard-only
  if (
    bytes[0] === 0x01 &&
    bytes[1] === 0x00 &&
    bytes.slice(2, 8).every((x) => x === 0)
  ) {
    return true
  }
  return false
}

/** Exposed for tests: classify a literal IP string as private/reserved. */
export function isPrivateIp(ip: string): boolean {
  const b = ipToBytes(ip)
  if (!b) return true // unparseable → unsafe
  return isPrivateIpBytes(b)
}

export type SafetyResult = { ok: true } | { ok: false; reason: string }

function preflight(rawUrl: string): { ok: true; url: URL; host: string } | { ok: false; reason: string } {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'url is not a valid absolute URL' }
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'url must use https' }
  const host = u.hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets
  const lower = host.toLowerCase()
  if (
    lower === 'localhost' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.localhost')
  ) {
    return { ok: false, reason: 'url points at an internal host' }
  }
  return { ok: true, url: u, host }
}

/** Create-time validation with a friendly reason. */
export async function assertSafeWebhookTarget(rawUrl: string): Promise<SafetyResult> {
  const pre = preflight(rawUrl)
  if (!pre.ok) return pre
  const { host } = pre

  if (net.isIP(host)) {
    return isPrivateIp(host)
      ? { ok: false, reason: 'url points at a private or reserved address' }
      : { ok: true }
  }

  try {
    const results = await dns.lookup(host, { all: true })
    if (results.length === 0) return { ok: false, reason: 'url host did not resolve' }
    for (const r of results) {
      if (isPrivateIp(r.address)) {
        return { ok: false, reason: 'url host resolves to a private or reserved address' }
      }
    }
  } catch {
    return { ok: false, reason: 'url host could not be resolved' }
  }
  return { ok: true }
}

/**
 * Resolve a target to the exact set of validated public IPs to CONNECT to.
 * Delivery pins the socket to these, so a rebind between resolve and connect
 * cannot land on an internal address. Rejects if any resolved address is
 * private (all-or-nothing) or nothing safe resolves.
 */
export async function resolveSafeAddresses(
  rawUrl: string
): Promise<{ ok: true; host: string; addresses: { address: string; family: number }[] } | { ok: false; reason: string }> {
  const pre = preflight(rawUrl)
  if (!pre.ok) return pre
  const { host } = pre

  if (net.isIP(host)) {
    if (isPrivateIp(host)) return { ok: false, reason: 'url points at a private or reserved address' }
    return { ok: true, host, addresses: [{ address: host, family: net.isIPv6(host) ? 6 : 4 }] }
  }

  let results: { address: string; family: number }[]
  try {
    results = await dns.lookup(host, { all: true })
  } catch {
    return { ok: false, reason: 'url host could not be resolved' }
  }
  if (results.length === 0) return { ok: false, reason: 'url host did not resolve' }
  for (const r of results) {
    if (isPrivateIp(r.address)) {
      return { ok: false, reason: 'url host resolves to a private or reserved address' }
    }
  }
  return { ok: true, host, addresses: results.map((r) => ({ address: r.address, family: r.family })) }
}
