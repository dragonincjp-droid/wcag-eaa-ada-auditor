import { ApifyRuntimeAdapter } from './apifyRuntime.js';
import { BillingManager, type BillingSummary } from './billing.js';
import { createBrowserAuditEngine, type BrowserAuditEngine } from './browser.js';
import { detectAccessibilityStatement, detectOverlayWidgets } from './detectors.js';
import {
  buildPrioritizedRemediations,
  buildViolationsSummary,
  calculateLegalRiskScore,
  generateSalesPitchHook,
} from './remediation.js';
import { RobotsAndRateGuard } from './robots.js';
import { validateUrlAgainstSsrf, type DnsLookupFn } from './ssrf.js';
import {
  DEFAULT_WCAG_AA_TAGS,
  DEFAULT_WCAG_A_TAGS,
  LEGAL_DISCLAIMER,
  PPE_EVENTS,
  type AuditReportItem,
  type AuditStatus,
  type DomPageSnapshot,
  type NormalizedAuditInput,
  type RawActorInput,
  type RawAxeScanOutput,
  type UrlRequestObject,
} from './types.js';

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (Number.isNaN(num) || !Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function coerceUrlCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function extractRawUrlStrings(rawInput: RawActorInput | null | undefined): string[] {
  if (!rawInput) return [];
  const collected: string[] = [];

  const appendList = (list?: Array<string | UrlRequestObject>) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (typeof item === 'string') {
        const u = coerceUrlCandidate(item);
        if (u) collected.push(u);
      } else if (item && typeof item === 'object' && typeof item.url === 'string') {
        const u = coerceUrlCandidate(item.url);
        if (u) collected.push(u);
      }
    }
  };

  appendList(rawInput.urls);
  appendList(rawInput.startUrls);

  if (typeof rawInput.url === 'string') {
    const single = coerceUrlCandidate(rawInput.url);
    if (single) collected.push(single);
  }

  return Array.from(new Set(collected));
}

export function normalizeAuditInput(
  rawInput: RawActorInput | null | undefined,
  maxUrlsHardCap = 5000,
): NormalizedAuditInput {
  const input = rawInput ?? {};
  const maxUrls = clampInt(input.maxUrls, 100, 1, maxUrlsHardCap);
  const dedupedUrls = extractRawUrlStrings(input).slice(0, maxUrls);

  const wcagLevel: 'AA' | 'A' = input.wcagLevel === 'A' ? 'A' : 'AA';
  const defaultTags = wcagLevel === 'A' ? [...DEFAULT_WCAG_A_TAGS] : [...DEFAULT_WCAG_AA_TAGS];
  const wcagTags =
    Array.isArray(input.wcagTags) && input.wcagTags.length > 0
      ? input.wcagTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : defaultTags;

  const navSecs = clampInt(input.navigationTimeoutSecs, 30, 5, 120);

  return {
    urls: dedupedUrls,
    wcagLevel,
    wcagTags,
    includeVisualEvidence: input.includeVisualEvidence ?? true,
    fullPageScreenshot: input.fullPageScreenshot ?? false,
    detectOverlays: input.detectOverlays ?? true,
    checkAccessibilityStatement: input.checkAccessibilityStatement ?? true,
    respectRobotsTxt: input.respectRobotsTxt ?? true,
    maxUrls,
    maxConcurrency: clampInt(input.maxConcurrency, 3, 1, 10),
    domainDelayMs: clampInt(input.domainDelayMs, 1000, 0, 30_000),
    navigationTimeoutMs: navSecs * 1000,
    maxViolationsPerUrl: clampInt(input.maxViolationsPerUrl, 10, 1, 50),
    maxTotalChargeUsd:
      typeof input.maxTotalChargeUsd === 'number' && !Number.isNaN(input.maxTotalChargeUsd)
        ? input.maxTotalChargeUsd
        : undefined,
  };
}

function safeExtractHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return 'invalid-host';
  }
}

