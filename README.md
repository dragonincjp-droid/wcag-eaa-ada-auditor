# WCAG 2.2 / EAA & ADA Accessibility Legal Risk Auditor (API + Overlay Detector + MCP Server)

**Bulk-audit 1,000+ websites for WCAG 2.2 Level A/AA violations, European Accessibility Act (EAA) statement gaps, and risky accessibility overlay widgets (`accessiBe`, `UserWay`, `AudioEye`) in minutes — complete with annotated red-box screenshot proof, copy-paste HTML fix diffs, and ready-to-send B2B cold outreach hooks.**

Built on real headless **Chromium (Playwright)** + **`@axe-core/playwright`** + deterministic legal-risk heuristics. Zero OpenAI/LLM API keys required. Ready for **Clay**, **n8n**, **Make**, **REST API**, and **AI Coding Agents via MCP (`Claude Desktop`, `Cursor`, `Windsurf`)**.

---

## Why Agencies, SEO Teams & Developers Use This WCAG 2.2 Checker API

Between **European Accessibility Act (EAA / Directive (EU) 2019/882)** enforcement across EU member states, **US DOJ ADA Title II mandates (April 2026 deadline)**, and **4,000+ annual US ADA Title III e-commerce lawsuits**, businesses urgently need real code-level accessibility remediation.

Yet agencies face a massive tooling gap:
- **Enterprise SaaS platforms** (Siteimprove, Monsido, AudioEye) lock you into **$500–$2,500/month** annual contracts and restrict bulk outbound prospecting.
- **No-code workflow tools** (Clay, n8n, Make) cannot natively spin up headless Chromium browsers to execute JavaScript, compute CSS contrast ratios, or capture annotated visual proof at scale.
- **"One-line JS Overlay Widgets"** (`accessiBe`, `UserWay`, `EqualWeb`) have faced **US FTC enforcement scrutiny (including a $1M FTC order in the overlay sector in 2025)**, **European Commission / EDPB warnings**, and **hundreds of ADA lawsuits** — making companies that have an overlay installed the **highest-converting prospects** for genuine code remediation.

### The B2B Lead Generation ROI Math

| Metric | Traditional Manual Audit | Bulk Audit with This Actor |
| :--- | :--- | :--- |
| **1,000 Prospect Websites Audited** | ~250 hours of manual DevTools work | **~12–20 minutes (automated)** |
| **Total Tooling Cost (1,000 URLs)** | $500–$2,000/mo SaaS seat + labor | **$25.01** (JSON triage) – **$40.01** (with annotated PNGs) |
| **Sales Proof Included** | Generic text claims prospects ignore | **Red-box visual screenshot + HTML fix diff + custom pitch hook** |
| **1 Closed Remediation Project** | $3,000 – $10,000+ retainer | **90x – 300x return on a single $25–$40 batch run** |

> **Free to Try Immediately:** Every Apify account includes **$5.00 in free monthly platform credits** — enough to run **124 full visual audits** (with annotated screenshots) or **199 fast JSON audits** every month at `$0` out-of-pocket cost.

---

## Core Capabilities

1. **Real Browser WCAG 2.2 Level A & AA Engine (`@axe-core/playwright`)**
   Executes full client-side JavaScript (React, Next.js, Shopify, WordPress, Webflow) in Chromium before auditing against W3C **WCAG 2.0, 2.1, and 2.2 Level A/AA** rules — including high-litigation blockers like missing form labels, empty links/buttons, keyboard focus traps, color contrast failures, and target size violations.
2. **0–100 Legal Risk Score & Actionable Risk Tier (`CRITICAL` | `HIGH` | `MEDIUM` | `LOW`)**
   Converts raw technical violations into a prioritized `legalRiskScore` (`0`–`100`) weighted by violation severity, affected DOM node count, missing EAA compliance disclosures, and unmitigated overlay widget reliance.
3. **Accessibility Overlay Detector (`accessiBe`, `UserWay`, `AudioEye` & More)**
   Automatically inspects scripts, globals, and DOM signatures to flag third-party overlay widgets (`accessiBe`, `UserWay`, `AudioEye`, `EqualWeb`, `Recite Me`, `Monsido`, `User1st`, `MaxAccess`) alongside underlying DOM violations the widget failed to fix.
