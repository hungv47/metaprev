// Single source of truth for host scope classification.
//
// Two policies read from one classifier so fetch behavior and repair-snippet
// behavior can never drift apart by accident:
//   - fetch keeps working for loopback/local dev targets (the product's job).
//   - repair outputs require a genuinely public host before emitting copy-ready URLs.

export type HostScope =
  | 'loopback' // this machine (127.0.0.0/8, ::1, 0.0.0.0)
  | 'local' // development names (*.localhost, *.test, *.local)
  | 'private' // RFC1918, CGNAT, link-local, ULA, and other non-routable ranges
  | 'reserved' // documentation, multicast, benchmark, and other special-purpose ranges
  | 'unspecified' // "::" or an empty host
  | 'public'

const LOCAL_NAME_RE = /^(?:[^.]+\.)*(?:localhost|test|local)$/i

function parseIpv4(host: string): [number, number, number, number] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return undefined
  const parts = host.split('.').map(Number)
  if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return undefined
  return parts as [number, number, number, number]
}

function ipv4Scope([a, b]: [number, number, number, number]): HostScope {
  if (a === 127) return 'loopback'
  if (a === 0) return 'unspecified' // "this network" 0.0.0.0/8 never routes publicly
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private'
  if (a === 100 && b >= 64 && b <= 127) return 'private' // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return 'private' // link-local
  if ((a === 192 && (b === 0 || b === 88)) || (a === 198 && b === 51) || (a === 203 && b === 0)) return 'reserved'
  if (a >= 224) return 'reserved' // multicast + reserved + broadcast
  return 'public'
}

function ipv6Scope(host: string): HostScope {
  const h = host.toLowerCase()
  if (h === '::') return 'unspecified'
  if (h === '::1') return 'loopback'
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible addresses inherit the v4 scope.
  const mapped = /^::ffff:(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(h)
  if (mapped) {
    if (mapped[1]) {
      const v4 = parseIpv4(mapped[1])
      if (v4) return ipv4Scope(v4)
    } else {
      const hi = parseInt(mapped[2]!, 16)
      const lo = parseInt(mapped[3]!, 16)
      return ipv4Scope([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff])
    }
  }
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return 'private' // unique-local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(h)) return 'private' // link-local fe80::/10
  if (/^ff[0-9a-f]{2}:/.test(h)) return 'reserved' // multicast ff00::/8
  if (/^2001:db8:/.test(h)) return 'reserved' // documentation
  if (/^100::/.test(h)) return 'reserved' // discard-only
  if (/^64:ff9b:/.test(h)) return 'reserved' // NAT64 well-known prefix (translation infra)
  return 'public'
}

/** Classify a URL hostname (brackets on IPv6 literals are tolerated). */
export function classifyHost(hostname: string): HostScope {
  let host = hostname.trim().replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) return 'unspecified'
  if (host.endsWith('.') && !host.endsWith('..')) host = host.slice(0, -1) // trailing dot FQDN form
  if (LOCAL_NAME_RE.test(host)) return 'local'
  if (host.includes(':')) return ipv6Scope(host)
  const v4 = parseIpv4(host)
  if (v4) return ipv4Scope(v4)
  return 'public'
}

export type HostPolicy = {
  /** Loopback + dev names: the targets a developer runs against locally. */
  isLocalDevHost: boolean
  /** Safe to emit as a copy-ready share URL in repair output. */
  isPublicHost: boolean
}

/** One shared classifier; callers pick the policy predicate they need. */
export function classifyUrlHost(url: string): HostPolicy {
  let hostname = ''
  try {
    hostname = new URL(url).hostname
  } catch {
    return { isLocalDevHost: false, isPublicHost: false }
  }
  const scope = classifyHost(hostname)
  return {
    isLocalDevHost: scope === 'loopback' || scope === 'local',
    isPublicHost: scope === 'public',
  }
}
