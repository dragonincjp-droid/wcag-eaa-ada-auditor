import dns from 'node:dns/promises';
import net from 'node:net';

export interface SsrfValidationResult {
  allowed: boolean;
  normalizedUrl?: string;
  hostname?: string;
  resolvedIps?: string[];
  reason?: string;
}

export type DnsLookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const dnsCache = new Map<
  string,
  { expiresAt: number; records: Array<{ address: string; family: number }> }
>();
const DNS_CACHE_TTL_MS = 60_000;
const MAX_DNS_CACHE_ENTRIES = 2_000;

function pruneDnsCache(now: number): void {
  if (dnsCache.size < MAX_DNS_CACHE_ENTRIES) return;
  for (const [k, v] of dnsCache) {
    if (v.expiresAt <= now) {
      dnsCache.delete(k);
    }
  }
  while (dnsCache.size >= MAX_DNS_CACHE_ENTRIES) {
    const oldestKey = dnsCache.keys().next().value;
    if (oldestKey === undefined) break;
    dnsCache.delete(oldestKey);
  }
}

const defaultDnsLookup: DnsLookupFn = async (hostname: string) => {
  const key = hostname.toLowerCase();
  const cached = dnsCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.records;
  }
  const records = await dns.lookup(key, { all: true, verbatim: true });
  pruneDnsCache(now);
  dnsCache.set(key, { expiresAt: now + DNS_CACHE_TTL_MS, records });
  return records;
};

export function isAllowLocalhostEnabled(overrideAllowLocalhost?: boolean): boolean {
  if (typeof overrideAllowLocalhost === 'boolean') {
    return overrideAllowLocalhost;
  }
  return process.env.ALLOW_LOCALHOST_FOR_TESTS === '1';
}

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    acc = ((acc << 8) | octet) >>> 0;
  }
  return acc >>> 0;
}

function inCidrV4(ipUint: number, baseIp: string, prefixBits: number): boolean {
  const baseUint = ipv4ToUint32(baseIp);
  if (baseUint === null) return false;
  const mask = prefixBits === 0 ? 0 : (~0 << (32 - prefixBits)) >>> 0;
  return ((ipUint & mask) >>> 0) === ((baseUint & mask) >>> 0);
}

/**
 * Normalizes any valid IPv6 text representation (compressed `::`, zero-padded 8x16-bit hex,
 * or embedded trailing IPv4 dotted-quad such as `0:0:0:0:0:ffff:169.254.169.254`) into 8 uint16 hextets.
 */