4. **European Accessibility Act (EAA) Statement Checker**
   Scans navigation and footer links across major European languages (`Accessibility Statement`, `Barrierefreiheitserklärung`, `Déclaration d'accessibilité`, `Declaración de accesibilidad`, `Dichiarazione di accessibilità`, `Toegankelijkheidsverklaring`) to detect missing statutory disclosures under EN 301 549 / EAA.
5. **Annotated Red-Box Visual Evidence (`visualEvidenceUrl`)**
   Captures a crisp viewport PNG screenshot with **high-contrast red bounding boxes and numbered badges** pointing directly to broken UI elements — ready to embed inside cold emails, Loom teardowns, or PDF client proposals.
6. **Before/After HTML Remediation Diffs (`beforeHtml` → `suggestedFixHtml`)**
   Generates deterministic, copy-paste HTML/ARIA code fixes for top violations so developers (or AI coding assistants) can remediate issues in seconds.
7. **Plug-and-Play Cold Outreach Icebreaker (`salesPitchHook`)**
   Outputs a deterministic, zero-hallucination 1–2 sentence English sales hook tailored to each prospect's exact audit findings — ready to map straight into **Clay**, **Instantly**, **Smartlead**, or **Lemlist**.
8. **Dual Interface: Apify Batch Actor + Model Context Protocol (MCP) Server**
   Run bulk 1,000-URL lead enrichment batches via REST API, or connect **Claude Desktop**, **Cursor**, or **Windsurf** to the **`audit_website_accessibility`** MCP tool for real-time interactive auditing.

---

## Input Parameters

Configure the Actor via the Apify Console UI or pass a JSON payload to the API:

| Field | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| `urls` | `string[]` / RequestList | *Required*\* | List of website URLs to audit (supports plain URL strings like `["https://example.com"]` or Apify `RequestList` objects / Google Sheets / text file imports). *Required unless `url` is provided.* |
| `url` | `string` | *Optional* | Optional single-URL shorthand field for REST webhooks, Clay HTTP columns, or single-site MCP calls. |
| `wcagLevel` | `"AA"` \| `"A"` | `"AA"` | Target W3C conformance level. `"AA"` is the global legal benchmark referenced by the **EU EAA (EN 301 549)** and **US DOJ ADA Title II/III** enforcement. |
| `includeVisualEvidence` | `boolean` | `true` | Generates an annotated PNG screenshot with red bounding boxes + numbered violation badges stored in Key-Value Store (`+$0.015/URL`). Set to `false` for ultra-low-cost `$0.025/URL` lead triage. |
| `fullPageScreenshot` | `boolean` | `false` | Captures the full scrollable page height instead of the above-the-fold desktop viewport (`1440x900`) when generating visual evidence. |
| `detectOverlays` | `boolean` | `true` | Detects 3rd-party accessibility overlay widgets (`accessiBe`, `UserWay`, `AudioEye`, `EqualWeb`, `Recite Me`, `Monsido`, `MaxAccess`, `User1st`, `Facil'iti`) and flags unmitigated DOM violations. |
| `checkAccessibilityStatement` | `boolean` | `true` | Scans navigation and footer links across EN/DE/FR/ES/IT/NL for mandatory EAA / public-sector Accessibility Statement disclosures. |
| `respectRobotsTxt` | `boolean` | `true` | Checks domain `/robots.txt` rules before auditing and skips disallowed paths for ethical, compliant scanning. |
| `maxUrls` | `integer` | `100` | Safety cap on total URLs processed in a single run (`1`–`5,000`) to prevent accidental budget overruns. Increase up to `5,000` for bulk campaigns. |
| `maxConcurrency` | `integer` | `3` | Maximum parallel headless Chromium tabs (`1`–`10`). Keep at `2`–`5` for optimal stability and low memory overhead. |
| `domainDelayMs` | `integer` | `1000` | Minimum polite delay in milliseconds (`0`–`30,000`) between consecutive requests to the same hostname. |
| `navigationTimeoutSecs` | `integer` | `30` | Maximum time in seconds (`5`–`120`) to wait for each page load and DOM stabilization. |
| `maxViolationsPerUrl` | `integer` | `10` | Maximum number of prioritized violations (`1`–`50`) with Before/After HTML diffs included per URL. |

### Sample Input JSON

