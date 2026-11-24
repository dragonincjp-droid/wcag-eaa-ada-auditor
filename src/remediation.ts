import type {
  EaaStatementResult,
  OverlayDetectionResult,
  RawAxeViolation,
  RiskTier,
  ViolationImpact,
  ViolationRemediationItem,
  ViolationsSummary,
} from './types.js';

const IMPACT_ORDER: Record<ViolationImpact, number> = {
  critical: 4,
  serious: 3,
  moderate: 2,
  minor: 1,
};

export function normalizeImpact(raw?: string | null): ViolationImpact {
  if (raw === 'critical' || raw === 'serious' || raw === 'moderate' || raw === 'minor') {
    return raw;
  }
  return 'moderate';
}

export function buildViolationsSummary(
  violations: RawAxeViolation[],
  passesCount: number,
  incompleteCount: number,
): ViolationsSummary {
  let totalAffectedNodes = 0;
  let criticalCount = 0;
  let seriousCount = 0;
  let moderateCount = 0;
  let minorCount = 0;

  for (const v of violations) {
    const impact = normalizeImpact(v.impact);
    const nodeCount = Math.max(1, v.nodes?.length ?? 1);
    totalAffectedNodes += nodeCount;

    if (impact === 'critical') criticalCount += 1;
    else if (impact === 'serious') seriousCount += 1;
    else if (impact === 'moderate') moderateCount += 1;
    else minorCount += 1;
  }

  return {
    totalViolations: violations.length,
    totalAffectedNodes,
    criticalCount,
    seriousCount,
    moderateCount,
    minorCount,
    passedChecksCount: passesCount,
    incompleteChecksCount: incompleteCount,
  };
}

