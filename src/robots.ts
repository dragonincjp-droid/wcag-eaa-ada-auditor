import { validateUrlAgainstSsrf, type DnsLookupFn } from './ssrf.js';

interface RobotsRule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
  specificity: number;
}

interface ParsedRobotsPolicy {
  fetchedAt: number;
  rules: RobotsRule[];
  crawlDelayMs: number;
}

export interface RobotsCheckResult {
  allowed: boolean;
  crawlDelayMs: number;
  matchedRule?: string;
}

const BOT_USER_AGENT_TOKENS = ['wcag-eaa-ada-auditor', 'apify', '*'];
const ROBOTS_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ROBOTS_BYTES = 128 * 1024;
const MAX_CRAWL_DELAY_MS = 10_000;

function patternToRegExp(rawPattern: string): RegExp {
  const hasEndAnchor = rawPattern.endsWith('$');
  const body = hasEndAnchor ? rawPattern.slice(0, -1) : rawPattern;
  const escaped = body
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${hasEndAnchor ? '$' : ''}`);
}

export function parseRobotsTxt(content: string): { rules: RobotsRule[]; crawlDelayMs: number } {
  const lines = content.split(/\r?\n/);

  interface AgentGroup {
    agents: string[];
    rules: RobotsRule[];
    crawlDelayMs: number;
  }

  const groups: AgentGroup[] = [];
  let currentGroup: AgentGroup | null = null;
  let lastLineWasUserAgent = false;

  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf('#');
    const cleanLine = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (!cleanLine) {
      lastLineWasUserAgent = false;
      continue;
    }

    const colonIdx = cleanLine.indexOf(':');
    if (colonIdx < 0) continue;

    const directive = cleanLine.slice(0, colonIdx).trim().toLowerCase();
    const value = cleanLine.slice(colonIdx + 1).trim();

    if (directive === 'user-agent') {
      const ua = value.toLowerCase();
      if (!currentGroup || !lastLineWasUserAgent) {
        currentGroup = { agents: [ua], rules: [], crawlDelayMs: 0 };
        groups.push(currentGroup);
      } else {
        currentGroup.agents.push(ua);
      }
      lastLineWasUserAgent = true;
      continue;
    }

    lastLineWasUserAgent = false;
    if (!currentGroup) continue;

    if (directive === 'allow' || directive === 'disallow') {
      if (!value) {
        // Empty Disallow means allow all per RFC 9309
        continue;
      }
      const normalizedPattern = value.startsWith('/') || value.startsWith('*') ? value : `/${value}`;
      currentGroup.rules.push({
        allow: directive === 'allow',
        pattern: normalizedPattern,
        regex: patternToRegExp(normalizedPattern),
        specificity: normalizedPattern.replace(/\*/g, '').length,
      });
    } else if (directive === 'crawl-delay') {
      const secs = Number(value);
      if (!Number.isNaN(secs) && secs > 0) {
        currentGroup.crawlDelayMs = Math.min(Math.round(secs * 1000), MAX_CRAWL_DELAY_MS);
      }
    }
  }

  // Pick specific agent match before wildcard '*'
  for (const token of BOT_USER_AGENT_TOKENS) {
    const matchingGroups = groups.filter((g) =>
      g.agents.some((ua) => (token === '*' ? ua === '*' : ua.includes(token))),
    );
    if (matchingGroups.length > 0) {
      const mergedRules: RobotsRule[] = [];
      let crawlDelayMs = 0;
      for (const grp of matchingGroups) {
        mergedRules.push(...grp.rules);
        if (grp.crawlDelayMs > crawlDelayMs) {
          crawlDelayMs = grp.crawlDelayMs;
        }
      }
      return { rules: mergedRules, crawlDelayMs };
    }
  }

  return { rules: [], crawlDelayMs: 0 };
}

export function evaluateRobotsRules(pathAndQuery: string, rules: RobotsRule[]): { allowed: boolean; matchedRule?: string } {
  let bestMatch: RobotsRule | null = null;

  for (const rule of rules) {
    if (rule.regex.test(pathAndQuery)) {
      if (
        !bestMatch ||
        rule.specificity > bestMatch.specificity ||
        (rule.specificity === bestMatch.specificity && rule.allow)
      ) {
        bestMatch = rule;
      }
    }
  }

  if (!bestMatch) {
    return { allowed: true };
  }
  return {
    allowed: bestMatch.allow,
    matchedRule: `${bestMatch.allow ? 'Allow' : 'Disallow'}: ${bestMatch.pattern}`,
  };
}

const MAX_GUARD_MAP_ENTRIES = 2_000;

export class RobotsAndRateGuard {
  private readonly cache = new Map<string, ParsedRobotsPolicy>();
  private readonly domainNextSlotMs = new Map<string, number>();

  private enforceCacheLimit(now: number): void {
    if (this.cache.size < MAX_GUARD_MAP_ENTRIES) return;
    for (const [k, v] of this.cache) {
      if (now - v.fetchedAt > ROBOTS_CACHE_TTL_MS) {
        this.cache.delete(k);
      }
    }
    while (this.cache.size >= MAX_GUARD_MAP_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  private enforceSlotMapLimit(now: number): void {
    if (this.domainNextSlotMs.size < MAX_GUARD_MAP_ENTRIES) return;
    for (const [k, slotMs] of this.domainNextSlotMs) {
      if (slotMs <= now) {
        this.domainNextSlotMs.delete(k);
      }
    }
    while (this.domainNextSlotMs.size >= MAX_GUARD_MAP_ENTRIES) {
      const oldestKey = this.domainNextSlotMs.keys().next().value;
      if (oldestKey === undefined) break;
      this.domainNextSlotMs.delete(oldestKey);
    }
  }

  public async checkUrlAllowed(
    targetUrl: string,
    options?: { allowLocalhost?: boolean; dnsLookup?: DnsLookupFn },
  ): Promise<RobotsCheckResult> {
    const parsed = new URL(targetUrl);
    const origin = parsed.origin;
    const now = Date.now();

    let policy = this.cache.get(origin);
    if (!policy || now - policy.fetchedAt > ROBOTS_CACHE_TTL_MS) {
      policy = await this.fetchOriginRobots(origin, options);
      this.enforceCacheLimit(now);
      this.cache.set(origin, policy);
    }

    const pathAndQuery = `${parsed.pathname || '/'}${parsed.search || ''}`;
    const evalResult = evaluateRobotsRules(pathAndQuery, policy.rules);

    return {
      allowed: evalResult.allowed,
      crawlDelayMs: policy.crawlDelayMs,
      matchedRule: evalResult.matchedRule,
    };
  }

  public async waitForDomainSlot(hostname: string, minDelayMs: number): Promise<void> {
    if (minDelayMs <= 0) return;
    const key = hostname.toLowerCase();
    const now = Date.now();
    const scheduled = this.domainNextSlotMs.get(key) ?? now;
    const waitMs = Math.max(0, scheduled - now);
    this.enforceSlotMapLimit(now);
    this.domainNextSlotMs.set(key, Math.max(now, scheduled) + minDelayMs);

    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private async fetchOriginRobots(
    origin: string,
    options?: { allowLocalhost?: boolean; dnsLookup?: DnsLookupFn },
  ): Promise<ParsedRobotsPolicy> {
    let currentUrl = `${origin}/robots.txt`;
    const maxRedirects = 3;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const ssrf = await validateUrlAgainstSsrf(currentUrl, options);
      if (!ssrf.allowed) {
        return { fetchedAt: Date.now(), rules: [], crawlDelayMs: 0 };
      }

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': 'WCAG-EAA-ADA-Auditor/1.0 (+https://apify.com)',
            Accept: 'text/plain,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Network error fetching robots.txt -> treat as unavailable (RFC 9309 allow)
        return { fetchedAt: Date.now(), rules: [], crawlDelayMs: 0 };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return { fetchedAt: Date.now(), rules: [], crawlDelayMs: 0 };
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        } catch {
          return { fetchedAt: Date.now(), rules: [], crawlDelayMs: 0 };
        }
      }

      if (response.status !== 200) {
        return { fetchedAt: Date.now(), rules: [], crawlDelayMs: 0 };
      }

      try {
        const buf = await response.arrayBuffer();
        const slice = buf.byteLength > MAX_ROBOTS_BYTES ? buf.slice(0, MAX_ROBOTS_BYTES) : buf;
        const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
        const parsed = parseRobotsTxt(text);
        return {
          fetchedAt: Date.now(),
          rules: parsed.rules,
          crawlDelayMs: parsed.crawlDelayMs,
        };
      } catch {
        return { fetchedAt: Date.now(), rules: [], crawlDelayMs: 0 };
      }
    }

    return { fetchedAt: Date.now(), rules: [], crawlDelayMs: 0 };
  }
}
