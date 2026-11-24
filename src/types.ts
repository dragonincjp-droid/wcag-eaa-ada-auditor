export const LEGAL_DISCLAIMER =
  'Automated technical WCAG 2.2 Level A/AA inspection result powered by axe-core and deterministic DOM heuristics. Automated scans identify technical code barriers (~40-57% of WCAG criteria) and do not constitute legal advice or a formal guarantee of regulatory compliance under the European Accessibility Act (EAA), US ADA, or Section 508.';

export const DEFAULT_WCAG_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
] as const;

export const DEFAULT_WCAG_A_TAGS = [
  'wcag2a',
  'wcag21a',
  'wcag22a',
  'best-practice',
] as const;

export const PPE_EVENTS = {
  ACTOR_START: 'actor-start',
  URL_AUDITED: 'url-audited',
  VISUAL_EVIDENCE_GENERATED: 'visual-evidence-generated',
} as const;

export type PpeEventName = (typeof PPE_EVENTS)[keyof typeof PPE_EVENTS];

export type RiskTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ViolationImpact = 'critical' | 'serious' | 'moderate' | 'minor';
export type AuditStatus = 'audited' | 'blocked_ssrf' | 'blocked_robots' | 'error';

export interface UrlRequestObject {
  url: string;
}

export interface RawActorInput {
  urls?: Array<string | UrlRequestObject>;
  startUrls?: Array<string | UrlRequestObject>;
  url?: string;
  wcagLevel?: 'AA' | 'A';
  wcagTags?: string[];
  includeVisualEvidence?: boolean;
  fullPageScreenshot?: boolean;
  detectOverlays?: boolean;
  checkAccessibilityStatement?: boolean;
  respectRobotsTxt?: boolean;
  maxUrls?: number;
  maxConcurrency?: number;
  domainDelayMs?: number;
  navigationTimeoutSecs?: number;
  maxViolationsPerUrl?: number;
  maxTotalChargeUsd?: number;
}

export interface NormalizedAuditInput {
  urls: string[];
  wcagLevel: 'AA' | 'A';
  wcagTags: string[];
  includeVisualEvidence: boolean;
  fullPageScreenshot: boolean;
  detectOverlays: boolean;
  checkAccessibilityStatement: boolean;
  respectRobotsTxt: boolean;
  maxUrls: number;
  maxConcurrency: number;
  domainDelayMs: number;
  navigationTimeoutMs: number;
  maxViolationsPerUrl: number;
  maxTotalChargeUsd?: number;
}

export interface OverlayVendorMatch {
  vendor: string;
  signals: string[];
}

export interface OverlayDetectionResult {
  overlayDetected: boolean;
  overlayVendors: string[];
  regulatoryWarning: string | null;
  matchedSignals: OverlayVendorMatch[];
}

export interface EaaStatementResult {
  accessibilityStatementFound: boolean;
  statementUrl: string | null;
  statementText: string | null;
  detectedLanguage: string | null;
  location: 'footer' | 'nav' | 'body' | null;
  missingStatementRisk: string;
}

export interface RawAxeNode {
  html: string;
  target: Array<string | string[]>;
  failureSummary?: string;
}

export interface RawAxeViolation {
  id: string;
  impact?: ViolationImpact | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: RawAxeNode[];
}

export interface RawAxeScanOutput {
  violations: RawAxeViolation[];
  passesCount: number;
  incompleteCount: number;
}

export interface ViolationRemediationItem {
  badgeNumber: number;
  ruleId: string;
  impact: ViolationImpact;
  wcagCriteria: string[];
  description: string;
  helpUrl: string;
  affectedNodesCount: number;
  targetSelectors: string[];
  beforeHtml: string;
  afterHtml: string;
  suggestedFixHtml: string;
  unifiedDiff: string;
}

export interface ViolationsSummary {
  totalViolations: number;
  totalAffectedNodes: number;
  criticalCount: number;
  seriousCount: number;
  moderateCount: number;
  minorCount: number;
  passedChecksCount: number;
  incompleteChecksCount: number;
}

export interface VisualEvidenceMeta {
  generated: boolean;
  key: string | null;
  url: string | null;
  highlightedCount: number;
  byteLength: number;
}

export interface AuditReportItem {
  url: string;
  finalUrl: string | null;
  domain: string;
  auditedAt: string;
  status: AuditStatus;
  httpStatus: number | null;
  pageTitle: string | null;
  loadTimeMs: number;
  errorMessage?: string;

  legalRiskScore: number;
  riskTier: RiskTier;
  summary: ViolationsSummary;

  overlayDetected: boolean;
  overlayVendors: string[];
  overlayDetection: OverlayDetectionResult;

  accessibilityStatementFound: boolean;
  accessibilityStatementUrl: string | null;
  eaaCompliance: EaaStatementResult;

  salesPitchHook: string;
  visualEvidenceKey: string | null;
  visualEvidenceUrl: string | null;
  visualEvidence: VisualEvidenceMeta;
  topViolations: ViolationRemediationItem[];

  disclaimer: string;
}

export interface DomAnchorCandidate {
  href: string;
  resolvedHref: string;
  text: string;
  ariaLabel: string;
  title: string;
  inFooter: boolean;
  inNav: boolean;
}

export interface DomPageSnapshot {
  scriptUrls: string[];
  inlineScriptSnippets: string[];
  stylesheetUrls: string[];
  domIdsAndClasses: string[];
  dataAttributes: string[];
  globalWindowKeys: string[];
  anchors: DomAnchorCandidate[];
  htmlLang: string;
}
