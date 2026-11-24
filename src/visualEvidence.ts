import type { ViolationRemediationItem } from './types.js';

export interface HighlightTargetSpec {
  badgeNumber: number;
  ruleId: string;
  impact: string;
  selectors: string[];
}

export function toHighlightSpecs(remediations: ViolationRemediationItem[]): HighlightTargetSpec[] {
  return remediations.map((item) => ({
    badgeNumber: item.badgeNumber,
    ruleId: item.ruleId,
    impact: item.impact,
    selectors: item.targetSelectors,
  }));
}

/**
 * Self-contained browser DOM script string that injects red bounding boxes + numbered badges
 * onto violating elements and returns the count of highlighted elements.
 */
export function buildInjectHighlightsExpression(
  specs: HighlightTargetSpec[],
  domainLabel: string,
  riskScore: number,
): string {
  const payloadJson = JSON.stringify({ specs, domainLabel, riskScore });
  return `(() => {
    const data = ${payloadJson};
    const existing = document.getElementById('__wcag_auditor_overlay_root__');
    if (existing) existing.remove();

    const root = document.createElement('div');
    root.id = '__wcag_auditor_overlay_root__';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'width:100%',
      'height:' + Math.max(document.documentElement.scrollHeight || 900, window.innerHeight || 900) + 'px',
      'pointer-events:none',
      'z-index:2147483647',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
    ].join(';');

    const banner = document.createElement('div');
    banner.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'background:rgba(15,23,42,0.94)',
      'color:#ffffff',
      'border:2px solid #ef4444',
      'border-radius:8px',
      'padding:8px 14px',
      'font-size:12px',
      'font-weight:700',
      'line-height:1.35',
      'box-shadow:0 8px 20px rgba(0,0,0,0.35)',
      'z-index:2147483647'
    ].join(';');
    banner.textContent = 'WCAG 2.2 / EAA Audit • ' + data.domainLabel + ' • Risk Score: ' + data.riskScore + '/100';
    root.appendChild(banner);

    let highlighted = 0;
    const docLevelBadges = [];

    for (const spec of data.specs) {
      let matchedForSpec = false;
      for (const sel of (spec.selectors || []).slice(0, 3)) {
        if (!sel || sel === 'html' || sel === 'head' || sel === 'title' || sel.startsWith('meta')) {
          continue;
        }
        let el = null;
        try {
          el = document.querySelector(sel);
        } catch (_e) {
          el = null;
        }
        if (!el || !(el instanceof Element)) continue;

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) continue;

        const top = Math.max(0, rect.top + window.scrollY);
        const left = Math.max(0, rect.left + window.scrollX);
        const width = Math.max(18, rect.width);
        const height = Math.max(18, rect.height);

        const box = document.createElement('div');
        const borderColor = spec.impact === 'critical' ? '#dc2626' : spec.impact === 'serious' ? '#ea580c' : '#d97706';
        box.style.cssText = [
          'position:absolute',
          'top:' + (top - 3) + 'px',
          'left:' + (left - 3) + 'px',
          'width:' + (width + 6) + 'px',
          'height:' + (height + 6) + 'px',
          'border:3px solid ' + borderColor,
          'background:rgba(220,38,38,0.10)',
          'border-radius:4px',
          'box-sizing:border-box',
          'box-shadow:0 0 0 2px rgba(255,255,255,0.9)'
        ].join(';');

        const badge = document.createElement('div');
        badge.style.cssText = [
          'position:absolute',
          'top:-13px',
          'left:-10px',
          'min-width:22px',
          'height:22px',
          'padding:0 6px',
          'border-radius:9999px',
          'background:' + borderColor,
          'color:#ffffff',
          'font-size:11px',
          'font-weight:800',
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'border:2px solid #ffffff',
          'box-shadow:0 2px 6px rgba(0,0,0,0.35)',
          'white-space:nowrap'
        ].join(';');
        badge.textContent = '#' + spec.badgeNumber + ' ' + spec.ruleId;
        box.appendChild(badge);
        root.appendChild(box);

        highlighted += 1;
        matchedForSpec = true;
      }

      if (!matchedForSpec) {
        docLevelBadges.push('#' + spec.badgeNumber + ' ' + spec.ruleId);
      }
    }

    if (docLevelBadges.length > 0) {
      const strip = document.createElement('div');
      strip.style.cssText = [
        'position:fixed',
        'top:52px',
        'right:12px',
        'background:rgba(127,29,29,0.94)',
        'color:#ffffff',
        'border:1px solid #fca5a5',
        'border-radius:6px',
        'padding:5px 10px',
        'font-size:11px',
        'font-weight:600',
        'z-index:2147483647'
      ].join(';');
      strip.textContent = 'Document-level issues: ' + docLevelBadges.slice(0, 4).join(', ');
      root.appendChild(strip);
      highlighted += docLevelBadges.length;
    }

    document.body.appendChild(root);
    return highlighted;
  })()`;
}

export const REMOVE_HIGHLIGHTS_EXPRESSION = `(() => {
  const el = document.getElementById('__wcag_auditor_overlay_root__');
  if (el) el.remove();
  return true;
})()`;
