# Clay.com Lead Enrichment Recipe & Cold Email Playbooks

Turn any **Clay.com** prospect table (Apollo, StoreLeads, BuiltWith, Google Maps, LinkedIn Sales Navigator) into a hyper-personalized **WCAG 2.2 / EAA / ADA Remediation Pipeline** in under 10 minutes — complete with **live violation counts**, **overlay widget detection (`accessiBe` / `UserWay`)**, **annotated red-box screenshots**, and **HTML code fixes**.

---

## 1. Cost-Smart Architecture: Single-Pass vs. Two-Pass Clay Funnel

Because this Actor uses **Apify Pay-Per-Event (PPE)** pricing, you have two ways to enrich leads in Clay:

| Strategy | How It Works in Clay | Cost per 1,000 Leads (Batched) | Cost per Lead (1-by-1 HTTP Row) | Best For |
| :--- | :--- | :---: | :---: | :--- |
| **Option A: Single-Pass Full Visual** | Run `includeVisualEvidence: true` on every qualified row | **$40.01** *(via Apify/n8n batch)* | **$0.05 / row** (`$0.01` start + `$0.04` full audit) | Curated lists of 50–500 high-ticket e-commerce or EU/US enterprise accounts |
| **Option B: Two-Pass Agency Funnel** | **Column 1:** `includeVisualEvidence: false` (`$0.035/row` or `$25.01/1k batch`)<br>**Column 2:** Conditional formula runs `includeVisualEvidence: true` **only** if `legalRiskScore >= 60 \|\| overlayDetected == true` | **~$33.02** | **$0.035** triage + **$0.05** only on top ~20% winners | High-volume outbound (1,000–10,000+ domains/month) |

> **Pro Tip for 1,000+ Lead Lists:** Triggering 1 URL per HTTP call charges `$0.01` `actor-start` per row (`$0.035–$0.05/row`). To save the `$0.01` per-row startup fee on massive lists, export your Clay URL column to our bundled **n8n batch workflow** (`n8n-eaa-lead-enrichment-workflow.json`) to scan 100 URLs per run for **$0.0251–$0.0401/URL**, then webhook results back into Clay!

---

## 2. Step-by-Step Clay "HTTP API" Column Setup

### Step 1: Add an HTTP API Enrichment Column
1. Open your Clay table containing a clean prospect URL column (e.g., `Website` or `Domain` formatted as `https://...`).
2. Click **Add Column** -> **Add Enrichment** -> search and select **HTTP API**.

### Step 2: Configure Method, Endpoint & Headers
- **Method**: `POST`
- **Endpoint**:
  ```text
  https://api.apify.com/v2/acts/<YOUR_USERNAME>~wcag-eaa-ada-auditor/run-sync-get-dataset-items?timeout=180
  ```
  *(Important: Use the tilde `~` between your Apify username and `wcag-eaa-ada-auditor` in REST API v2 URLs.)*

- **Headers**:
  | Header Key | Header Value |
  | :--- | :--- |
  | `Authorization` | `Bearer <YOUR_APIFY_API_TOKEN>` |
  | `Content-Type` | `application/json` |

### Step 3: Paste the JSON Body
In the **Body** box, paste the JSON below and replace `"/Website"` with Clay's dynamic `/` column token for your domain URL:

```json
{
  "urls": [
    "/Website"
  ],
  "wcagLevel": "AA",
  "includeVisualEvidence": true,
  "detectOverlays": true,
  "checkAccessibilityStatement": true,
  "respectRobotsTxt": true,
  "maxConcurrency": 1,
  "maxUrls": 1
}
```
*(Make sure `/Website` resolves inside double quotes so the rendered payload is `"urls": ["https://prospect-domain.com"]`.)*

### Step 4: Configure Rate Limits & Conditional Run Settings
1. Expand **Rate Limit** in the Clay HTTP API drawer:
   - **Request Limit**: `5` requests per `10` seconds (prevents hitting Apify Starter/Free plan concurrent container caps).