export function calculateLegalRiskScore(params: {
  summary: ViolationsSummary;
  overlay: OverlayDetectionResult;
  eaa: EaaStatementResult;
  checkAccessibilityStatement: boolean;
}): { legalRiskScore: number; riskTier: RiskTier } {
  const { summary, overlay, eaa, checkAccessibilityStatement } = params;

  let score = 0;
  score += summary.criticalCount * 22;
  score += summary.seriousCount * 12;
  score += summary.moderateCount * 5;
  score += summary.minorCount * 2;

  // Scale slightly with widespread affected DOM nodes (capped at +15)
  const extraNodePenalty = Math.min(15, Math.floor(summary.totalAffectedNodes * 1.2));
  score += extraNodePenalty;

  // Missing EAA statement adds statutory transparency risk
  if (checkAccessibilityStatement && !eaa.accessibilityStatementFound) {
    score += 14;
  }

  // Overlay widget presence with unresolved DOM issues compounds litigation/FTC risk
  if (overlay.overlayDetected) {
    score += summary.criticalCount + summary.seriousCount > 0 ? 18 : 10;
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  let riskTier: RiskTier = 'LOW';
  if (clamped >= 75 || (summary.criticalCount >= 2 && overlay.overlayDetected)) {
    riskTier = 'CRITICAL';
  } else if (clamped >= 50 || summary.criticalCount >= 1) {
    riskTier = 'HIGH';
  } else if (clamped >= 25) {
    riskTier = 'MEDIUM';
  }

  return { legalRiskScore: clamped, riskTier };
}

function extractAttr(html: string, attrName: string): string | null {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(html);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

function injectAttributeOnOpeningTag(html: string, attrSnippet: string): string {
  const closeIdx = html.indexOf('>');
  if (closeIdx < 0) return `${html} ${attrSnippet}`;
  const isSelfClosing = html.slice(0, closeIdx).endsWith('/');
  if (isSelfClosing) {
    return `${html.slice(0, closeIdx - 1).trimEnd()} ${attrSnippet} />${html.slice(closeIdx + 1)}`;
  }
  return `${html.slice(0, closeIdx)} ${attrSnippet}${html.slice(closeIdx)}`;
}

export function generateDeterministicFixHtml(ruleId: string, rawBeforeHtml: string): string {
  const before = (rawBeforeHtml || '').trim() || '<div>Element</div>';

  switch (ruleId) {
    case 'image-alt': {
      const src = extractAttr(before, 'src') || 'image';
      const fileSlug = src
        .split('?')[0]
        .split('/')
        .pop()
        ?.replace(/\.[a-z0-9]+$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();
      const suggestedAlt = fileSlug ? `Descriptive text for ${fileSlug}` : 'Descriptive alternative text';
      if (/\balt\s*=/i.test(before)) {
        return before.replace(/\balt\s*=\s*(?:"[^"]*"|'[^']*')/i, `alt="${suggestedAlt}"`);
      }
      return injectAttributeOnOpeningTag(before, `alt="${suggestedAlt}"`);
    }

    case 'input-image-alt': {
      return injectAttributeOnOpeningTag(before, 'alt="Submit form"');
    }

    case 'label':
    case 'select-name': {
      const existingId = extractAttr(before, 'id') || 'field-input';
      const typeAttr = (extractAttr(before, 'type') || 'text').toLowerCase();
      const placeholder = extractAttr(before, 'placeholder');
      const inferredLabel =
        placeholder ||
        (typeAttr === 'email'
          ? 'Email address'
          : typeAttr === 'search'
            ? 'Search site'
            : typeAttr === 'tel'
              ? 'Phone number'
              : 'Form field label');
      let updatedControl = before;
      if (!extractAttr(before, 'id')) {
        updatedControl = injectAttributeOnOpeningTag(updatedControl, `id="${existingId}"`);
      }
      if (typeAttr === 'email' && !/\bautocomplete\s*=/i.test(updatedControl)) {
        updatedControl = injectAttributeOnOpeningTag(updatedControl, 'autocomplete="email"');
      }
      return `<label for="${existingId}">${inferredLabel}</label>\n${updatedControl}`;
    }

    case 'button-name': {
      const classHint = extractAttr(before, 'class') || '';
      const inferredAction = /cart|bag/i.test(classHint)
        ? 'Open shopping cart'
        : /search/i.test(classHint)
          ? 'Submit search'
          : /menu|nav|burger/i.test(classHint)
            ? 'Toggle navigation menu'
            : /close|dismiss/i.test(classHint)
              ? 'Close dialog'
              : 'Perform button action';
      let fixed = injectAttributeOnOpeningTag(before, `aria-label="${inferredAction}"`);
      fixed = fixed.replace(/<svg\b(?![^>]*\baria-hidden=)/gi, '<svg aria-hidden="true" focusable="false"');
      return fixed;
    }

    case 'input-button-name': {
      return injectAttributeOnOpeningTag(before, 'value="Submit"');
    }

    case 'link-name': {
      const href = extractAttr(before, 'href') || 'destination';
      const slug = href.replace(/^https?:\/\/[^/]+/i, '').replace(/[/#?_-]+/g, ' ').trim() || 'destination page';
      let fixed = injectAttributeOnOpeningTag(before, `aria-label="Navigate to ${slug}"`);
      fixed = fixed.replace(/<svg\b(?![^>]*\baria-hidden=)/gi, '<svg aria-hidden="true" focusable="false"');
      return fixed;
    }

    case 'color-contrast': {
      if (/\bstyle\s*=\s*"([^"]*)"/i.test(before)) {
        const replaced = before.replace(/\bcolor\s*:\s*#[0-9a-f]{3,6}/i, 'color: #1f2937');
        if (replaced !== before) {
          return `${replaced} <!-- Updated foreground to >= 7.0:1 WCAG 2.2 AA contrast -->`;
        }
      }
      return `${injectAttributeOnOpeningTag(before, 'style="color: #1f2937; background-color: #ffffff;"')} <!-- Ensure >= 4.5:1 contrast ratio -->`;
    }

    case 'html-has-lang':
    case 'html-lang-valid': {
      if (/\blang\s*=/i.test(before)) {
        return before.replace(/\blang\s*=\s*(?:"[^"]*"|'[^']*')/i, 'lang="en"');
      }
      return injectAttributeOnOpeningTag(before, 'lang="en"');
    }

    case 'document-title': {
      return '<head>\n  <title>Descriptive Page Title — Brand Name</title>\n</head>';
    }

    case 'meta-viewport': {
      return '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    }

    case 'target-size': {
      if (/\bstyle\s*=\s*"([^"]*)"/i.test(before)) {
        return before.replace(
          /\bstyle\s*=\s*"([^"]*)"/i,
          (_, s: string) => `style="${s.replace(/;?\s*$/, ';')} min-width: 24px; min-height: 24px; padding: 6px;"`,
        );
      }
      return injectAttributeOnOpeningTag(before, 'style="min-width: 24px; min-height: 24px; padding: 6px;"');
    }

    case 'frame-title': {
      return injectAttributeOnOpeningTag(before, 'title="Embedded content frame"');
    }

    case 'empty-heading': {
      return before.replace(/>(\s*)<\/(h[1-6])>/i, '>Section Heading</$2>');
    }

    case 'heading-order': {
      return before
        .replace(/^<h[3-6]\b/i, '<h2')
        .replace(/<\/h[3-6]>$/i, '</h2>');
    }

    case 'tabindex': {
      return before.replace(/\btabindex\s*=\s*(?:"[1-9]\d*"|'[1-9]\d*'|[1-9]\d*)/i, 'tabindex="0"');
    }

    case 'aria-hidden-focus': {
      return injectAttributeOnOpeningTag(before, 'tabindex="-1"');
    }

    case 'landmark-one-main':
    case 'region': {
      return `<main id="main-content">\n  ${before}\n</main>`;
    }

    case 'bypass': {
      return `<a href="#main-content" class="skip-link">Skip to main content</a>\n${before}`;
    }

    default: {
      return `${before}\n<!-- Remediate WCAG rule "${ruleId}": provide programmatic ARIA semantics / keyboard support -->`;
    }
  }
}

export function createUnifiedHtmlDiff(beforeHtml: string, afterHtml: string): string {
  const beforeLines = beforeHtml.split('\n').map((l) => `- ${l}`);
  const afterLines = afterHtml.split('\n').map((l) => `+ ${l}`);
  return ['@@ -1 +1 @@', ...beforeLines, ...afterLines].join('\n');
}

function formatSelectorTarget(target: Array<string | string[]>): string {
  const first = target[0];
  if (typeof first === 'string') return first;
  if (Array.isArray(first)) return first.join(' >>> ');
  return 'body';
}

export function buildPrioritizedRemediations(
  violations: RawAxeViolation[],
  maxItems: number,
): ViolationRemediationItem[] {
  const sorted = [...violations].sort((a, b) => {
    const diff = IMPACT_ORDER[normalizeImpact(b.impact)] - IMPACT_ORDER[normalizeImpact(a.impact)];
    if (diff !== 0) return diff;
    return (b.nodes?.length ?? 0) - (a.nodes?.length ?? 0);
  });

  return sorted.slice(0, maxItems).map((v, index) => {
    const impact = normalizeImpact(v.impact);
    const firstNode = v.nodes?.[0];
    const beforeHtml = (firstNode?.html || `<div data-rule="${v.id}"></div>`).trim();
    const afterHtml = generateDeterministicFixHtml(v.id, beforeHtml);
    const selectors = (v.nodes || [])
      .map((n) => formatSelectorTarget(n.target))
      .filter(Boolean)
      .slice(0, 5);

    const wcagCriteria = (v.tags || []).filter((t) => /^wcag|^best-practice/i.test(t));

    return {
      badgeNumber: index + 1,
      ruleId: v.id,
      impact,
      wcagCriteria: wcagCriteria.length > 0 ? wcagCriteria : v.tags || [],
      description: v.help || v.description,
      helpUrl: v.helpUrl,
      affectedNodesCount: Math.max(1, v.nodes?.length ?? 1),
      targetSelectors: selectors.length > 0 ? selectors : ['body'],
      beforeHtml,
      afterHtml,
      suggestedFixHtml: afterHtml,
      unifiedDiff: createUnifiedHtmlDiff(beforeHtml, afterHtml),
    };
  });
}

function humanizeRuleList(remediations: ViolationRemediationItem[]): string {
  const labels = remediations.slice(0, 2).map((r) => {
    switch (r.ruleId) {
      case 'image-alt':
        return 'missing image alt attributes';
      case 'label':
      case 'select-name':
        return 'unlabeled form inputs';
      case 'button-name':
      case 'input-button-name':
        return 'unlabeled interactive buttons';
      case 'link-name':
        return 'empty links without discernible text';
      case 'color-contrast':
        return 'low-contrast text below 4.5:1';
      case 'target-size':
        return 'undersized WCAG 2.2 touch targets (<24px)';
      case 'html-has-lang':
        return 'missing HTML document language declaration';
      default:
        return r.ruleId.replace(/-/g, ' ');
    }
  });
  return Array.from(new Set(labels)).join(' and ');
}

export function generateSalesPitchHook(params: {
  domain: string;
  summary: ViolationsSummary;
  overlay: OverlayDetectionResult;
  eaa: EaaStatementResult;
  topViolations: ViolationRemediationItem[];
  checkAccessibilityStatement: boolean;
}): string {
  const { domain, summary, overlay, eaa, topViolations, checkAccessibilityStatement } = params;
  const highImpactCount = summary.criticalCount + summary.seriousCount;
  const issueExamples = humanizeRuleList(topViolations);
  const missingStatement = checkAccessibilityStatement && !eaa.accessibilityStatementFound;

  if (overlay.overlayDetected && summary.totalViolations > 0) {
    const vendor = overlay.overlayVendors[0];
    const statementTail = missingStatement
      ? ' and no mandatory EAA Accessibility Statement link was found in your footer.'
      : ' that JavaScript overlays leave exposed to screen readers and ADA/EAA audits.';
    return `Noticed ${domain} runs the ${vendor} overlay widget, yet an automated WCAG 2.2 AA DOM scan still flagged ${summary.totalViolations} live accessibility barriers (${summary.criticalCount} critical${issueExamples ? `, including ${issueExamples}` : ''})${statementTail}`;
  }

  if (overlay.overlayDetected && summary.totalViolations === 0) {
    const vendor = overlay.overlayVendors[0];
    return `Noticed ${domain} relies on the ${vendor} overlay widget${missingStatement ? ' while lacking a statutory EAA Accessibility Statement page' : ''}; happy to share how teams transition from FTC-scrutinized overlays to native WCAG 2.2 AA code.`;
  }

  if (highImpactCount > 0 && missingStatement) {
    return `A quick WCAG 2.2 Level AA check on ${domain} surfaced ${summary.totalViolations} technical accessibility issues (${summary.criticalCount} critical, ${summary.seriousCount} serious${issueExamples ? ` — such as ${issueExamples}` : ''}) alongside a missing European Accessibility Act (EAA) statement link.`;
  }

  if (summary.totalViolations > 0) {
    return `Ran an automated WCAG 2.2 Level AA check on ${domain} and spotted ${summary.totalViolations} code-level accessibility issues (${highImpactCount} critical/serious${issueExamples ? `, including ${issueExamples}` : ''}) that can be patched quickly in HTML/ARIA.`;
  }

  if (missingStatement) {
    return `${domain} passed automated WCAG 2.2 DOM checks cleanly, though we noticed no multilingual Accessibility Statement link in your navigation or footer as required for covered EU services under the EAA.`;
  }

  return `${domain} achieved a clean automated WCAG 2.2 Level AA technical scan with an Accessibility Statement link present — manual assistive-technology verification is the only remaining step for full EAA/ADA readiness.`;
}