```json
{
  "urls": [
    "https://example-fashion-store.de",
    "https://example-dental-clinic.com"
  ],
  "wcagLevel": "AA",
  "includeVisualEvidence": true,
  "fullPageScreenshot": false,
  "detectOverlays": true,
  "checkAccessibilityStatement": true,
  "respectRobotsTxt": true,
  "maxUrls": 100,
  "maxConcurrency": 3,
  "domainDelayMs": 1000,
  "navigationTimeoutSecs": 30,
  "maxViolationsPerUrl": 10
}
```

---

## Output Dataset Sample (JSON)

Each audited URL produces one structured JSON item in the Apify Dataset (including flat top-level convenience fields for 1-click Clay / n8n / Make column mapping alongside rich nested details):

```json
{
  "url": "https://example-fashion-store.de",
  "finalUrl": "https://www.example-fashion-store.de/",
  "domain": "www.example-fashion-store.de",
  "auditedAt": "2026-11-24T10:15:32.418Z",
  "status": "audited",
  "httpStatus": 200,
  "pageTitle": "Example Fashion Store — Winter Collection",
  "loadTimeMs": 1420,
  "legalRiskScore": 86,
  "riskTier": "CRITICAL",
  "summary": {
    "totalViolations": 7,
    "totalAffectedNodes": 19,
    "criticalCount": 2,
    "seriousCount": 3,
    "moderateCount": 2,
    "minorCount": 0,
    "passedChecksCount": 41,
    "incompleteChecksCount": 1
  },
  "overlayDetected": true,
  "overlayVendors": [
    "UserWay"
  ],
  "overlayDetection": {
    "overlayDetected": true,
    "overlayVendors": [
      "UserWay"
    ],
    "regulatoryWarning": "Third-party overlay widget detected (UserWay), yet 5 critical/serious WCAG 2.2 AA DOM violations remain exposed to screen readers. Both US FTC enforcement actions and EU accessibility authorities warn that JavaScript overlays alone do not achieve statutory WCAG/EAA compliance.",
    "matchedSignals": [
      {
        "vendor": "UserWay",
        "signals": [
          "script:cdn.userway.org"
        ]
      }
    ]
  },
  "accessibilityStatementFound": false,
  "accessibilityStatementUrl": null,
  "eaaCompliance": {
    "accessibilityStatementFound": false,
    "statementUrl": null,
    "statementText": null,
    "detectedLanguage": "de",
    "location": null,
    "missingStatementRisk": "HIGH — No Accessibility Statement link (e.g., 'Accessibility Statement' / 'Barrierefreiheitserklärung') was detected on the page, which is a mandatory transparency disclosure for covered digital services under the European Accessibility Act (EAA)."
  },
  "salesPitchHook": "Noticed example-fashion-store.de uses the UserWay widget, yet an automated WCAG 2.2 AA scan still flagged 2 critical checkout/navigation blockers (missing button names and unlabeled form inputs) plus a missing EAA Accessibility Statement.",
  "visualEvidenceKey": "evidence-example-fashion-store-de-1732443332.png",
  "visualEvidenceUrl": "https://api.apify.com/v2/key-value-stores/abc123XYZ/records/evidence-example-fashion-store-de-1732443332.png",
  "visualEvidence": {
    "generated": true,
    "key": "evidence-example-fashion-store-de-1732443332.png",
    "url": "https://api.apify.com/v2/key-value-stores/abc123XYZ/records/evidence-example-fashion-store-de-1732443332.png",
    "highlightedCount": 3,
    "byteLength": 148290
  },
  "topViolations": [
    {
      "badgeNumber": 1,
      "ruleId": "button-name",
      "impact": "critical",
      "wcagCriteria": [
        "wcag2a",
        "wcag412"
      ],
      "description": "Buttons must have discernible text so screen reader users understand their action.",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.10/button-name",
      "affectedNodesCount": 3,
      "targetSelectors": [
        "button.cart-drawer-toggle",
        "button.search-submit-icon",
        "button.mobile-menu-trigger"
      ],
      "beforeHtml": "<button class=\"cart-drawer-toggle\"><svg class=\"icon-bag\"></svg></button>",
      "afterHtml": "<button class=\"cart-drawer-toggle\" aria-label=\"Open shopping cart\"><svg class=\"icon-bag\" aria-hidden=\"true\" focusable=\"false\"></svg></button>",
      "suggestedFixHtml": "<button class=\"cart-drawer-toggle\" aria-label=\"Open shopping cart\"><svg class=\"icon-bag\" aria-hidden=\"true\" focusable=\"false\"></svg></button>",
      "unifiedDiff": "- <button class=\"cart-drawer-toggle\"><svg class=\"icon-bag\"></svg></button>\n+ <button class=\"cart-drawer-toggle\" aria-label=\"Open shopping cart\"><svg class=\"icon-bag\" aria-hidden=\"true\" focusable=\"false\"></svg></button>"
    },
    {
      "badgeNumber": 2,
      "ruleId": "label",
      "impact": "critical",
      "wcagCriteria": [
        "wcag2a",
        "wcag412",
        "wcag131"
      ],
      "description": "Form input elements must have programmatically associated labels.",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.10/label",
      "affectedNodesCount": 2,
      "targetSelectors": [
        "input#newsletter-email",
        "input[name=\"postal_code\"]"
      ],
      "beforeHtml": "<input id=\"newsletter-email\" type=\"email\" placeholder=\"Enter your email\">",
      "afterHtml": "<label for=\"newsletter-email\" class=\"sr-only\">Email address</label>\n<input id=\"newsletter-email\" type=\"email\" autocomplete=\"email\" placeholder=\"Enter your email\">",
      "suggestedFixHtml": "<label for=\"newsletter-email\" class=\"sr-only\">Email address</label>\n<input id=\"newsletter-email\" type=\"email\" autocomplete=\"email\" placeholder=\"Enter your email\">",
      "unifiedDiff": "- <input id=\"newsletter-email\" type=\"email\" placeholder=\"Enter your email\">\n+ <label for=\"newsletter-email\" class=\"sr-only\">Email address</label>\n+ <input id=\"newsletter-email\" type=\"email\" autocomplete=\"email\" placeholder=\"Enter your email\">"
    },
    {
      "badgeNumber": 3,
      "ruleId": "color-contrast",
      "impact": "serious",
      "wcagCriteria": [
        "wcag2aa",
        "wcag143"
      ],
      "description": "Elements must meet minimum WCAG 2.2 AA color contrast ratio thresholds (4.5:1 for normal text).",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
      "affectedNodesCount": 9,
      "targetSelectors": [
        ".promo-banner-subtext",
        ".footer-legal-link"
      ],
      "beforeHtml": "<span class=\"promo-banner-subtext\" style=\"color: #999999; background: #ffffff;\">Free EU shipping over €50</span>",
      "afterHtml": "<span class=\"promo-banner-subtext\" style=\"color: #595959; background: #ffffff;\">Free EU shipping over €50</span>",
      "suggestedFixHtml": "<span class=\"promo-banner-subtext\" style=\"color: #595959; background: #ffffff;\">Free EU shipping over €50</span> <!-- Contrast >= 7.0:1 (AAA/AA Pass) -->",
      "unifiedDiff": "- <span class=\"promo-banner-subtext\" style=\"color: #999999; background: #ffffff;\">Free EU shipping over €50</span>\n+ <span class=\"promo-banner-subtext\" style=\"color: #595959; background: #ffffff;\">Free EU shipping over €50</span>"
    }
  ],
  "disclaimer": "Automated technical WCAG 2.2 Level A/AA inspection result powered by axe-core and deterministic DOM heuristics. Automated scans identify technical code barriers (~40-57% of WCAG criteria) and do not constitute legal advice or a formal guarantee of regulatory compliance under the European Accessibility Act (EAA), US ADA, or Section 508."
}
```

