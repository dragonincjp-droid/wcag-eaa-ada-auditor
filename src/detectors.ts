import type {
  DomAnchorCandidate,
  DomPageSnapshot,
  EaaStatementResult,
  OverlayDetectionResult,
  OverlayVendorMatch,
} from './types.js';

interface VendorSignature {
  vendor: string;
  scriptPatterns: RegExp[];
  domPatterns: RegExp[];
  globalKeys: string[];
}

const OVERLAY_SIGNATURES: VendorSignature[] = [
  {
    vendor: 'accessiBe',
    scriptPatterns: [/acsbapp\.com/i, /acsbap\.com/i, /accessibe\.com/i, /\bacsbjs\b/i, /acsb\.init/i],
    domPatterns: [/^#?acsb[-_]/i, /\bacsb-trigger\b/i, /\bacsb-widget\b/i, /^data-acsb/i],
    globalKeys: ['acsbJS', 'acsb', 'acsbState'],
  },
  {
    vendor: 'UserWay',
    scriptPatterns: [/userway\.org/i, /_userway_config/i, /UserWayWidgetApp/i],
    domPatterns: [/^#?userway/i, /\buwy\b/i, /^data-uw-/i, /userwayAccessibilityIcon/i],
    globalKeys: ['UserWay', '_userway_config', 'userway'],
  },
  {
    vendor: 'AudioEye',
    scriptPatterns: [/audioeye\.com/i, /wsvcdn\.audioeye\.com/i, /__AudioEye/i],
    domPatterns: [/^#?ae_launcher$/i, /^#?ae_app$/i, /^data-ae-/i, /\baudioeye\b/i],
    globalKeys: ['__AudioEye', 'AudioEye'],
  },
  {
    vendor: 'EqualWeb',
    scriptPatterns: [/nagich\.com/i, /equalweb\.com/i, /interdeal/i],
    domPatterns: [/^#?INDmenu-btn$/i, /^#?INDWrap$/i, /^data-nagich/i, /\bequalweb\b/i],
    globalKeys: ['interdeal', 'EqualWeb'],
  },
  {
    vendor: 'Recite Me',
    scriptPatterns: [/reciteme\.com/i, /api\.reciteme\.com/i],
    domPatterns: [/^#?reciteme/i, /\breciteme[-_]/i, /^data-reciteme/i],
    globalKeys: ['Recite', 'reciteMe'],
  },
  {
    vendor: 'Monsido',
    scriptPatterns: [/monsido\.com/i, /app-script\.monsido\.com/i, /pagecorrect\.monsido\.com/i, /_monsido/i],
    domPatterns: [/^#?monsido/i, /^data-monsido/i],
    globalKeys: ['_monsido', 'monsido'],
  },
  {
    vendor: 'MaxAccess',
    scriptPatterns: [/maxaccess\.io/i, /cdn\.maxaccess\.io/i],
    domPatterns: [/^#?maxaccess/i, /^data-maxaccess/i],
    globalKeys: ['MaxAccess', 'maxAccess'],
  },
  {
    vendor: 'User1st',
    scriptPatterns: [/user1st\.info/i, /fecdn\.user1st\.info/i],
    domPatterns: [/^#?u1st/i, /^#?user1st/i, /^data-u1st/i],
    globalKeys: ['_u1st', 'User1st', 'u1st'],
  },
  {
    vendor: "Facil'iti",
    scriptPatterns: [/facil-iti\.com/i, /ws\.facil-iti\.com/i],
    domPatterns: [/^#?facil[-_]?iti/i, /^data-faciliti/i],
    globalKeys: ['FACIL_ITI', 'faciliti'],
  },
  {
    vendor: 'AccessiWay',
    scriptPatterns: [/accessiway\.com/i, /cdn\.accessiway\.com/i],
    domPatterns: [/^#?accessiway/i],
    globalKeys: ['AccessiWay'],
  },
];

const OVERLAY_VENDOR_DOMAINS = [
  'acsbapp.com',
  'accessibe.com',
  'userway.org',
  'audioeye.com',
  'equalweb.com',
  'nagich.com',
  'reciteme.com',
  'monsido.com',
  'maxaccess.io',
  'user1st.info',
  'facil-iti.com',
  'accessiway.com',
];

export function detectOverlayWidgets(
  snapshot: DomPageSnapshot,
  remainingCriticalOrSeriousCount = 0,
): OverlayDetectionResult {
  const matchedSignals: OverlayVendorMatch[] = [];
  const allScripts = [...snapshot.scriptUrls, ...snapshot.stylesheetUrls, ...snapshot.inlineScriptSnippets];
  const allDomTokens = [...snapshot.domIdsAndClasses, ...snapshot.dataAttributes];
  const globalSet = new Set(snapshot.globalWindowKeys);

  for (const sig of OVERLAY_SIGNATURES) {
    const vendorSignals: string[] = [];

    for (const pat of sig.scriptPatterns) {
      const hit = allScripts.find((s) => pat.test(s));
      if (hit) {
        const preview = hit.length > 90 ? `${hit.slice(0, 87)}...` : hit;
        vendorSignals.push(`script:${preview}`);
      }
    }

    for (const pat of sig.domPatterns) {
      const hit = allDomTokens.find((t) => pat.test(t));
      if (hit) {
        vendorSignals.push(`dom:${hit}`);
      }
    }

    for (const gKey of sig.globalKeys) {
      if (globalSet.has(gKey)) {
        vendorSignals.push(`window.${gKey}`);
      }
    }

    if (vendorSignals.length > 0) {
      matchedSignals.push({
        vendor: sig.vendor,
        signals: Array.from(new Set(vendorSignals)).slice(0, 5),
      });
    }
  }

  const overlayVendors = matchedSignals.map((m) => m.vendor);
  const overlayDetected = overlayVendors.length > 0;

  let regulatoryWarning: string | null = null;
  if (overlayDetected) {
    const vendorLabel = overlayVendors.join(', ');
    if (remainingCriticalOrSeriousCount > 0) {
      regulatoryWarning = `Third-party overlay widget detected (${vendorLabel}), yet ${remainingCriticalOrSeriousCount} critical/serious WCAG 2.2 AA DOM violations remain exposed to assistive technologies. Both the US FTC ($1M enforcement order on deceptive overlay compliance claims) and European accessibility authorities warn that JavaScript overlays alone do not achieve statutory EAA/ADA compliance.`;
    } else {
      regulatoryWarning = `Third-party overlay widget detected (${vendorLabel}). Both US FTC enforcement precedent and EU EAA / EDPB guidance warn that third-party JavaScript overlay widgets cannot substitute for native WCAG 2.2 code compliance and may introduce assistive-technology friction.`;
    }
  }

  return {
    overlayDetected,
    overlayVendors,
    regulatoryWarning,
    matchedSignals,
  };
}

interface LanguageStatementPattern {
  lang: string;
  strongTextRegex: RegExp;
  generalTextRegex: RegExp;
  pathRegex: RegExp;
}

const EAA_LANGUAGE_PATTERNS: LanguageStatementPattern[] = [
  {
    lang: 'en',
    strongTextRegex: /\b(accessibility\s+(statement|policy|notice|conformance|plan)|vpat|wcag\s*2\.[12])\b/i,
    generalTextRegex: /\b(accessibility|accessible\s+web|ada\s+compliance)\b/i,
    pathRegex: /\/(accessibility([-_](statement|policy|notice))?|wcag|vpat|ada-compliance)(\/|$|\?|\.)/i,
  },
  {
    lang: 'de',
    strongTextRegex: /(erkl[äa]rung\s+zur\s+barrierefreiheit|barrierefreiheitserkl[äa]rung)/i,
    generalTextRegex: /\b(barrierefreiheit|barrierefreie\s+informationstechnik)\b/i,
    pathRegex: /\/(barrierefreiheit(serklaerung|serklärung)?|erklaerung-zur-barrierefreiheit)(\/|$|\?|\.)/i,
  },
  {
    lang: 'fr',
    strongTextRegex: /(d[ée]claration\s+d['’]accessibilit[ée]|sch[ée]ma\s+pluriannuel\s+d['’]accessibilit[ée]|\brgaa\b)/i,
    generalTextRegex: /\b(accessibilit[ée])\b/i,
    pathRegex: /\/(accessibilite|declaration-d-accessibilite|declaration-accessibilite|rgaa)(\/|$|\?|\.)/i,
  },
  {
    lang: 'es',
    strongTextRegex: /(declaraci[óo]n\s+de\s+accesibilidad|pol[íi]tica\s+de\s+accesibilidad)/i,
    generalTextRegex: /\b(accesibilidad)\b/i,
    pathRegex: /\/(accesibilidad|declaracion-de-accesibilidad)(\/|$|\?|\.)/i,
  },
  {
    lang: 'it',
    strongTextRegex: /(dichiarazione\s+di\s+accessibilit[àa]|obiettivi\s+di\s+accessibilit[àa])/i,
    generalTextRegex: /\b(accessibilit[àa])\b/i,
    pathRegex: /\/(accessibilita|dichiarazione-di-accessibilita)(\/|$|\?|\.)/i,
  },
  {
    lang: 'nl',
    strongTextRegex: /\b(toegankelijkheidsverklaring)\b/i,
    generalTextRegex: /\b(toegankelijkheid|digitoegankelijk)\b/i,
    pathRegex: /\/(toegankelijkheid(sverklaring)?)(\/|$|\?|\.)/i,
  },
  {
    lang: 'pt',
    strongTextRegex: /(declara[çc][ãa]o\s+de\s+acessibilidade)/i,
    generalTextRegex: /\b(acessibilidade)\b/i,
    pathRegex: /\/(acessibilidade|declaracao-de-acessibilidade)(\/|$|\?|\.)/i,
  },
  {
    lang: 'pl',
    strongTextRegex: /(deklaracja\s+dost[ęe]pno[śs]ci)/i,
    generalTextRegex: /\b(dost[ęe]pno[śs][ćc])\b/i,
    pathRegex: /\/(deklaracja-dostepnosci|dostepnosc)(\/|$|\?|\.)/i,
  },
  {
    lang: 'sv',
    strongTextRegex: /\b(tillg[äa]nglighetsredog[öo]relse)\b/i,
    generalTextRegex: /\b(tillg[äa]nglighet)\b/i,
    pathRegex: /\/(tillganglighetsredogorelse|tillganglighet)(\/|$|\?|\.)/i,
  },
];

function isGenuineNavigationalAnchor(anchor: DomAnchorCandidate, pageUrl: string): boolean {
  const raw = anchor.href.trim();
  if (!raw || raw === '#' || raw.startsWith('#')) return false;
  if (/^(javascript|mailto|tel|sms|blob|data):/i.test(raw)) return false;

  let resolved: URL;
  try {
    resolved = new URL(anchor.resolvedHref || raw, pageUrl);
  } catch {
    return false;
  }

  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return false;
  }

  // Reject links pointing to overlay widget marketing websites
  const host = resolved.hostname.toLowerCase();
  if (OVERLAY_VENDOR_DOMAINS.some((vendorDom) => host === vendorDom || host.endsWith(`.${vendorDom}`))) {
    return false;
  }

  // Reject same-page hash jump disguised as a full URL
  try {
    const current = new URL(pageUrl);
    if (
      resolved.origin === current.origin &&
      resolved.pathname === current.pathname &&
      resolved.search === current.search &&
      resolved.hash
    ) {
      return false;
    }
  } catch {
    // Ignore malformed base pageUrl
  }

  return true;
}

export function detectAccessibilityStatement(
  anchors: DomAnchorCandidate[],
  pageUrl: string,
): EaaStatementResult {
  interface ScoredCandidate {
    score: number;
    url: string;
    text: string;
    lang: string;
    location: 'footer' | 'nav' | 'body';
  }

  let best: ScoredCandidate | null = null;

  for (const anchor of anchors) {
    if (!isGenuineNavigationalAnchor(anchor, pageUrl)) continue;

    let resolvedUrl: URL;
    try {
      resolvedUrl = new URL(anchor.resolvedHref || anchor.href, pageUrl);
    } catch {
      continue;
    }

    const combinedText = `${anchor.text} ${anchor.ariaLabel} ${anchor.title}`.replace(/\s+/g, ' ').trim();
    const pathname = decodeURIComponent(resolvedUrl.pathname || '');

    for (const pat of EAA_LANGUAGE_PATTERNS) {
      let score = 0;
      if (pat.strongTextRegex.test(combinedText)) {
        score += 60;
      } else if (pat.generalTextRegex.test(combinedText)) {
        score += 35;
      }

      if (pat.pathRegex.test(pathname)) {
        score += 40;
      }

      if (score === 0) continue;

      const location: 'footer' | 'nav' | 'body' = anchor.inFooter
        ? 'footer'
        : anchor.inNav
          ? 'nav'
          : 'body';

      if (location === 'footer') score += 20;
      else if (location === 'nav') score += 10;

      if (!best || score > best.score) {
        best = {
          score,
          url: resolvedUrl.toString(),
          text: anchor.text.trim() || anchor.ariaLabel.trim() || pathname,
          lang: pat.lang,
          location,
        };
      }
    }
  }

  if (best) {
    return {
      accessibilityStatementFound: true,
      statementUrl: best.url,
      statementText: best.text,
      detectedLanguage: best.lang,
      location: best.location,
      missingStatementRisk: 'LOW — Accessibility Statement link detected on page.',
    };
  }

  return {
    accessibilityStatementFound: false,
    statementUrl: null,
    statementText: null,
    detectedLanguage: null,
    location: null,
    missingStatementRisk:
      "HIGH — No Accessibility Statement link (e.g., 'Accessibility Statement' / 'Barrierefreiheitserklärung') was detected on the page, which is a mandatory transparency disclosure for covered digital services under the European Accessibility Act (EAA).",
  };
}