2. Expand **Run Settings -> Only run if**:
   ```javascript
   !!{{Website}} && !{{Website}}.includes("linkedin.com")
   ```
   *(If running **Pass 2** for annotated screenshots only on high-risk rows, set Pass 2's conditional formula to: `{{Legal Risk Score}} >= 60 || {{Overlay Detected}} == true`.)*

### Step 5: Map Output Fields to Clay Columns
Apify's `run-sync-get-dataset-items` returns a JSON array (`[ { ... } ]`). Click into item `[0]` in Clay's response viewer and click **Add as column** on these high-leverage fields:

| Recommended Clay Column Name | JSON Path in Response | Example Value |
| :--- | :--- | :--- |
| `Legal Risk Score` | `[0].legalRiskScore` | `86` |
| `Risk Tier` | `[0].riskTier` | `"CRITICAL"` |
| `Total Violations` | `[0].summary.totalViolations` | `7` |
| `Critical Blockers` | `[0].summary.criticalCount` | `2` |
| `Overlay Detected` | `[0].overlayDetection.overlayDetected` | `true` |
| `Overlay Vendor` | `[0].overlayDetection.overlayVendors[0]` | `"UserWay"` |
| `EAA Statement Found` | `[0].eaaCompliance.accessibilityStatementFound` | `false` |
| `Sales Pitch Hook` | `[0].salesPitchHook` | `"Noticed example.de uses the UserWay widget, yet..."` |
| `Visual Evidence URL` | `[0].visualEvidenceUrl` | `"https://api.apify.com/v2/key-value-stores/.../evidence.png"` |
| `Top Rule ID` | `[0].topViolations[0].ruleId` | `"button-name"` |
| `Before HTML` | `[0].topViolations[0].beforeHtml` | `"<button class=\"cart-toggle\"><svg></svg></button>"` |
| `Suggested Fix HTML` | `[0].topViolations[0].suggestedFixHtml` | `"<button class=\"cart-toggle\" aria-label=\"Open cart\">..."` |

---

## 3. Three High-Converting Cold Email Templates (Instantly / Smartlead Ready)

Route each prospect to the matching sequence based on your enriched Clay columns:
- **Sequence 1** if `{{Overlay Detected}} == true` *(Highest reply rate: 4%–9%)*
- **Sequence 2** if `{{EAA Statement Found}} == false` AND prospect sells into the EU (`.de`, `.fr`, `.nl`, `.es`, `.it`, `.eu`, `.ie`, `.se`, etc.)
- **Sequence 3** if `{{Risk Tier}} == "CRITICAL"` or `"HIGH"` (US e-commerce, Shopify, SaaS, healthcare, hospitality)

---

### Template 1: The Accessibility Overlay Replacement Play (`accessiBe` / `UserWay` / `AudioEye`)
**Why it converts:** The prospect is *already paying* `$490–$1,500+/yr` for an accessibility widget because they care about compliance — and you are showing undeniable DOM + visual proof that critical blockers remain exposed right underneath their widget.

**Subject Line Options:**
- `{{Overlay Vendor}} widget on {{Company Domain}} (+ {{Total Violations}} open WCAG 2.2 issues)`
- `Quick technical note on {{Company Name}}'s {{Overlay Vendor}} setup`

**Email Body:**
```text
Hi {{First Name}},

{{Sales Pitch Hook}}

Because browser-based WCAG 2.2 AA scanners (and screen readers) inspect the underlying DOM directly, third-party overlay scripts often leave core template elements unpatched — something both the US FTC and European accessibility regulators have flagged recently.

On {{Company Domain}}, the #1 unpatched blocker right now is `{{Top Rule ID}}`. Here is the annotated screenshot from our Chromium test showing the exact elements highlighted in red:
{{Visual Evidence URL}}

And here is the exact HTML/ARIA patch your developer can drop in to fix the primary element permanently in code:
{{Suggested Fix HTML}}

We help {{Industry}} teams replace annual overlay subscriptions with permanent, native WCAG 2.2 AA code fixes in under a week.

Open to me sending over the full {{Total Violations}}-item technical breakdown for your dev team — no strings attached?

Best,
{{Sender Name}}
{{Sender Title}}

---
P.S. This was an automated technical WCAG 2.2 check (not legal advice) — happy to share the raw report or opt you out anytime.
```

---

### Template 2: The European Accessibility Act (EAA) Missing Statement & WCAG 2.2 Play
**Why it converts:** Under the **European Accessibility Act (Directive (EU) 2019/882)**, covered e-commerce stores and digital service providers serving EU consumers must both meet technical accessibility standards (EN 301 549 / WCAG AA) *and* publish a clear **Accessibility Statement** explaining conformance and feedback channels. Missing that footer link is a 10-second verification any founder or marketing director can confirm immediately.

**Subject Line Options:**
- `Missing EAA accessibility statement on {{Company Domain}}?`
- `EU accessibility check for {{Company Name}} ({{Total Violations}} items spotted)`

**Email Body:**
```text
Hi {{First Name}},

While checking {{Company Domain}} against European Accessibility Act (EAA / EN 301 549) technical criteria, two quick things stood out:

1. No public Accessibility Statement link (e.g., "Accessibility Statement" / "Barrierefreiheitserklärung") was detected in your navigation or footer.
2. An automated WCAG 2.2 Level AA browser scan flagged {{Total Violations}} technical barriers ({{Critical Blockers}} critical), starting with `{{Top Rule ID}}`.

I captured a quick annotated screenshot highlighting the exact UI elements here so your team doesn't have to dig through DevTools:
{{Visual Evidence URL}}

For example, fixing the top element is a 2-line template change:
Before: {{Before HTML}}
Suggested fix: {{Suggested Fix HTML}}

Would it be useful if I sent you our EAA-ready Accessibility Statement template plus the full developer fix list for {{Company Domain}}?

Best regards,
{{Sender Name}}
{{Sender Title}}

---
Note: Findings are from an automated technical WCAG 2.2 scan for engineering reference only and do not constitute legal advice. Reply "stop" if not relevant.
```

---

### Template 3: The US ADA Checkout & Navigation Blocker Play (Shopify / E-Commerce / B2C)
**Why it converts:** Over 4,000 US ADA website lawsuits are filed annually — overwhelmingly targeting e-commerce stores with unlabeled form inputs, empty cart/search icon buttons (`button-name`), and low-contrast checkout text. Leading with a free code snippet + red-box screenshot proves instant engineering competence.

**Subject Line Options:**
- `{{Critical Blockers}} checkout/UI accessibility blockers on {{Company Domain}} (with fix)`
- `Screenshot: broken screen-reader button on {{Company Name}}'s site`

**Email Body:**
```text
Hi {{First Name}},

{{Sales Pitch Hook}}

Plaintiff scanners and screen readers (like VoiceOver/NVDA) rely on programmatic ARIA labels for cart drawers, search buttons, and email inputs. Here is an annotated screenshot of {{Company Domain}} pinpointing the {{Total Violations}} elements flagged in Chromium:
{{Visual Evidence URL}}

Your developer can fix the top issue (`{{Top Rule ID}}`) in ~2 minutes by updating:
{{Before HTML}}

To:
{{Suggested Fix HTML}}

We run rapid, fixed-fee WCAG 2.2 AA code sprints for {{Industry}} brands so your store stays clean for both assistive-tech shoppers and automated ADA scans.

Want me to send over the remaining {{Total Violations}} code snippets so your team has the complete checklist?

Best,
{{Sender Name}}
{{Sender Title}}

---
Automated technical WCAG 2.2 diagnostic for developer reference only (not legal advice). Let me know if I shouldn't follow up.
```

---

## 4. Ethical Outreach & Deliverability Checklist

1. **Lead with Engineering Value, Never Fear-Mongering:** Never claim to be a regulator, law firm, or compliance auditor issuing a fine. Frame every message around helping their engineering/ecommerce team ship cleaner, faster UX.
2. **Send Plain-Text Links First for Cold Inbox Placement:** In Email 1 on cold domains, paste `{{Visual Evidence URL}}` as a clean URL or link rather than embedding heavy `<img>` tags, or only embed inline images on warmed domains / follow-up Email 2 to protect primary inbox deliverability.
3. **Always Include Honest Scope Framing:** Automated scans catch ~40–57% of WCAG 2.2 criteria — positioning your agency to deliver **both** the immediate code remediation sprint *and* a manual keyboard/screen-reader QA pass naturally upsells your deal size from `$1,500` to `$5,000–$10,000+`.