---

## Transparent Pay-Per-Event (PPE) Pricing

No monthly subscriptions. No seat licenses. You only pay pennies for exact audit events executed:

| Billing Event Name | Unit Price | When It Triggers |
| :--- | :---: | :--- |
| `actor-start` | **$0.01** | Charged once when an Actor run initializes. |
| `url-audited` | **$0.025** | Charged per successfully audited URL (includes full WCAG 2.2 JSON, overlay check, EAA statement check, HTML fix diffs & `salesPitchHook`). |
| `visual-evidence-generated` | **$0.015** | *Optional* — Charged only when `includeVisualEvidence: true` and an annotated red-box PNG screenshot is generated. |

### Real-World Batch Cost Calculator

| Use Case | `includeVisualEvidence` | Total Cost | Notes |
| :--- | :---: | :---: | :--- |
| **Single Website Quick Check (1 URL)** | `true` | **$0.05** | `$0.01` start + `$0.025` audit + `$0.015` PNG |
| **100 URLs — Fast Lead Qualification** | `false` | **$2.51** | **100% Free** inside Apify's `$5/mo` starter credit |
| **100 URLs — Full Audit + Red-Box PNGs** | `true` | **$4.01** | **100% Free** inside Apify's `$5/mo` starter credit |
| **1,000 URLs — Fast JSON Triage** | `false` | **$25.01** | Ideal Pass 1 inside Clay / Apollo / n8n |
| **1,000 URLs — Full Visual Outreach Pack** | `true` | **$40.01** | Every lead gets custom red-box screenshot proof |
| **Agency "Two-Pass" Funnel (1,000 URLs)** | Pass 1 `false` → Pass 2 `true` (top 200) | **$33.02** | Triage 1,000 domains (`$25.01`), then generate PNG proof only for the 200 highest-risk leads (`$8.01`) |