function buildBlockedOrErrorItem(params: {
  url: string;
  status: Exclude<AuditStatus, 'audited'>;
  reason: string;
  loadTimeMs: number;
}): AuditReportItem {
  const domain = safeExtractHostname(params.url);
  return {
    url: params.url,
    finalUrl: null,
    domain,
    auditedAt: new Date().toISOString(),
    status: params.status,
    httpStatus: null,
    pageTitle: null,
    loadTimeMs: params.loadTimeMs,
    errorMessage: params.reason,
    legalRiskScore: 0,
    riskTier: 'LOW',
    summary: {
      totalViolations: 0,
      totalAffectedNodes: 0,
      criticalCount: 0,
      seriousCount: 0,
      moderateCount: 0,
      minorCount: 0,
      passedChecksCount: 0,
      incompleteChecksCount: 0,
    },
    overlayDetected: false,
    overlayVendors: [],
    overlayDetection: {
      overlayDetected: false,
      overlayVendors: [],
      regulatoryWarning: null,
      matchedSignals: [],
    },
    accessibilityStatementFound: false,
    accessibilityStatementUrl: null,
    eaaCompliance: {
      accessibilityStatementFound: false,
      statementUrl: null,
      statementText: null,
      detectedLanguage: null,
      location: null,
      missingStatementRisk: `N/A — Scan skipped (${params.status}).`,
    },
    salesPitchHook: '',
    visualEvidenceKey: null,
    visualEvidenceUrl: null,
    visualEvidence: {
      generated: false,
      key: null,
      url: null,
      highlightedCount: 0,
      byteLength: 0,
    },
    topViolations: [],
    disclaimer: LEGAL_DISCLAIMER,
  };
}

export interface AuditExecutionDependencies {
  runtime?: ApifyRuntimeAdapter;
  engine?: BrowserAuditEngine;
  robotsGuard?: RobotsAndRateGuard;
  billing?: BillingManager;
  allowLocalhost?: boolean;
  dnsLookup?: DnsLookupFn;
  pushToDataset?: boolean;
  chargeActorStart?: boolean;
}

export interface BatchAuditResult {
  items: AuditReportItem[];
  billing: BillingSummary;
  stoppedDueToBudgetCap: boolean;
  engineName: string;
}

