import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyIpAddress,
  isAllowLocalhostEnabled,
  validateUrlAgainstSsrf,
  type DnsLookupFn,
} from './ssrf.js';
import type { DomPageSnapshot, RawAxeScanOutput, ViolationRemediationItem } from './types.js';
import {
  REMOVE_HIGHLIGHTS_EXPRESSION,
  buildInjectHighlightsExpression,
  toHighlightSpecs,
} from './visualEvidence.js';

export const CHROME_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-sync',
  '--mute-audio',
];

export function resolveChromiumExecutablePath(): string | undefined {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (envPath) {
    return envPath;
  }

  const apifyPath = process.env.APIFY_DEFAULT_BROWSER_PATH?.trim();
  if (apifyPath && fs.existsSync(apifyPath)) {
    return apifyPath;
  }

  const localCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export interface BrowserPageScanOptions {
  url: string;
  wcagTags: string[];
  navigationTimeoutMs: number;
  includeVisualEvidence: boolean;
  fullPageScreenshot: boolean;
  allowLocalhost?: boolean;
  dnsLookup?: DnsLookupFn;
  prepareVisualRemediation: (
    axeOutput: RawAxeScanOutput,
    snapshot: DomPageSnapshot,
    finalUrl: string,
  ) => {
    remediations: ViolationRemediationItem[];
    domain: string;
    legalRiskScore: number;
  };
}

export interface BrowserPageScanResult {
  finalUrl: string;
  httpStatus: number | null;
  pageTitle: string | null;
  axeOutput: RawAxeScanOutput;
  domSnapshot: DomPageSnapshot;
  screenshotPng: Buffer | null;
  highlightedCount: number;
}

export interface BrowserAuditEngine {
  readonly engineName: 'playwright-axe' | 'cdp-chrome';
  isHealthy(): boolean;
  scanPage(options: BrowserPageScanOptions): Promise<BrowserPageScanResult>;
  close(): Promise<void>;
}

/**
 * Browser-evaluated expression collecting overlay script/DOM/window signatures
 * and multilingual EAA Accessibility Statement anchor candidates.
 */
const COLLECT_DOM_SNAPSHOT_EXPR = `(() => {
  const scriptUrls = Array.from(document.querySelectorAll('script[src]'))
    .map((s) => s.getAttribute('src') || s.src || '')
    .filter(Boolean);

  const inlineScriptSnippets = Array.from(document.querySelectorAll('script:not([src])'))
    .map((s) => (s.textContent || '').slice(0, 600))
    .filter(Boolean)
    .slice(0, 40);

  const stylesheetUrls = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))
    .map((l) => l.getAttribute('href') || l.href || '')
    .filter(Boolean);

  const domIdsAndClasses = [];
  const dataAttributes = [];
  const elements = Array.from(document.querySelectorAll('*')).slice(0, 1500);
  for (const el of elements) {
    if (el.id) domIdsAndClasses.push('#' + el.id);
    if (typeof el.className === 'string' && el.className.trim()) {
      for (const cls of el.className.trim().split(/\\s+/).slice(0, 6)) {
        domIdsAndClasses.push(cls);
      }
    }
    for (const attr of Array.from(el.attributes || [])) {
      if (attr.name.startsWith('data-')) {
        dataAttributes.push(attr.name);
      }
    }
  }

  const candidateGlobals = [
    'acsbJS', 'acsb', 'acsbState',
    'UserWay', '_userway_config', 'userway',
    '__AudioEye', 'AudioEye',
    'interdeal', 'EqualWeb',
    'Recite', 'reciteMe',
    '_monsido', 'monsido',
    'MaxAccess', 'maxAccess',
    '_u1st', 'User1st', 'u1st',
    'FACIL_ITI', 'faciliti',
    'AccessiWay'
  ];
  const globalWindowKeys = candidateGlobals.filter((k) => {
    try {
      return typeof window[k] !== 'undefined' && window[k] !== null;
    } catch (_e) {
      return false;
    }
  });

  const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 500).map((a) => {
    const inFooter = Boolean(a.closest('footer, [role="contentinfo"], .footer, #footer'));
    const inNav = Boolean(a.closest('nav, header, [role="navigation"]'));
    return {
      href: a.getAttribute('href') || '',
      resolvedHref: a.href || '',
      text: (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      ariaLabel: (a.getAttribute('aria-label') || '').trim(),
      title: (a.getAttribute('title') || '').trim(),
      inFooter,
      inNav
    };
  });

  const htmlLang = (document.documentElement.getAttribute('lang') || '').trim();

  return {
    scriptUrls,
    inlineScriptSnippets,
    stylesheetUrls,
    domIdsAndClasses: Array.from(new Set(domIdsAndClasses)).slice(0, 600),
    dataAttributes: Array.from(new Set(dataAttributes)).slice(0, 300),
    globalWindowKeys,
    anchors,
    htmlLang
  };
})()`;

/**
 * Deterministic in-browser WCAG 2.2 Level A/AA DOM inspection expression used ONLY when
 * `@axe-core/playwright` is unavailable in an offline environment. Evaluates real computed styles,
 * WCAG relative luminance contrast ratios, accessible names, labels, target sizes (24x24px), etc.
 */
function buildFallbackDomWcagAuditExpression(wcagTags: string[]): string {
  const tagsJson = JSON.stringify(wcagTags);
  return `(() => {
    const activeTags = new Set(${tagsJson});
    const checkAA = activeTags.has('wcag2aa') || activeTags.has('wcag21aa') || activeTags.has('wcag22aa');
    const check22AA = activeTags.has('wcag22aa');
    const checkBestPractice = activeTags.has('best-practice');

    const violations = [];
    let passesCount = 0;

    function cssSelectorFor(el) {
      if (!el || !(el instanceof Element)) return 'html';
      if (el.id && /^[a-zA-Z][\\w-]*$/.test(el.id)) return '#' + el.id;
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && parts.length < 4) {
        let seg = cur.tagName.toLowerCase();
        if (cur.id && /^[a-zA-Z][\\w-]*$/.test(cur.id)) {
          parts.unshift('#' + cur.id);
          break;
        }
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
          if (siblings.length > 1) {
            seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
          }
        }
        parts.unshift(seg);
        cur = parent;
      }
      return parts.join(' > ') || el.tagName.toLowerCase();
    }

    function outerSnippet(el) {
      const raw = (el.outerHTML || '').trim();
      return raw.length > 260 ? raw.slice(0, 257) + '...' : raw;
    }

    function isVisible(el) {
      if (!(el instanceof Element)) return false;
      if (el.closest('[hidden], [aria-hidden="true"]')) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function accessibleText(el) {
      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      if (ariaLabel) return ariaLabel;
      const labelledBy = (el.getAttribute('aria-labelledby') || '').trim();
      if (labelledBy) {
        const joined = labelledBy
          .split(/\\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() || '')
          .join(' ')
          .trim();
        if (joined) return joined;
      }
      const imgAlt = Array.from(el.querySelectorAll('img[alt]'))
        .map((img) => (img.getAttribute('alt') || '').trim())
        .join(' ')
        .trim();
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      const title = (el.getAttribute('title') || '').trim();
      return text || imgAlt || title;
    }

    // 1. html-has-lang (WCAG 3.1.1 Level A)
    const htmlLang = (document.documentElement.getAttribute('lang') || '').trim();
    if (!htmlLang) {
      violations.push({
        id: 'html-has-lang',
        impact: 'serious',
        tags: ['wcag2a', 'wcag311'],
        description: 'Ensures every HTML document has a lang attribute',
        help: '<html> element must have a lang attribute',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/html-has-lang',
        nodes: [{ html: '<html>', target: ['html'] }]
      });
    } else {
      passesCount += 1;
    }

    // 2. document-title (WCAG 2.4.2 Level A)
    if (!(document.title || '').trim()) {
      violations.push({
        id: 'document-title',
        impact: 'serious',
        tags: ['wcag2a', 'wcag242'],
        description: 'Ensures each HTML document contains a non-empty <title> element',
        help: 'Documents must have <title> element to aid in navigation',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/document-title',
        nodes: [{ html: '<head></head>', target: ['head'] }]
      });
    } else {
      passesCount += 1;
    }

    // 3. image-alt (WCAG 1.1.1 Level A)
    const missingAltNodes = [];
    for (const img of Array.from(document.querySelectorAll('img'))) {
      if (img.id === '__wcag_auditor_overlay_root__' || img.closest('#__wcag_auditor_overlay_root__')) continue;
      const role = (img.getAttribute('role') || '').toLowerCase();
      if (role === 'presentation' || role === 'none' || img.getAttribute('aria-hidden') === 'true') continue;
      if (!img.hasAttribute('alt') && !(img.getAttribute('aria-label') || '').trim()) {
        missingAltNodes.push({ html: outerSnippet(img), target: [cssSelectorFor(img)] });
      }
    }
    if (missingAltNodes.length > 0) {
      violations.push({
        id: 'image-alt',
        impact: 'critical',
        tags: ['wcag2a', 'wcag111'],
        description: 'Ensures <img> elements have alternate text or a role of none or presentation',
        help: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        nodes: missingAltNodes
      });
    } else {
      passesCount += 1;
    }

    // 4. label (WCAG 1.3.1 / 4.1.2 Level A)
    const unlabeledInputs = [];
    for (const ctrl of Array.from(document.querySelectorAll('input, select, textarea'))) {
      const tag = ctrl.tagName.toLowerCase();
      const type = (ctrl.getAttribute('type') || 'text').toLowerCase();
      if (tag === 'input' && ['hidden', 'submit', 'reset', 'button', 'image'].includes(type)) continue;
      if (!isVisible(ctrl)) continue;

      const hasAria = Boolean((ctrl.getAttribute('aria-label') || '').trim() || (ctrl.getAttribute('aria-labelledby') || '').trim());
      const wrappedInLabel = Boolean(ctrl.closest('label')?.textContent?.trim());
      const id = ctrl.getAttribute('id');
      let hasForLabel = false;
      if (id) {
        for (const lbl of Array.from(document.querySelectorAll('label[for]'))) {
          if (lbl.getAttribute('for') === id && (lbl.textContent || '').trim()) {
            hasForLabel = true;
            break;
          }
        }
      }
      const hasTitle = Boolean((ctrl.getAttribute('title') || '').trim());
      if (!hasAria && !wrappedInLabel && !hasForLabel && !hasTitle) {
        unlabeledInputs.push({ html: outerSnippet(ctrl), target: [cssSelectorFor(ctrl)] });
      }
    }
    if (unlabeledInputs.length > 0) {
      violations.push({
        id: 'label',
        impact: 'critical',
        tags: ['wcag2a', 'wcag412', 'wcag131'],
        description: 'Ensures every form element has a label',
        help: 'Form elements must have labels',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/label',
        nodes: unlabeledInputs
      });
    } else {
      passesCount += 1;
    }

    // 5. button-name (WCAG 4.1.2 Level A)
    const emptyButtons = [];
    for (const btn of Array.from(document.querySelectorAll('button, [role="button"]'))) {
      if (!isVisible(btn)) continue;
      if (!accessibleText(btn)) {
        emptyButtons.push({ html: outerSnippet(btn), target: [cssSelectorFor(btn)] });
      }
    }
    if (emptyButtons.length > 0) {
      violations.push({
        id: 'button-name',
        impact: 'critical',
        tags: ['wcag2a', 'wcag412'],
        description: 'Ensures buttons have discernible text',
        help: 'Buttons must have discernible text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name',
        nodes: emptyButtons
      });
    } else {
      passesCount += 1;
    }

    // 6. link-name (WCAG 2.4.4 / 4.1.2 Level A)
    const emptyLinks = [];
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      if (!isVisible(a)) continue;
      if (!accessibleText(a)) {
        emptyLinks.push({ html: outerSnippet(a), target: [cssSelectorFor(a)] });
      }
    }
    if (emptyLinks.length > 0) {
      violations.push({
        id: 'link-name',
        impact: 'serious',
        tags: ['wcag2a', 'wcag244', 'wcag412'],
        description: 'Ensures links have discernible text',
        help: 'Links must have discernible text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name',
        nodes: emptyLinks
      });
    } else {
      passesCount += 1;
    }

    // 7. color-contrast (WCAG 1.4.3 Level AA)
    function parseRgba(str) {
      const m = /rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)/i.exec(str || '');
      if (!m) return null;
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) : 1 };
    }
    function srgbToLinear(c) {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    function luminance(rgb) {
      return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
    }
    function effectiveBg(el) {
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const bg = parseRgba(window.getComputedStyle(cur).backgroundColor);
        if (bg && bg.a >= 0.95) return bg;
        cur = cur.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    if (checkAA) {
      const lowContrastNodes = [];
      const textEls = Array.from(document.querySelectorAll('p, span, a, button, label, li, h1, h2, h3, h4, h5, h6, td, th')).slice(0, 400);
      for (const el of textEls) {
        if (!isVisible(el)) continue;
        const directText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent || '')
          .join('')
          .trim();
        if (!directText) continue;

        const st = window.getComputedStyle(el);
        const fg = parseRgba(st.color);
        if (!fg || fg.a < 0.8) continue;
        const bg = effectiveBg(el);
        const l1 = Math.max(luminance(fg), luminance(bg));
        const l2 = Math.min(luminance(fg), luminance(bg));
        const ratio = (l1 + 0.05) / (l2 + 0.05);

        const fontSize = parseFloat(st.fontSize) || 16;
        const weight = parseInt(st.fontWeight, 10) || (st.fontWeight === 'bold' ? 700 : 400);
        const isLarge = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
        const threshold = isLarge ? 3.0 : 4.5;

        if (ratio < threshold - 0.05) {
          lowContrastNodes.push({ html: outerSnippet(el), target: [cssSelectorFor(el)] });
        }
      }
      if (lowContrastNodes.length > 0) {
        violations.push({
          id: 'color-contrast',
          impact: 'serious',
          tags: ['wcag2aa', 'wcag143'],
          description: 'Ensures the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds',
          help: 'Elements must meet minimum color contrast ratio thresholds',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
          nodes: lowContrastNodes.slice(0, 20)
        });
      } else {
        passesCount += 1;
      }

      // 8. meta-viewport (WCAG 1.4.4 Level AA)
      const viewportMeta = document.querySelector('meta[name="viewport"]');
      if (viewportMeta) {
        const content = (viewportMeta.getAttribute('content') || '').toLowerCase();
        const maxScaleMatch = /maximum-scale\\s*=\\s*([\\d.]+)/.exec(content);
        if (/user-scalable\\s*=\\s*(no|0)/.test(content) || (maxScaleMatch && parseFloat(maxScaleMatch[1]) < 2)) {
          violations.push({
            id: 'meta-viewport',
            impact: 'critical',
            tags: ['wcag2aa', 'wcag144'],
            description: 'Ensures <meta name="viewport"> does not disable text scaling and zooming',
            help: 'Zooming and scaling must not be disabled',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/meta-viewport',
            nodes: [{ html: outerSnippet(viewportMeta), target: ['meta[name="viewport"]'] }]
          });
        } else {
          passesCount += 1;
        }
      }
    }

    // 9. WCAG 2.2 AA SC 2.5.8 target-size (24x24 CSS px minimum)
    if (check22AA) {
      const smallTargets = [];
      for (const el of Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'))) {
        if (!isVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24)) {
          smallTargets.push({ html: outerSnippet(el), target: [cssSelectorFor(el)] });
        }
      }
      if (smallTargets.length > 0) {
        violations.push({
          id: 'target-size',
          impact: 'serious',
          tags: ['wcag22aa', 'wcag258'],
          description: 'Ensures touch targets have sufficient size (24x24 CSS pixels minimum under WCAG 2.2 AA)',
          help: 'Touch targets must have sufficient size and space',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/target-size',
          nodes: smallTargets
        });
      } else {
        passesCount += 1;
      }
    }

    // 10. Best-practice landmark & heading checks
    if (checkBestPractice) {
      if (!document.querySelector('main, [role="main"]')) {
        violations.push({
          id: 'landmark-one-main',
          impact: 'moderate',
          tags: ['best-practice'],
          description: 'Ensures the document has a main landmark',
          help: 'Document should have one main landmark',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/landmark-one-main',
          nodes: [{ html: '<body>', target: ['body'] }]
        });
      } else {
        passesCount += 1;
      }
    }

    return {
      violations,
      passesCount,
      incompleteCount: 0
    };
  })()`;
}

// ============================================================================
// Engine 1: Official Playwright + @axe-core/playwright (Primary Production)
// ============================================================================

interface PlaywrightRouteLike {
  request: () => { url: () => string };
  continue: () => Promise<void>;
  abort: (errorCode?: string) => Promise<void>;
}

interface PlaywrightResponseLike {
  status: () => number;
  url?: () => string;
  serverAddr?: () => Promise<{ ipAddress?: string; port?: number } | null>;
}

interface PlaywrightScreenshotOptions {
  type?: 'png';
  fullPage?: boolean;
  timeout?: number;
  clip?: { x: number; y: number; width: number; height: number };
}

interface PlaywrightPageLike {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<PlaywrightResponseLike | null>;
  on?: (event: 'response', listener: (response: PlaywrightResponseLike) => void) => void;
  close?: () => Promise<void>;
  waitForLoadState: (state?: string, options?: { timeout?: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  url: () => string;
  title: () => Promise<string>;
  evaluate: <T = unknown>(expression: string) => Promise<T>;
  screenshot: (options?: PlaywrightScreenshotOptions) => Promise<Buffer>;
}

interface PlaywrightContextLike {
  route: (url: string, handler: (route: PlaywrightRouteLike) => Promise<void>) => Promise<void>;
  newPage: () => Promise<PlaywrightPageLike>;
  close: () => Promise<void>;
}

interface PlaywrightBrowserLike {
  isConnected?: () => boolean;
  newContext: (options?: Record<string, unknown>) => Promise<PlaywrightContextLike>;
  close: () => Promise<void>;
}

type AxeBuilderConstructorLike = new (opts: { page: unknown }) => {
  withTags: (tags: string[]) => {
    analyze: () => Promise<{
      violations: RawAxeScanOutput['violations'];
      passes?: unknown[];
      incomplete?: unknown[];
    }>;
  };
};

const MAX_SCREENSHOT_HEIGHT_PX = 8_000;
const SCREENSHOT_TIMEOUT_MS = 15_000;

class PlaywrightAxeEngine implements BrowserAuditEngine {
  public readonly engineName = 'playwright-axe' as const;
  private readonly browser: PlaywrightBrowserLike;
  private readonly AxeBuilderCtor: AxeBuilderConstructorLike;

  public constructor(browser: PlaywrightBrowserLike, axeBuilderCtor: AxeBuilderConstructorLike) {
    this.browser = browser;
    this.AxeBuilderCtor = axeBuilderCtor;
  }

  public isHealthy(): boolean {
    return typeof this.browser.isConnected === 'function' ? this.browser.isConnected() : true;
  }

  public async scanPage(options: BrowserPageScanOptions): Promise<BrowserPageScanResult> {
    const allowLocalhost = isAllowLocalhostEnabled(options.allowLocalhost);
    const context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 WCAG-EAA-ADA-Auditor/1.0',
      ignoreHTTPSErrors: false,
    });

    try {
      await context.route('**/*', async (route: PlaywrightRouteLike) => {
        const reqUrl = route.request().url();
        if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:') || reqUrl === 'about:blank') {
          await route.continue();
          return;
        }
        const check = await validateUrlAgainstSsrf(reqUrl, {
          allowLocalhost,
          dnsLookup: options.dnsLookup,
        });
        if (!check.allowed) {
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });

      const page = await context.newPage();
      let socketSsrfError: string | null = null;
      const pendingSocketChecks: Array<Promise<void>> = [];

      const verifySocketAddress = async (resp: PlaywrightResponseLike | null | undefined): Promise<void> => {
        if (!resp || typeof resp.serverAddr !== 'function') return;
        const respUrl = typeof resp.url === 'function' ? resp.url() : '';
        if (respUrl.startsWith('data:') || respUrl.startsWith('blob:') || respUrl === 'about:blank') {
          return;
        }
        try {
          const addr = await resp.serverAddr();
          const rawIp = addr?.ipAddress?.trim();
          if (!rawIp) return;
          const cleanIp = rawIp.replace(/^\[|\]$/g, '');
          const ipCheck = classifyIpAddress(cleanIp, allowLocalhost);
          if (!ipCheck.allowed) {
            socketSsrfError = `SSRF guard blocked remote socket IP ${cleanIp}: ${ipCheck.reason}`;
            await page.close?.().catch(() => {});
          }
        } catch {
          // Ignore transient closed-target errors during abort
        }
      };

      page.on?.('response', (resp: PlaywrightResponseLike) => {
        pendingSocketChecks.push(verifySocketAddress(resp));
      });

      const response = await page.goto(options.url, {
        waitUntil: 'domcontentloaded',
        timeout: options.navigationTimeoutMs,
      });

      await verifySocketAddress(response);
      await Promise.all(pendingSocketChecks);
      if (socketSsrfError) {
        throw new Error(socketSsrfError);
      }

      await page
        .waitForLoadState('load', { timeout: Math.min(5_000, options.navigationTimeoutMs) })
        .catch(() => {});
      await page.waitForTimeout(250);

      await Promise.all(pendingSocketChecks);
      if (socketSsrfError) {
        throw new Error(socketSsrfError);
      }

      const finalUrl = page.url();
      const postNavCheck = await validateUrlAgainstSsrf(finalUrl, {
        allowLocalhost,
        dnsLookup: options.dnsLookup,
      });
      if (!postNavCheck.allowed) {
        throw new Error(`Post-redirect SSRF guard blocked destination: ${postNavCheck.reason}`);
      }

      const httpStatus = response ? response.status() : null;
      const pageTitle = (await page.title().catch(() => '')) || null;

      const axeRaw = await new this.AxeBuilderCtor({ page }).withTags(options.wcagTags).analyze();
      const axeOutput: RawAxeScanOutput = {
        violations: axeRaw.violations || [],
        passesCount: Array.isArray(axeRaw.passes) ? axeRaw.passes.length : 0,
        incompleteCount: Array.isArray(axeRaw.incomplete) ? axeRaw.incomplete.length : 0,
      };

      const domSnapshot = await page.evaluate<DomPageSnapshot>(COLLECT_DOM_SNAPSHOT_EXPR);

      await Promise.all(pendingSocketChecks);
      if (socketSsrfError) {
        throw new Error(socketSsrfError);
      }

      let screenshotPng: Buffer | null = null;
      let highlightedCount = 0;

      if (options.includeVisualEvidence) {
        const prepared = options.prepareVisualRemediation(axeOutput, domSnapshot, finalUrl);
        const specs = toHighlightSpecs(prepared.remediations);
        const injectExpr = buildInjectHighlightsExpression(
          specs,
          prepared.domain,
          prepared.legalRiskScore,
        );
        highlightedCount = await page.evaluate<number>(injectExpr).catch(() => 0);
        await page.waitForTimeout(80);

        let shotOpts: PlaywrightScreenshotOptions = {
          type: 'png',
          fullPage: options.fullPageScreenshot,
          timeout: SCREENSHOT_TIMEOUT_MS,
        };

        if (options.fullPageScreenshot) {
          const docSize = await page
            .evaluate<{ width: number; height: number }>(
              '({ width: Math.min(1920, Math.max(1440, document.documentElement.scrollWidth || 1440)), height: Math.max(900, document.documentElement.scrollHeight || 900) })',
            )
            .catch(() => ({ width: 1440, height: 900 }));

          if (docSize.height > MAX_SCREENSHOT_HEIGHT_PX) {
            shotOpts = {
              type: 'png',
              timeout: SCREENSHOT_TIMEOUT_MS,
              clip: {
                x: 0,
                y: 0,
                width: docSize.width,
                height: MAX_SCREENSHOT_HEIGHT_PX,
              },
            };
          }
        }

        const rawBuf = await page.screenshot(shotOpts);
        screenshotPng = Buffer.from(rawBuf);
        await page.evaluate(REMOVE_HIGHLIGHTS_EXPRESSION).catch(() => {});
      }

      await Promise.all(pendingSocketChecks);
      if (socketSsrfError) {
        throw new Error(socketSsrfError);
      }

      return {
        finalUrl,
        httpStatus,
        pageTitle,
        axeOutput,
        domSnapshot,
        screenshotPng,
        highlightedCount,
      };
    } finally {
      await context.close().catch(() => {});
    }
  }

  public async close(): Promise<void> {
    await this.browser.close().catch(() => {});
  }
}

// ============================================================================
// Engine 2: Zero-Dependency Native Chrome DevTools Protocol (CDP) Engine
// ============================================================================

interface CdpPendingCall {
  resolve: (val: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class NativeChromeCdpEngine implements BrowserAuditEngine {
  public readonly engineName = 'cdp-chrome' as const;
  private readonly proc: ChildProcess;
  private readonly ws: WebSocket;
  private readonly userDataDir: string;
  private nextId = 1;
  private readonly pending = new Map<number, CdpPendingCall>();
  private readonly eventListeners = new Map<string, Set<(params: Record<string, unknown>, sessionId?: string) => void>>();

  private constructor(proc: ChildProcess, ws: WebSocket, userDataDir: string) {
    this.proc = proc;
    this.ws = ws;
    this.userDataDir = userDataDir;

    this.ws.addEventListener('message', (ev: MessageEvent) => {
      const rawText = typeof ev.data === 'string' ? ev.data : String(ev.data);
      let msg: {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: Record<string, unknown>;
        error?: { message?: string };
        sessionId?: string;
      };
      try {
        msg = JSON.parse(rawText);
      } catch {
        return;
      }

      if (typeof msg.id === 'number') {
        const entry = this.pending.get(msg.id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(msg.id);
          if (msg.error) {
            entry.reject(new Error(msg.error.message || 'CDP command failed'));
          } else {
            entry.resolve(msg.result ?? {});
          }
        }
        return;
      }

      if (msg.method) {
        const listeners = this.eventListeners.get(msg.method);
        if (listeners) {
          for (const fn of listeners) {
            fn(msg.params ?? {}, msg.sessionId);
          }
        }
      }
    });
  }

  public static async launch(executablePath: string): Promise<NativeChromeCdpEngine> {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcag-chrome-'));
    const args = [
      '--headless=new',
      ...CHROME_LAUNCH_ARGS,
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--window-size=1440,900',
      'about:blank',
    ];

    const proc = spawn(executablePath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const wsEndpoint = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Timed out waiting for Chrome DevTools WebSocket endpoint.'));
      }, 15_000);

      let stderrBuf = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8');
        const match = /DevTools listening on (ws:\/\/[^\s\r\n]+)/.exec(stderrBuf);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });

      proc.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Chrome exited prematurely (code=${code}): ${stderrBuf.slice(0, 300)}`));
      });
    });

    const ws = new WebSocket(wsEndpoint);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP WebSocket connection timed out.')), 10_000);
      ws.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Failed to open CDP WebSocket connection.'));
      });
    });

    return new NativeChromeCdpEngine(proc, ws, userDataDir);
  }

  private onEvent(
    method: string,
    fn: (params: Record<string, unknown>, sessionId?: string) => void,
  ): () => void {
    let set = this.eventListeners.get(method);
    if (!set) {
      set = new Set();
      this.eventListeners.set(method, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  }

  private send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 20_000,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout on ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      const payload: Record<string, unknown> = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  private async evaluateInSession<T>(sessionId: string, expression: string, timeoutMs = 15_000): Promise<T> {
    const res = await this.send(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId,
      timeoutMs,
    );
    const exceptionDetails = res.exceptionDetails as { text?: string } | undefined;
    if (exceptionDetails) {
      throw new Error(`DOM evaluation error: ${exceptionDetails.text || 'unknown'}`);
    }
    const resultObj = res.result as { value?: T } | undefined;
    return resultObj?.value as T;
  }

  public isHealthy(): boolean {
    return (
      this.proc.exitCode === null &&
      this.proc.signalCode === null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  public async scanPage(options: BrowserPageScanOptions): Promise<BrowserPageScanResult> {
    const allowLocalhost = isAllowLocalhostEnabled(options.allowLocalhost);
    const created = await this.send('Target.createTarget', { url: 'about:blank' });
    const targetId = String(created.targetId || '');
    const attached = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = String(attached.sessionId || '');

    const cleanups: Array<() => void> = [];
    let mainDocStatus: number | null = null;
    let socketSsrfError: string | null = null;

    try {
      await this.send('Page.enable', {}, sessionId);
      await this.send('Runtime.enable', {}, sessionId);
      await this.send('Network.enable', {}, sessionId);
      await this.send(
        'Emulation.setDeviceMetricsOverride',
        { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );

      // Intercept subresource & redirect requests for SSRF defense
      await this.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
      cleanups.push(
        this.onEvent('Fetch.requestPaused', (params, evSession) => {
          if (evSession !== sessionId) return;
          const requestId = String(params.requestId || '');
          const reqObj = params.request as { url?: string } | undefined;
          const reqUrl = String(reqObj?.url || '');

          void (async () => {
            if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:') || reqUrl === 'about:blank') {
              await this.send('Fetch.continueRequest', { requestId }, sessionId).catch(() => {});
              return;
            }
            const ssrf = await validateUrlAgainstSsrf(reqUrl, {
              allowLocalhost,
              dnsLookup: options.dnsLookup,
            });
            if (!ssrf.allowed) {
              await this.send(
                'Fetch.failRequest',
                { requestId, errorReason: 'BlockedByClient' },
                sessionId,
              ).catch(() => {});
              return;
            }
            await this.send('Fetch.continueRequest', { requestId }, sessionId).catch(() => {});
          })();
        }),
      );

      cleanups.push(
        this.onEvent('Network.responseReceived', (params, evSession) => {
          if (evSession !== sessionId) return;
          const resp = params.response as
            | { status?: number; url?: string; remoteIPAddress?: string }
            | undefined;
          const respUrl = String(resp?.url || '');

          if (
            resp?.remoteIPAddress &&
            !respUrl.startsWith('data:') &&
            !respUrl.startsWith('blob:') &&
            respUrl !== 'about:blank'
          ) {
            const cleanIp = resp.remoteIPAddress.trim().replace(/^\[|\]$/g, '');
            if (cleanIp) {
              const ipCheck = classifyIpAddress(cleanIp, allowLocalhost);
              if (!ipCheck.allowed) {
                socketSsrfError = `SSRF guard blocked remote socket IP ${cleanIp}: ${ipCheck.reason}`;
                void this.send('Page.stopLoading', {}, sessionId).catch(() => {});
              }
            }
          }

          if (params.type === 'Document' && typeof resp?.status === 'number') {
            mainDocStatus = resp.status;
          }
        }),
      );

      const loadPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, options.navigationTimeoutMs);
        const off = this.onEvent('Page.loadEventFired', (_params, evSession) => {
          if (evSession === sessionId) {
            clearTimeout(timeout);
            off();
            resolve();
          }
        });
        cleanups.push(() => clearTimeout(timeout));
      });

      const navRes = await this.send(
        'Page.navigate',
        { url: options.url },
        sessionId,
        options.navigationTimeoutMs,
      );
      if (typeof navRes.errorText === 'string' && navRes.errorText) {
        throw new Error(`Navigation failed: ${navRes.errorText}`);
      }

      await loadPromise;
      if (socketSsrfError) {
        throw new Error(socketSsrfError);
      }

      await new Promise<void>((r) => setTimeout(r, 250));
      if (socketSsrfError) {
        throw new Error(socketSsrfError);
      }

      const finalUrl = await this.evaluateInSession<string>(sessionId, 'window.location.href');
      const postNavSsrf = await validateUrlAgainstSsrf(finalUrl, {
        allowLocalhost,
        dnsLookup: options.dnsLookup,
      });
      if (!postNavSsrf.allowed) {
        throw new Error(`Post-redirect SSRF guard blocked destination: ${postNavSsrf.reason}`);
      }

      const pageTitle = (await this.evaluateInSession<string>(sessionId, 'document.title || ""')) || null;
      const axeOutput = await this.evaluateInSession<RawAxeScanOutput>(
        sessionId,
        buildFallbackDomWcagAuditExpression(options.wcagTags),
      );
      const domSnapshot = await this.evaluateInSession<DomPageSnapshot>(
        sessionId,
        COLLECT_DOM_SNAPSHOT_EXPR,
      );

      if (socketSsrfError) {
        throw new Error(socketSsrfError);
      }

      let screenshotPng: Buffer | null = null;
      let highlightedCount = 0;

      if (options.includeVisualEvidence) {
        const prepared = options.prepareVisualRemediation(axeOutput, domSnapshot, finalUrl);
        const specs = toHighlightSpecs(prepared.remediations);
        const injectExpr = buildInjectHighlightsExpression(
          specs,
          prepared.domain,
          prepared.legalRiskScore,
        );
        highlightedCount = await this.evaluateInSession<number>(sessionId, injectExpr).catch(() => 0);
        await new Promise<void>((r) => setTimeout(r, 80));

        const captureParams: Record<string, unknown> = { format: 'png', fromSurface: true };

        if (options.fullPageScreenshot) {
          const metrics = await this.send('Page.getLayoutMetrics', {}, sessionId);
          const contentSize = metrics.cssContentSize as { width?: number; height?: number } | undefined;
          if (contentSize?.width && contentSize?.height) {
            const cappedWidth = Math.min(1920, Math.ceil(contentSize.width));
            const cappedHeight = Math.min(MAX_SCREENSHOT_HEIGHT_PX, Math.ceil(contentSize.height));
            await this.send(
              'Emulation.setDeviceMetricsOverride',
              {
                width: cappedWidth,
                height: cappedHeight,
                deviceScaleFactor: 1,
                mobile: false,
              },
              sessionId,
            );
            captureParams.clip = {
              x: 0,
              y: 0,
              width: cappedWidth,
              height: cappedHeight,
              scale: 1,
            };
          }
        }

        const shotRes = await this.send(
          'Page.captureScreenshot',
          captureParams,
          sessionId,
          SCREENSHOT_TIMEOUT_MS,
        );
        if (typeof shotRes.data === 'string' && shotRes.data.length > 0) {
          screenshotPng = Buffer.from(shotRes.data, 'base64');
        }
        await this.evaluateInSession(sessionId, REMOVE_HIGHLIGHTS_EXPRESSION).catch(() => {});
      }

      if (socketSsrfError) {
        throw new Error(socketSsrfError);
      }

      return {
        finalUrl,
        httpStatus: mainDocStatus,
        pageTitle,
        axeOutput,
        domSnapshot,
        screenshotPng,
        highlightedCount,
      };
    } finally {
      for (const cleanup of cleanups) cleanup();
      await this.send('Target.closeTarget', { targetId }, undefined, 5_000).catch(() => {});
    }
  }

  public async close(): Promise<void> {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Browser closed'));
    }
    this.pending.clear();
    try {
      this.ws.close();
    } catch {
      // Ignore WebSocket close error
    }
    if (this.proc.exitCode === null && this.proc.signalCode === null) {
      const exited = new Promise<void>((resolve) => {
        this.proc.once('exit', () => resolve());
        this.proc.once('error', () => resolve());
      });
      try {
        this.proc.kill('SIGTERM');
      } catch {
        // Ignore process termination error
      }
      const killTimer = setTimeout(() => {
        try {
          if (this.proc.exitCode === null) this.proc.kill('SIGKILL');
        } catch {
          // Ignore SIGKILL error
        }
      }, 1_000);
      killTimer.unref?.();
      await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 1_500))]);
      clearTimeout(killTimer);
    }
    await fs.promises
      .rm(this.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      .catch(() => {});
  }
}

export async function createBrowserAuditEngine(): Promise<BrowserAuditEngine> {
  const executablePath = resolveChromiumExecutablePath();
  const pwModuleName = 'playwright';
  const axeModuleName = '@axe-core/playwright';

  try {
    const pwMod = (await import(pwModuleName)) as {
      chromium?: {
        launch: (opts: Record<string, unknown>) => Promise<PlaywrightBrowserLike>;
      };
    };
    const axeMod = (await import(axeModuleName)) as {
      AxeBuilder?: AxeBuilderConstructorLike;
      default?: AxeBuilderConstructorLike;
    };

    const AxeCtor = axeMod.AxeBuilder ?? axeMod.default;
    if (pwMod?.chromium && AxeCtor) {
      const browser = await pwMod.chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: CHROME_LAUNCH_ARGS,
      });
      return new PlaywrightAxeEngine(browser, AxeCtor);
    }
  } catch {
    // Playwright / @axe-core/playwright not installed in node_modules -> fallback to native Chrome CDP
  }

  if (!executablePath) {
    throw new Error(
      'No Chromium/Chrome executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or install Google Chrome / Playwright.',
    );
  }

  return NativeChromeCdpEngine.launch(executablePath);
}