---

## Plug-and-Play Integrations (Clay, n8n, Make & MCP)

Ready-to-import templates are bundled directly in the [`integrations/`](./integrations) folder of this repository:

### 1. Clay.com Lead Enrichment + Cold Email Playbooks
Use Clay's **HTTP API** column to enrich any prospect list with `legalRiskScore`, `overlayVendors`, `visualEvidenceUrl`, and `salesPitchHook`.
- Full setup guide + **3 proven Cold Email Templates** (Overlay Replacement, EU EAA Statement Gap, US ADA Checkout Risk): see [`integrations/clay-enrichment-recipe.md`](./integrations/clay-enrichment-recipe.md).
- **Endpoint (`POST`)**:
  ```text
  https://api.apify.com/v2/acts/<YOUR_USERNAME>~wcag-eaa-ada-auditor/run-sync-get-dataset-items
  ```
- **Headers**:
  - `Authorization`: `Bearer <YOUR_APIFY_API_TOKEN>`
  - `Content-Type`: `application/json`

### 2. n8n Automated Prospecting Workflow (1-Click JSON Import)
Import [`integrations/n8n-eaa-lead-enrichment-workflow.json`](./integrations/n8n-eaa-lead-enrichment-workflow.json) directly into **n8n** (Cloud or Self-Hosted):
1. Triggers manually or on a weekly schedule.
2. Sends a batch of prospect URLs to the Apify `run-sync-get-dataset-items` endpoint using `{{ $env.APIFY_API_TOKEN }}`.
3. Filters only prospects where `riskTier` is `CRITICAL`/`HIGH` or `overlayDetection.overlayDetected === true`.
4. Formats a ready-to-send outreach payload (subject line, `salesPitchHook`, annotated `visualEvidenceUrl`, and HTML fix snippet) for Instantly, Smartlead, HubSpot, or Slack.

### 3. Make.com (Integromat)
1. Add the official **Apify -> Run an Actor** module in Make.
2. Select `<YOUR_USERNAME>/wcag-eaa-ada-auditor` and enable **Run synchronously** (for batches of 1–25 URLs) or pair with **Watch Actor Runs -> Get Dataset Items** (for batches of 100–5,000 URLs).
3. Route items where `legalRiskScore >= 60` directly to Google Sheets, Airtable, Pipedrive, or Lemlist.

### 4. Model Context Protocol (MCP) Server for Claude, Cursor & Windsurf
Give your AI coding assistant real browser WCAG 2.2 vision so it can audit live staging/production sites and patch your React/HTML components automatically. Full configs in [`integrations/mcp-client-configs.json`](./integrations/mcp-client-configs.json).

- **Apify Hosted MCP Endpoint**:
  ```text
  https://mcp.apify.com/?tools=<YOUR_USERNAME>/wcag-eaa-ada-auditor
  ```
- **Actor Standby `/mcp` Tool Name**: `audit_website_accessibility`

**Quick Cursor (`.cursor/mcp.json`) Setup:**
```json
{
  "mcpServers": {
    "wcag-eaa-ada-auditor": {
      "url": "https://mcp.apify.com/?tools=<YOUR_USERNAME>/wcag-eaa-ada-auditor",
      "headers": {
        "Authorization": "Bearer <YOUR_APIFY_API_TOKEN>"
      }
    }
  }
}
```