export async function auditSingleUrl(params: {
  rawUrl: string;
  config: NormalizedAuditInput;
  engine: BrowserAuditEngine;
  runtime: ApifyRuntimeAdapter;
  billing: BillingManager;
  robotsGuard: RobotsAndRateGuard;
  allowLocalhost?: boolean;
  dnsLookup?: DnsLookupFn;
}): Promise<{ item: AuditReportItem | null; budgetStopped: boolean }> {
  const { rawUrl, config, engine, runtime, billing, robotsGuard, allowLocalhost, dnsLookup } = params;
  const startedMs = Date.now();

  // 1. Strict SSRF Pre-Flight Validation (URL scheme + IPv4/IPv6 CIDR + DNS resolution)
  const ssrf = await validateUrlAgainstSsrf(rawUrl, { allowLocalhost, dnsLookup });
  if (!ssrf.allowed || !ssrf.normalizedUrl || !ssrf.hostname) {
    return {
      item: buildBlockedOrErrorItem({
        url: rawUrl,
        status: 'blocked_ssrf',
        reason: ssrf.reason || 'Blocked by SSRF security policy.',
        loadTimeMs: Date.now() - startedMs,
      }),
      budgetStopped: false,
    };
  }

  const normalizedUrl = ssrf.normalizedUrl;
  const hostname = ssrf.hostname;

  // 2. Budget Ceiling Pre-Check before launching tab
  if (!billing.canAfford(PPE_EVENTS.URL_AUDITED, 1)) {
    return { item: null, budgetStopped: true };
  }

  // 3. Polite robots.txt check
  let effectiveDelayMs = config.domainDelayMs;
  if (config.respectRobotsTxt) {
    const robots = await robotsGuard.checkUrlAllowed(normalizedUrl, { allowLocalhost, dnsLookup });
    if (!robots.allowed) {
      return {
        item: buildBlockedOrErrorItem({
          url: rawUrl,
          status: 'blocked_robots',
          reason: `Disallowed by domain robots.txt (${robots.matchedRule || 'Disallow rule'}).`,
          loadTimeMs: Date.now() - startedMs,
        }),
        budgetStopped: false,
      };
    }
    if (robots.crawlDelayMs > effectiveDelayMs) {
      effectiveDelayMs = robots.crawlDelayMs;
    }
  }

  // 4. Polite per-domain rate limit
  await robotsGuard.waitForDomainSlot(hostname, effectiveDelayMs);

  // Re-check budget in case a concurrent worker consumed remaining budget while waiting
  if (!billing.canAfford(PPE_EVENTS.URL_AUDITED, 1)) {
    return { item: null, budgetStopped: true };
  }

  const canAffordScreenshotIfAudited =
    config.includeVisualEvidence &&
    (billing.getSummary().maxBudgetUsd === null ||
      billing.getSummary().estimatedTotalUsd + 0.025 + 0.015 <=
        (billing.getSummary().maxBudgetUsd ?? Infinity) + 1e-9);

  try {
    const buildState = (
      axeOutput: RawAxeScanOutput,
      snapshot: DomPageSnapshot,
      finalUrl: string,
    ) => {
      const finalDomain = safeExtractHostname(finalUrl);
      const summary = buildViolationsSummary(
        axeOutput.violations,
        axeOutput.passesCount,
        axeOutput.incompleteCount,
      );
      const overlay = config.detectOverlays
        ? detectOverlayWidgets(snapshot, summary.criticalCount + summary.seriousCount)
        : {
            overlayDetected: false,
            overlayVendors: [] as string[],
            regulatoryWarning: null,
            matchedSignals: [],
          };
      const eaa = config.checkAccessibilityStatement
        ? detectAccessibilityStatement(snapshot.anchors, finalUrl)
        : {
            accessibilityStatementFound: false,
            statementUrl: null,
            statementText: null,
            detectedLanguage: null,
            location: null,
            missingStatementRisk: 'Not checked (checkAccessibilityStatement=false).',
          };
      const { legalRiskScore, riskTier } = calculateLegalRiskScore({
        summary,
        overlay,
        eaa,
        checkAccessibilityStatement: config.checkAccessibilityStatement,
      });
      const remediations = buildPrioritizedRemediations(
        axeOutput.violations,
        config.maxViolationsPerUrl,
      );
      return {
        domain: finalDomain,
        summary,
        overlay,
        eaa,
        legalRiskScore,
        riskTier,
        remediations,
      };
    };

    let precomputed: ReturnType<typeof buildState> | undefined;

    const scanResult = await engine.scanPage({
      url: normalizedUrl,
      wcagTags: config.wcagTags,
      navigationTimeoutMs: config.navigationTimeoutMs,
      includeVisualEvidence: canAffordScreenshotIfAudited,
      fullPageScreenshot: config.fullPageScreenshot,
      allowLocalhost,
      dnsLookup,
      prepareVisualRemediation: (axeOutput, snapshot, finalUrl) => {
        const st = buildState(axeOutput, snapshot, finalUrl);
        precomputed = st;
        return {
          remediations: st.remediations,
          domain: st.domain,
          legalRiskScore: st.legalRiskScore,
        };
      },
    });

    // Charge `url-audited` event
    const urlCharge = await billing.chargeEvent(PPE_EVENTS.URL_AUDITED, 1);
    if (!urlCharge.charged) {
      return { item: null, budgetStopped: true };
    }

    const computedState =
      precomputed ?? buildState(scanResult.axeOutput, scanResult.domSnapshot, scanResult.finalUrl);

    let visualEvidenceKey: string | null = null;
    let visualEvidenceUrl: string | null = null;
    let visualByteLength = 0;
    let visualGenerated = false;

    if (
      scanResult.screenshotPng &&
      scanResult.screenshotPng.byteLength > 0 &&
      billing.canAfford(PPE_EVENTS.VISUAL_EVIDENCE_GENERATED, 1)
    ) {
      const hostSlug = computedState.domain.replace(/[^a-z0-9.-]/gi, '-').slice(0, 50);
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const candidateKey = `evidence-${hostSlug}-${uniqueSuffix}.png`;

      const saved = await runtime.savePngToKeyValueStore(candidateKey, scanResult.screenshotPng);
      const imgCharge = await billing.chargeEvent(PPE_EVENTS.VISUAL_EVIDENCE_GENERATED, 1);
      if (imgCharge.charged) {
        visualEvidenceKey = saved.key;
        visualEvidenceUrl = saved.publicUrl;
        visualByteLength = scanResult.screenshotPng.byteLength;
        visualGenerated = true;
      }
    }

    const salesPitchHook = generateSalesPitchHook({
      domain: computedState.domain,
      summary: computedState.summary,
      overlay: computedState.overlay,
      eaa: computedState.eaa,
      topViolations: computedState.remediations,
      checkAccessibilityStatement: config.checkAccessibilityStatement,
    });

    const reportItem: AuditReportItem = {
      url: rawUrl,
      finalUrl: scanResult.finalUrl,
      domain: computedState.domain,
      auditedAt: new Date().toISOString(),
      status: 'audited',
      httpStatus: scanResult.httpStatus,
      pageTitle: scanResult.pageTitle,
      loadTimeMs: Date.now() - startedMs,
      legalRiskScore: computedState.legalRiskScore,
      riskTier: computedState.riskTier,
      summary: computedState.summary,
      overlayDetected: computedState.overlay.overlayDetected,
      overlayVendors: computedState.overlay.overlayVendors,
      overlayDetection: computedState.overlay,
      accessibilityStatementFound: computedState.eaa.accessibilityStatementFound,
      accessibilityStatementUrl: computedState.eaa.statementUrl,
      eaaCompliance: computedState.eaa,
      salesPitchHook,
      visualEvidenceKey,
      visualEvidenceUrl,
      visualEvidence: {
        generated: visualGenerated,
        key: visualEvidenceKey,
        url: visualEvidenceUrl,
        highlightedCount: visualGenerated ? scanResult.highlightedCount : 0,
        byteLength: visualByteLength,
      },
      topViolations: computedState.remediations,
      disclaimer: LEGAL_DISCLAIMER,
    };

    return { item: reportItem, budgetStopped: billing.isLimitReached() };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isSsrfRedirect = /SSRF guard blocked/i.test(rawMsg);
    return {
      item: buildBlockedOrErrorItem({
        url: rawUrl,
        status: isSsrfRedirect ? 'blocked_ssrf' : 'error',
        reason: rawMsg,
        loadTimeMs: Date.now() - startedMs,
      }),
      budgetStopped: false,
    };
  }
}