export function parseIpv6ToHextets(rawIpv6: string): Uint16Array | null {
  let normalized = rawIpv6.trim().toLowerCase();
  if (net.isIP(normalized) !== 6) {
    return null;
  }

  // Convert embedded trailing IPv4 dotted-quad (e.g. ::127.0.0.1 or 0:0:0:0:0:ffff:169.254.169.254)
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    if (lastColon < 0) return null;
    const v4Part = normalized.slice(lastColon + 1);
    const v4Uint = ipv4ToUint32(v4Part);
    if (v4Uint === null) return null;
    const hiHex = ((v4Uint >>> 16) & 0xffff).toString(16);
    const loHex = (v4Uint & 0xffff).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${hiHex}:${loHex}`;
  }

  let groups: string[];
  if (normalized.includes('::')) {
    const doubleColonParts = normalized.split('::');
    if (doubleColonParts.length !== 2) return null;
    const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
    const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    groups = [...left, ...new Array<string>(missing).fill('0'), ...right];
  } else {
    groups = normalized.split(':');
  }

  if (groups.length !== 8) return null;

  const hextets = new Uint16Array(8);
  for (let i = 0; i < 8; i += 1) {
    const g = groups[i];
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    hextets[i] = parseInt(g, 16) & 0xffff;
  }
  return hextets;
}

function hextetsToIpv4String(hi16: number, lo16: number): string {
  return `${(hi16 >>> 8) & 0xff}.${hi16 & 0xff}.${(lo16 >>> 8) & 0xff}.${lo16 & 0xff}`;
}

export function classifyIpAddress(
  rawIp: string,
  allowLocalhost = false,
): { allowed: boolean; reason?: string } {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const version = net.isIP(ip);

  if (version === 4) {
    const ipUint = ipv4ToUint32(ip);
    if (ipUint === null) {
      return { allowed: false, reason: `Malformed IPv4 address: ${rawIp}` };
    }
    if (inCidrV4(ipUint, '127.0.0.0', 8)) {
      return allowLocalhost
        ? { allowed: true }
        : { allowed: false, reason: `Loopback IPv4 address blocked (${ip})` };
    }
    if (inCidrV4(ipUint, '0.0.0.0', 8)) {
      return { allowed: false, reason: `Unspecified/current-network IPv4 blocked (${ip})` };
    }
    if (inCidrV4(ipUint, '10.0.0.0', 8)) {
      return { allowed: false, reason: `Private RFC1918 IPv4 10.0.0.0/8 blocked (${ip})` };
    }
    if (inCidrV4(ipUint, '172.16.0.0', 12)) {
      return { allowed: false, reason: `Private RFC1918 IPv4 172.16.0.0/12 blocked (${ip})` };
    }
    if (inCidrV4(ipUint, '192.168.0.0', 16)) {
      return { allowed: false, reason: `Private RFC1918 IPv4 192.168.0.0/16 blocked (${ip})` };
    }
    if (inCidrV4(ipUint, '169.254.0.0', 16)) {
      return { allowed: false, reason: `Link-local / Cloud IMDS IPv4 169.254.0.0/16 blocked (${ip})` };
    }
    if (inCidrV4(ipUint, '100.64.0.0', 10)) {
      return { allowed: false, reason: `Carrier-grade NAT / Cloud internal IPv4 100.64.0.0/10 blocked (${ip})` };
    }
    if (
      inCidrV4(ipUint, '192.0.0.0', 24) ||
      inCidrV4(ipUint, '192.0.2.0', 24) ||
      inCidrV4(ipUint, '198.51.100.0', 24) ||
      inCidrV4(ipUint, '203.0.113.0', 24)
    ) {
      return { allowed: false, reason: `Reserved/documentation IPv4 range blocked (${ip})` };
    }
    if (inCidrV4(ipUint, '198.18.0.0', 15)) {
      return { allowed: false, reason: `Benchmark IPv4 198.18.0.0/15 blocked (${ip})` };
    }
    if (inCidrV4(ipUint, '224.0.0.0', 4) || inCidrV4(ipUint, '240.0.0.0', 4)) {
      return { allowed: false, reason: `Multicast/reserved IPv4 range blocked (${ip})` };
    }
    return { allowed: true };
  }

  if (version === 6) {
    const h = parseIpv6ToHextets(ip);
    if (!h) {
      return { allowed: false, reason: `Malformed IPv6 address: ${rawIp}` };
    }

    const prefix80Zero = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
    const prefix96Zero = prefix80Zero && h[5] === 0;

    // 1. Unspecified ::/128
    if (prefix96Zero && h[6] === 0 && h[7] === 0) {
      return { allowed: false, reason: 'Unspecified IPv6 ::/128 blocked' };
    }

    // 2. Loopback ::1/128 (including expanded 0000:0000:0000:0000:0000:0000:0000:0001)
    if (prefix96Zero && h[6] === 0 && h[7] === 1) {
      return allowLocalhost
        ? { allowed: true }
        : { allowed: false, reason: `Loopback IPv6 ::1/128 blocked (${ip})` };
    }

    // 3. Deprecated IPv4-compatible ::/96 (e.g. ::127.0.0.1, ::169.254.169.254)
    if (prefix96Zero) {
      return { allowed: false, reason: `IPv4-compatible IPv6 ::/96 blocked (${ip})` };
    }

    // 4. IPv4-mapped ::ffff:0:0/96 (including 0:0:0:0:0:ffff:169.254.169.254)
    if (prefix80Zero && h[5] === 0xffff) {
      const mappedIpv4 = hextetsToIpv4String(h[6], h[7]);
      return classifyIpAddress(mappedIpv4, allowLocalhost);
    }

    // 5. IPv4-translated ::ffff:0:0:0/96 (SIIT RFC 2765)
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0xffff && h[5] === 0) {
      const translatedIpv4 = hextetsToIpv4String(h[6], h[7]);
      return classifyIpAddress(translatedIpv4, allowLocalhost);
    }

    // 6. NAT64 Well-Known Prefix 64:ff9b::/96 & Local-Use 64:ff9b:1::/48
    if (
      h[0] === 0x0064 &&
      h[1] === 0xff9b &&
      ((h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) || h[2] === 0x0001)
    ) {
      return { allowed: false, reason: `NAT64 transition IPv6 prefix blocked (${ip})` };
    }

    // 7. Discard-Only Prefix 100::/64 (RFC 6666)
    if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
      return { allowed: false, reason: `Discard-only IPv6 100::/64 blocked (${ip})` };
    }

    // 8. IETF Protocol Assignments 2001::/23 (Teredo 2001::/32, Benchmarking 2001:2::/48, etc.)
    if (h[0] === 0x2001 && (h[1] & 0xfe00) === 0x0000) {
      return { allowed: false, reason: `IETF special-purpose IPv6 2001::/23 blocked (${ip})` };
    }

    // 9. Documentation 2001:db8::/32 (RFC 3849)
    if (h[0] === 0x2001 && h[1] === 0x0db8) {
      return { allowed: false, reason: `Documentation IPv6 2001:db8::/32 blocked (${ip})` };
    }

    // 10. 6to4 2002::/16 — inspect embedded upper-32-bit IPv4 (2002:WWXX:YYZZ::/48)
    if (h[0] === 0x2002) {
      const embedded6to4Ipv4 = hextetsToIpv4String(h[1], h[2]);
      const innerCheck = classifyIpAddress(embedded6to4Ipv4, allowLocalhost);
      if (!innerCheck.allowed) {
        return {
          allowed: false,
          reason: `6to4 IPv6 2002::/16 encapsulates restricted IPv4 (${embedded6to4Ipv4}): ${innerCheck.reason}`,
        };
      }
      return { allowed: false, reason: `Deprecated 6to4 IPv6 2002::/16 transition range blocked (${ip})` };
    }

    // 11. Unique Local fc00::/7 (fc00:: - fdff::)
    if ((h[0] & 0xfe00) === 0xfc00) {
      return { allowed: false, reason: `Unique local IPv6 fc00::/7 blocked (${ip})` };
    }

    // 12. Link-Local fe80::/10 (fe80:: - febf::)
    if ((h[0] & 0xffc0) === 0xfe80) {
      return { allowed: false, reason: `Link-local IPv6 fe80::/10 blocked (${ip})` };
    }

    // 13. Site-Local (deprecated RFC 3879) fec0::/10 (fec0:: - feff::)
    if ((h[0] & 0xffc0) === 0xfec0) {
      return { allowed: false, reason: `Deprecated site-local IPv6 fec0::/10 blocked (${ip})` };
    }

    // 14. Multicast ff00::/8
    if ((h[0] & 0xff00) === 0xff00) {
      return { allowed: false, reason: `Multicast IPv6 ff00::/8 blocked (${ip})` };
    }

    return { allowed: true };
  }

  return { allowed: false, reason: `Unrecognized IP address format: ${rawIp}` };
}

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

export async function validateUrlAgainstSsrf(
  rawUrl: string,
  options?: { allowLocalhost?: boolean; dnsLookup?: DnsLookupFn },
): Promise<SsrfValidationResult> {
  const allowLocalhost = isAllowLocalhostEnabled(options?.allowLocalhost);
  const lookup = options?.dnsLookup ?? defaultDnsLookup;

  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { allowed: false, reason: 'URL is empty or not a string.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { allowed: false, reason: `Invalid URL syntax: ${rawUrl}` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      allowed: false,
      reason: `Disallowed URL scheme "${parsed.protocol}" (only http:// and https:// are permitted).`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      allowed: false,
      reason: 'URLs containing embedded credentials (user:pass@host) are blocked for security.',
    };
  }

  const rawHost = parsed.hostname.trim().toLowerCase();
  const bareHost = rawHost.replace(/^\[|\]$/g, '');

  if (!bareHost) {
    return { allowed: false, reason: 'URL is missing a valid hostname.' };
  }

  if (BLOCKED_HOSTNAMES.has(bareHost) || bareHost.endsWith('.internal') || bareHost.endsWith('.local')) {
    return {
      allowed: false,
      hostname: bareHost,
      reason: `Internal/metadata hostname blocked: ${bareHost}`,
    };
  }

  if (bareHost === 'localhost' || bareHost.endsWith('.localhost')) {
    if (!allowLocalhost) {
      return {
        allowed: false,
        hostname: bareHost,
        reason: `Localhost target blocked (${bareHost}).`,
      };
    }
    return {
      allowed: true,
      normalizedUrl: parsed.toString(),
      hostname: bareHost,
      resolvedIps: ['127.0.0.1'],
    };
  }

  // Direct IP literal check
  if (net.isIP(bareHost) !== 0 || rawHost.startsWith('[')) {
    const ipCheck = classifyIpAddress(bareHost, allowLocalhost);
    if (!ipCheck.allowed) {
      return {
        allowed: false,
        hostname: bareHost,
        reason: ipCheck.reason,
      };
    }
    return {
      allowed: true,
      normalizedUrl: parsed.toString(),
      hostname: bareHost,
      resolvedIps: [bareHost],
    };
  }

  // Resolve DNS records and ensure EVERY resolved IP is safe (prevents DNS rebinding / dual-record bypass)
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(bareHost);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      allowed: false,
      hostname: bareHost,
      reason: `DNS resolution failed for "${bareHost}": ${msg}`,
    };
  }

  if (!Array.isArray(records) || records.length === 0) {
    return {
      allowed: false,
      hostname: bareHost,
      reason: `DNS returned no IP records for "${bareHost}".`,
    };
  }

  const resolvedIps: string[] = [];
  for (const rec of records) {
    const ipCheck = classifyIpAddress(rec.address, allowLocalhost);
    if (!ipCheck.allowed) {
      return {
        allowed: false,
        hostname: bareHost,
        resolvedIps: records.map((r) => r.address),
        reason: `DNS resolved "${bareHost}" to restricted IP ${rec.address}: ${ipCheck.reason}`,
      };
    }
    resolvedIps.push(rec.address);
  }

  return {
    allowed: true,
    normalizedUrl: parsed.toString(),
    hostname: bareHost,
    resolvedIps,
  };
}