**Example Prompt in Cursor / Claude Desktop:**
> *"Use `audit_website_accessibility` to scan `https://staging.myclient.eu` at WCAG 2.2 Level AA, check if an EAA accessibility statement is linked, and apply the suggested HTML/ARIA fixes to our header and checkout components."*

### 5. Direct cURL / REST API Call

```bash
curl -X POST "https://api.apify.com/v2/acts/<YOUR_USERNAME>~wcag-eaa-ada-auditor/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com"],
    "wcagLevel": "AA",
    "includeVisualEvidence": true,
    "detectOverlays": true,
    "checkAccessibilityStatement": true
  }'
```

---

## Ethical Scanning & Security Architecture

- **`robots.txt` Respected by Default**: `respectRobotsTxt` defaults to `true` and honors crawl directives on public websites.
- **Zero Login / Zero CAPTCHA Bypass**: Designed strictly for public-facing web pages (homepages, landing pages, product pages). Never attempts authentication bypass or anti-bot circumvention.
- **Zero-LLM Data Privacy**: All DOM inspections, risk scores, HTML fix diffs, and outreach hooks are computed **100% deterministically inside your isolated Apify run container** — zero website data is transmitted to external LLM APIs.

---

## Frequently Asked Questions (FAQ)

### Can automated testing catch 100% of WCAG 2.2, EAA, or ADA compliance issues?
No automated tool can certify 100% legal compliance — industry studies (Deque Systems / W3C) show automated DOM engines reliably catch **~40% to 57% of total WCAG issues** with near-zero false positives, while nuances like logical tab order intent or alt-text meaningfulness require human review. Crucially, however, **automated violations are the exact machine-detectable triggers plaintiff law firms and regulatory scanners look for first**, making them the ideal entry point for technical remediation and agency outreach.

### Why is the Accessibility Overlay Detector (`accessiBe` / `UserWay` / `AudioEye`) such a strong B2B sales filter?
A domain with an accessibility widget installed has **already proven two things**: (1) the business owner cares enough about ADA/EAA compliance to pay for a solution, and (2) if underlying DOM violations still trigger in Playwright + `axe-core`, their current overlay is leaving them exposed. Presenting visual screenshot proof of unmitigated DOM blockers converts far higher than pitching cold prospects unaware of accessibility laws.

### Does this Actor require my own OpenAI, Anthropic, or third-party API key?
**No.** Everything runs self-contained inside Apify using Playwright + `@axe-core/playwright` + deterministic remediation rules. There are zero hidden LLM token costs or surprise API bills.

### How fast does a batch of 100 or 1,000 URLs complete?
With `maxConcurrency: 3`–`5`, auditing 100 URLs typically finishes in **1.5 to 3 minutes** (faster when `includeVisualEvidence` is set to `false`). For batches over 50 URLs, trigger the Actor asynchronously (`/runs` endpoint or Apify Webhook) rather than synchronous HTTP (`run-sync-get-dataset-items` has a 300-second HTTP timeout).

---

## Legal Disclaimer

> **IMPORTANT — NOT LEGAL ADVICE:**
> `WCAG 2.2 / EAA & ADA Accessibility Legal Risk Auditor` is an automated technical testing and developer diagnostic utility powered by W3C WCAG 2.2 heuristics and `@axe-core/playwright`. Output metrics — including `legalRiskScore`, `riskTier`, `overlayDetection.regulatoryWarning`, `eaaCompliance`, `salesPitchHook`, and `suggestedFixHtml` — are **informational technical indicators only** and **do not constitute legal advice, a formal EN 301 549 / VPAT / ACR compliance certification, or a guarantee against litigation or regulatory enforcement**.
>
> Automated accessibility scanners cannot evaluate every human-centric success criterion of WCAG 2.2, the European Accessibility Act (Directive (EU) 2019/882), or the Americans with Disabilities Act (ADA). Organizations seeking formal legal compliance should combine automated testing with manual assistive-technology testing (NVDA, JAWS, VoiceOver, keyboard-only navigation) and consult qualified legal counsel. When using audit findings for B2B outreach, always communicate transparently as a technical web/accessibility service provider and never impersonate regulatory authorities or legal counsel.