export async function runBatchAudit(
  rawInput: RawActorInput | null | undefined,
  deps: AuditExecutionDependencies = {},
): Promise<BatchAuditResult> {
  const config = normalizeAuditInput(rawInput);
  const runtime = deps.runtime ?? new ApifyRuntimeAdapter();
  await runtime.init();

  const billing = deps.billing ?? new BillingManager(runtime, config.maxTotalChargeUsd);
  const robotsGuard = deps.robotsGuard ?? new RobotsAndRateGuard();
  const pushToDataset = deps.pushToDataset ?? true;
  const chargeActorStart = deps.chargeActorStart ?? true;

  if (chargeActorStart) {
    const startCharge = await billing.chargeEvent(PPE_EVENTS.ACTOR_START, 1);
    if (!startCharge.charged) {
      return {
        items: [],
        billing: billing.getSummary(),
        stoppedDueToBudgetCap: true,
        engineName: 'none',
      };
    }
  }

  if (config.urls.length === 0) {
    return {
      items: [],
      billing: billing.getSummary(),
      stoppedDueToBudgetCap: false,
      engineName: 'none',
    };
  }

  const ownsEngine = !deps.engine;
  const engine = deps.engine ?? (await createBrowserAuditEngine());

  const orderedItems: Array<AuditReportItem | null> = new Array(config.urls.length).fill(null);
  let cursor = 0;
  let stoppedDueToBudgetCap = false;

  try {
    const workerCount = Math.min(config.maxConcurrency, config.urls.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (!stoppedDueToBudgetCap) {
        const index = cursor++;
        if (index >= config.urls.length) break;

        if (billing.isLimitReached() || !billing.canAfford(PPE_EVENTS.URL_AUDITED, 1)) {
          stoppedDueToBudgetCap = true;
          break;
        }

        const targetUrl = config.urls[index];
        const { item, budgetStopped } = await auditSingleUrl({
          rawUrl: targetUrl,
          config,
          engine,
          runtime,
          billing,
          robotsGuard,
          allowLocalhost: deps.allowLocalhost,
          dnsLookup: deps.dnsLookup,
        });

        if (item) {
          orderedItems[index] = item;
          if (pushToDataset) {
            await runtime.pushData(item);
          }
        }

        if (budgetStopped) {
          stoppedDueToBudgetCap = true;
          break;
        }
      }
    });

    await Promise.all(workers);
  } finally {
    if (ownsEngine) {
      await engine.close();
    }
  }

  const items = orderedItems.filter((x): x is AuditReportItem => x !== null);

  return {
    items,
    billing: billing.getSummary(),
    stoppedDueToBudgetCap,
    engineName: engine.engineName,
  };
}
