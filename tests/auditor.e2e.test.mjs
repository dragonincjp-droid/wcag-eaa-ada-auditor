import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

import { ApifyRuntimeAdapter } from '../dist/apifyRuntime.js';
import { runBatchAudit } from '../dist/auditor.js';
import { createBrowserAuditEngine } from '../dist/browser.js';
import { detectAccessibilityStatement, detectOverlayWidgets } from '../dist/detectors.js';
import { startStandbyServer } from '../dist/server.js';
import { classifyIpAddress, validateUrlAgainstSsrf } from '../dist/ssrf.js';

const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const BAD_ECOMMERCE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Acme Euro Fashion Store</title>
  <script src="/mock-vendor/acsbapp.com/apps/app/dist/js/app.js"></script>
</head>
<body style="font-family: Arial, sans-serif; padding: 24px; background: #ffffff; color: #111827;">
  <div class="hero">
    <h1>Summer Linen Collection</h1>
    <!-- Violation 1: Missing alt attribute on product image -->
    <img id="hero-banner-img" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIklEQVRo3u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAA4G8GQAAB0d7+8wAAAABJRU5ErkJggg==" width="160" height="90">

    <!-- Violation 2: Low contrast promotional subtext (~1.9:1 on #ffffff) -->
    <p id="promo-subtext" style="color: #b8b8b8; background-color: #ffffff; font-size: 14px;">
      Free express shipping across Germany and France on orders above 99 EUR
    </p>

    <!-- Violation 3: Unlabeled newsletter email input -->
    <form action="/subscribe" method="post" style="margin-top: 16px;">
      <input id="vip-email" type="email" placeholder="Enter your email for 15% off" style="padding: 8px; width: 240px;">
      <!-- Violation 4: Empty icon button without accessible name -->
      <button id="cart-icon-btn" class="cart-drawer-toggle" type="button" style="width: 40px; height: 40px;">
        <svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#111"/></svg>
      </button>
      <!-- Violation 5: WCAG 2.2 AA SC 2.5.8 undersized touch target (<24x24px) -->
      <button id="tiny-tooltip-btn" type="button" style="width: 16px; height: 16px; padding: 0; font-size: 10px;">?</button>
    </form>
  </div>

  <!-- Simulated accessiBe overlay widget trigger -->
  <div id="acsb-trigger" class="acsb-trigger" data-acsb="trigger" aria-hidden="true"></div>

  <footer style="margin-top: 48px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
    <a href="/privacy">Privacy Policy</a> |
    <a href="/terms">Terms of Service</a> |
    <!-- Fake overlay trigger link that must NOT count as an EAA Accessibility Statement -->
    <a href="#">Accessibility Menu</a>
  </footer>
</body>
</html>`;

const COMPLIANT_GERMAN_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Muster GmbH — Barrierefreie Digitale Dienste</title>
</head>
<body style="font-family: Arial, sans-serif; padding: 24px; background: #ffffff; color: #111827;">
  <header>
    <nav aria-label="Hauptnavigation">
      <a href="/produkte" style="color: #111827;">Produkte</a>
    </nav>
  </header>
  <main id="main-content">
    <h1>Willkommen bei Muster GmbH</h1>
    <p style="color: #1f2937; background-color: #ffffff; font-size: 16px;">
      Unsere Plattform erfüllt die Anforderungen der WCAG 2.2 Stufe AA und des BFSG (EAA).
    </p>
    <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIklEQVRo3u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAA4G8GQAAB0d7+8wAAAABJRU5ErkJggg==" alt="Muster GmbH Firmenlogo" width="64" height="64">
    <form action="/kontakt" method="post" style="margin-top: 16px;">
      <label for="work-email" style="color: #111827;">Geschäftliche E-Mail-Adresse</label>
      <input id="work-email" type="email" autocomplete="email" style="padding: 8px;">
      <button type="submit" style="min-width: 44px; min-height: 44px; padding: 10px 18px; background: #111827; color: #ffffff;">
        Anfrage absenden
      </button>
    </form>
  </main>
  <footer style="margin-top: 40px;">
    <a href="/impressum" style="color: #111827;">Impressum</a> |
    <a href="/barrierefreiheit" style="color: #111827;">Erklärung zur Barrierefreiheit</a>
  </footer>
</body>
</html>`;

describe('WCAG 2.2 / EAA & ADA Accessibility Legal Risk Auditor — Full Suite', () => {
  let fixtureServer;
  let baseUrl = '';
  let tempStorageDir = '';
  let previousStorageEnv;

  before(async () => {
    process.env.ALLOW_LOCALHOST_FOR_TESTS = '1';
    previousStorageEnv = process.env.APIFY_LOCAL_STORAGE_DIR;
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcag-auditor-test-storage-'));
    process.env.APIFY_LOCAL_STORAGE_DIR = tempStorageDir;

    fixtureServer = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];

      if (urlPath === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('User-agent: *\nDisallow: /private-portal\nAllow: /\n');
        return;
      }

      if (urlPath === '/mock-vendor/acsbapp.com/apps/app/dist/js/app.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end('window.acsbJS = { version: "3.2.0" };');
        return;
      }

      if (urlPath === '/bad-shop') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(BAD_ECOMMERCE_HTML);
        return;
      }

      if (urlPath === '/compliant-de') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(COMPLIANT_GERMAN_HTML);
        return;
      }

      if (urlPath === '/private-portal') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(COMPLIANT_GERMAN_HTML);
        return;
      }

      if (urlPath === '/redirect-imds') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    });

    await new Promise((resolve) => {
      fixtureServer.listen(0, '127.0.0.1', resolve);
    });
    const addr = fixtureServer.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (fixtureServer) {
      await new Promise((resolve) => fixtureServer.close(resolve));
    }
    if (previousStorageEnv === undefined) {
      delete process.env.APIFY_LOCAL_STORAGE_DIR;
    } else {
      process.env.APIFY_LOCAL_STORAGE_DIR = previousStorageEnv;
    }
    if (tempStorageDir) {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    }
  });

  it('1. SSRF Guard blocks localhost in production mode and blocks RFC1918/IMDS/IPv6/non-HTTP/DNS-rebinding always', async () => {
    // Production mode (`allowLocalhost: false`) must block loopback IPv4, IPv6, expanded IPv6, and IPv4-mapped IPv6
    for (const prodBlocked of [
      'http://localhost:3000/admin',
      'http://127.0.0.1:8080/health',
      'http://127.0.5.9/',
      'http://[::1]:4321/',
      'http://[0000:0000:0000:0000:0000:0000:0000:0001]:4321/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::127.0.0.1]/',
    ]) {
      const res = await validateUrlAgainstSsrf(prodBlocked, { allowLocalhost: false });
      assert.equal(res.allowed, false, `Expected production SSRF guard to block ${prodBlocked}`);
    }

    // Direct 128-bit normalized IPv6 classification checks for expanded/transition/special ranges
    for (const blockedIpv6 of [
      '0000:0000:0000:0000:0000:0000:0000:0001',
      '0:0:0:0:0:ffff:169.254.169.254',
      '::127.0.0.1',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b:1::a9fe:a9fe',
      '100::1',
      '2001::1',
      '2001:db8::1',
      '2002:a9fe:a9fe::1',
      'fc00::1',
      'fe80::1',
      'fec0::1',
      'ff02::1',
    ]) {
      const check = classifyIpAddress(blockedIpv6, false);
      assert.equal(check.allowed, false, `Expected classifyIpAddress to block ${blockedIpv6}`);
    }

    // Even when allowLocalhost=true, all private networks, cloud metadata, IPv6 transition ranges, and non-HTTP schemes are strictly blocked
    for (const alwaysBlocked of [
      'http://10.0.0.1/secret',
      'http://172.16.0.10/internal',
      'http://172.31.255.255/internal',
      'http://192.168.1.1/router',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
      'http://[0:0:0:0:0:ffff:169.254.169.254]/latest/meta-data/',
      'http://[64:ff9b::a9fe:a9fe]/',
      'http://[2002:a9fe:a9fe::1]/',
      'http://[fec0::1]/',
      'http://[fc00::1]/',
      'http://[fe80::1]/',
      'file:///etc/passwd',
      'ftp://93.184.216.34/pub',
      'javascript:alert(1)',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://admin:secret@93.184.216.34/',
    ]) {
      const res = await validateUrlAgainstSsrf(alwaysBlocked, { allowLocalhost: true });
      assert.equal(res.allowed, false, `Expected SSRF guard to block ${alwaysBlocked}`);
    }

    // DNS rebinding check: public hostname resolving to internal IP or expanded IPv6 IMDS must be rejected
    const rebindCheck = await validateUrlAgainstSsrf('https://rebind-attacker.example.com/landing', {
      allowLocalhost: true,
      dnsLookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '0:0:0:0:0:ffff:169.254.169.254', family: 6 },
      ],
    });
    assert.equal(rebindCheck.allowed, false);

    // Public IPv4 and global unicast IPv6 pass
    assert.equal(classifyIpAddress('93.184.216.34', false).allowed, true);
    assert.equal(classifyIpAddress('2606:4700:4700::1111', false).allowed, true);
    assert.equal(classifyIpAddress('2001:4860:4860::8888', false).allowed, true);
  });

  it('2. Detectors deterministically identify 9+ overlay vendors and 6+ EU language Accessibility Statements', () => {
    const multiOverlay = detectOverlayWidgets(
      {
        scriptUrls: [
          'https://cdn.userway.org/widget.js',
          'https://wsvcdn.audioeye.com/aem.js',
          'https://cdn.equalweb.com/core/4.4.0/accessibility.js',
          'https://api.reciteme.com/asset/js',
          'https://app-script.monsido.com/v2/monsido-script.js',
          'https://cdn.maxaccess.io/accessibility.js',
          'https://fecdn.user1st.info/Loader/head',
          'https://ws.facil-iti.com/tag/faciliti-tag.min.js',
        ],
        inlineScriptSnippets: ['acsbJS.init({ accountId: "demo" });'],
        stylesheetUrls: [],
        domIdsAndClasses: ['#acsb-trigger'],
        dataAttributes: [],
        globalWindowKeys: ['acsbJS'],
        anchors: [],
        htmlLang: 'en',
      },
      3,
    );

    assert.equal(multiOverlay.overlayDetected, true);
    for (const expectedVendor of [
      'accessiBe',
      'UserWay',
      'AudioEye',
      'EqualWeb',
      'Recite Me',
      'Monsido',
      'MaxAccess',
      'User1st',
      "Facil'iti",
    ]) {
      assert.ok(
        multiOverlay.overlayVendors.includes(expectedVendor),
        `Expected vendor ${expectedVendor} to be detected`,
      );
    }

    const euSamples = [
      { lang: 'en', href: '/accessibility-statement', text: 'Accessibility Statement' },
      { lang: 'de', href: '/barrierefreiheit', text: 'Erklärung zur Barrierefreiheit' },
      { lang: 'fr', href: '/declaration-accessibilite', text: "Déclaration d'accessibilité" },
      { lang: 'es', href: '/accesibilidad', text: 'Declaración de accesibilidad' },
      { lang: 'it', href: '/dichiarazione-di-accessibilita', text: 'Dichiarazione di accessibilità' },
      { lang: 'nl', href: '/toegankelijkheidsverklaring', text: 'Toegankelijkheidsverklaring' },
    ];

    for (const sample of euSamples) {
      const eaa = detectAccessibilityStatement(
        [
          {
            href: sample.href,
            resolvedHref: `https://shop.example.eu${sample.href}`,
            text: sample.text,
            ariaLabel: '',
            title: '',
            inFooter: true,
            inNav: false,
          },
        ],
        'https://shop.example.eu/',
      );
      assert.equal(eaa.accessibilityStatementFound, true, `Failed EAA statement detection for ${sample.lang}`);
      assert.equal(eaa.detectedLanguage, sample.lang);
      assert.equal(eaa.statementUrl, `https://shop.example.eu${sample.href}`);
    }
  });

  it('3. Real Headless Chrome E2E: audits non-compliant accessiBe page, generates red-box PNG evidence, HTML diffs & salesPitchHook, and blocks robots.txt / SSRF', async () => {
    const runtime = new ApifyRuntimeAdapter();
    const result = await runBatchAudit(
      {
        urls: [
          `${baseUrl}/bad-shop`,
          `${baseUrl}/compliant-de`,
          `${baseUrl}/private-portal`,
          'http://169.254.169.254/latest/meta-data/',
          `${baseUrl}/redirect-imds`,
        ],
        wcagLevel: 'AA',
        includeVisualEvidence: true,
        detectOverlays: true,
        checkAccessibilityStatement: true,
        respectRobotsTxt: true,
        domainDelayMs: 50,
        maxConcurrency: 2,
      },
      { runtime },
    );

    assert.equal(result.items.length, 5);

    // [0] Non-compliant shop with accessiBe + WCAG violations + missing EAA statement
    const badShop = result.items[0];
    assert.equal(badShop.status, 'audited');
    assert.equal(badShop.httpStatus, 200);
    assert.equal(badShop.overlayDetected, true);
    assert.ok(badShop.overlayVendors.includes('accessiBe'), 'Should detect accessiBe widget');
    assert.equal(badShop.accessibilityStatementFound, false);
    assert.equal(badShop.eaaCompliance.accessibilityStatementFound, false);
    assert.ok(badShop.summary.totalViolations >= 4, `Expected >=4 violations, got ${badShop.summary.totalViolations}`);
    assert.ok(badShop.summary.criticalCount >= 2, `Expected >=2 critical rules, got ${badShop.summary.criticalCount}`);
    assert.ok(badShop.legalRiskScore >= 75, `Expected score >=75, got ${badShop.legalRiskScore}`);
    assert.equal(badShop.riskTier, 'CRITICAL');

    // Verify Before/After HTML Remediation Diffs & Cold Outreach Hook
    assert.ok(badShop.topViolations.length >= 4);
    for (const v of badShop.topViolations) {
      assert.ok(v.beforeHtml.length > 0);
      assert.ok(v.afterHtml.length > 0);
      assert.equal(v.suggestedFixHtml, v.afterHtml);
      assert.match(v.unifiedDiff, /^@@ -1 \+1 @@/);
    }
    assert.match(badShop.salesPitchHook, /accessiBe/);
    assert.match(badShop.salesPitchHook, /EAA Accessibility Statement/i);
    assert.ok(badShop.disclaimer.includes('not constitute legal advice'));

    // Verify Annotated Red-Box PNG Visual Evidence saved in Key-Value Store
    assert.equal(badShop.visualEvidence.generated, true);
    assert.ok(badShop.visualEvidenceKey?.endsWith('.png'));
    assert.ok(badShop.visualEvidenceUrl);
    assert.ok(badShop.visualEvidence.highlightedCount >= 3);

    const pngPath = path.join(tempStorageDir, 'key_value_stores', 'default', badShop.visualEvidenceKey);
    assert.equal(fs.existsSync(pngPath), true, 'Annotated PNG file must exist in Key-Value Store');
    const pngBytes = fs.readFileSync(pngPath);
    assert.ok(pngBytes.byteLength > 5_000, `Expected non-trivial PNG (>5KB), got ${pngBytes.byteLength} bytes`);
    assert.deepEqual(pngBytes.subarray(0, 8), PNG_MAGIC_BYTES, 'PNG file must have valid PNG magic signature');
    const pngWidth = pngBytes.readUInt32BE(16);
    assert.equal(pngWidth, 1440, 'Viewport PNG width should be 1440px');

    // [1] Compliant German page with Barrierefreiheit statement and zero overlays
    const compliantDe = result.items[1];
    assert.equal(compliantDe.status, 'audited');
    assert.equal(compliantDe.overlayDetected, false);
    assert.equal(compliantDe.accessibilityStatementFound, true);
    assert.equal(compliantDe.eaaCompliance.detectedLanguage, 'de');
    assert.ok(compliantDe.accessibilityStatementUrl?.endsWith('/barrierefreiheit'));
    assert.equal(compliantDe.summary.criticalCount, 0);
    assert.equal(compliantDe.riskTier, 'LOW');

    // [2] Disallowed by /robots.txt
    const blockedRobots = result.items[2];
    assert.equal(blockedRobots.status, 'blocked_robots');
    assert.match(blockedRobots.errorMessage || '', /robots\.txt/i);

    // [3] Direct AWS IMDS SSRF blocked pre-flight
    const blockedImds = result.items[3];
    assert.equal(blockedImds.status, 'blocked_ssrf');
    assert.ok(blockedImds.disclaimer.length > 20);

    // [4] HTTP 302 redirect to AWS IMDS blocked mid-flight by browser SSRF interceptor
    const redirectImds = result.items[4];
    assert.ok(
      redirectImds.status === 'blocked_ssrf' || redirectImds.status === 'error',
      `Redirect to IMDS must never succeed as audited (got ${redirectImds.status})`,
    );

    // Verify PPE billing counts (only the 2 audited URLs are billed, never blocked/error URLs)
    assert.equal(result.billing.chargedCounts['actor-start'], 1);
    assert.equal(result.billing.chargedCounts['url-audited'], 2);
    assert.equal(result.billing.chargedCounts['visual-evidence-generated'], 2);
    assert.equal(result.billing.estimatedTotalUsd, 0.09);
  });

  it('4. Pay-Per-Event Budget Ceiling Circuit Breaker stops batch cleanly when maxTotalChargeUsd is reached', async () => {
    const runtime = new ApifyRuntimeAdapter();
    // $0.05 exact budget = $0.01 actor-start + $0.025 url-audited + $0.015 visual-evidence-generated (exactly 1 URL!)
    const cappedRun = await runBatchAudit(
      {
        urls: [
          `${baseUrl}/bad-shop`,
          `${baseUrl}/compliant-de`,
          `${baseUrl}/bad-shop?page=2`,
        ],
        includeVisualEvidence: true,
        maxTotalChargeUsd: 0.05,
        maxConcurrency: 1,
        domainDelayMs: 0,
      },
      { runtime },
    );

    assert.equal(cappedRun.items.length, 1, 'Should stop cleanly after 1st URL hits $0.05 budget ceiling');
    assert.equal(cappedRun.stoppedDueToBudgetCap, true);
    assert.ok(cappedRun.billing.estimatedTotalUsd <= 0.05 + 1e-6);
  });

  it('5. Standby HTTP & Streamable HTTP MCP Server: GET /health, POST /scan, and POST /mcp JSON-RPC (initialize, tools/list, tools/call)', async () => {
    const standby = await startStandbyServer({ port: 0, host: '127.0.0.1' });
    const standbyBase = `http://127.0.0.1:${standby.port}`;

    try {
      // 5a. GET /health + Apify Standby readiness probe
      const healthRes = await fetch(`${standbyBase}/health`, {
        headers: { 'x-apify-container-server-readiness-probe': '1' },
      });
      assert.equal(healthRes.status, 200);
      const healthBody = await healthRes.json();
      assert.equal(healthBody.status, 'ok');
      assert.equal(healthBody.endpoints.mcp, '/mcp');

      // 5b. POST /scan synchronous REST endpoint
      const scanRes = await fetch(`${standbyBase}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `${baseUrl}/bad-shop`,
          includeVisualEvidence: false,
          domainDelayMs: 0,
        }),
      });
      assert.equal(scanRes.status, 200);
      const scanBody = await scanRes.json();
      assert.equal(scanBody.count, 1);
      assert.equal(scanBody.items[0].overlayDetected, true);
      assert.ok(scanBody.items[0].overlayVendors.includes('accessiBe'));

      // 5c. POST /mcp — initialize
      const initRes = await fetch(`${standbyBase}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-mcp-client', version: '1.0.0' },
          },
        }),
      });
      assert.equal(initRes.status, 200);
      const initRpc = await initRes.json();
      assert.equal(initRpc.jsonrpc, '2.0');
      assert.equal(initRpc.id, 1);
      assert.equal(initRpc.result.serverInfo.name, 'wcag-eaa-ada-auditor');
      assert.ok(initRpc.result.capabilities.tools);

      // 5d. POST /mcp — notifications/initialized (no id -> 202 Accepted)
      const notifRes = await fetch(`${standbyBase}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
      assert.equal(notifRes.status, 202);

      // 5e. POST /mcp — tools/list
      const listRes = await fetch(`${standbyBase}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }),
      });
      assert.equal(listRes.status, 200);
      const listRpc = await listRes.json();
      const toolNames = listRpc.result.tools.map((t) => t.name);
      assert.deepEqual(toolNames, ['audit_website_accessibility']);

      // 5f. POST /mcp — tools/call (audit_website_accessibility on /bad-shop with visual evidence)
      const callRes = await fetch(`${standbyBase}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'audit_website_accessibility',
            arguments: {
              url: `${baseUrl}/bad-shop`,
              wcagLevel: 'AA',
              includeVisualEvidence: true,
              domainDelayMs: 0,
            },
          },
        }),
      });
      assert.equal(callRes.status, 200);
      const callRpc = await callRes.json();
      assert.equal(callRpc.result.isError, false);
      const mcpReport = JSON.parse(callRpc.result.content[0].text);
      assert.equal(mcpReport.status, 'audited');
      assert.equal(mcpReport.overlayDetected, true);
      assert.ok(mcpReport.overlayVendors.includes('accessiBe'));
      assert.equal(mcpReport.visualEvidence.generated, true);
      assert.ok(mcpReport.disclaimer.includes('not constitute legal advice'));

      // 5g. POST /mcp — tools/call SSRF rejection test
      const ssrfCallRes = await fetch(`${standbyBase}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'audit_website_accessibility',
            arguments: {
              url: 'http://10.255.0.1/internal-admin',
            },
          },
        }),
      });
      assert.equal(ssrfCallRes.status, 200);
      const ssrfRpc = await ssrfCallRes.json();
      assert.equal(ssrfRpc.result.isError, true);
      const ssrfReport = JSON.parse(ssrfRpc.result.content[0].text);
      assert.equal(ssrfReport.status, 'blocked_ssrf');
    } finally {
      await standby.close();
    }
  });

  it('6. Production CLI Entrypoint (node dist/main.js) reads INPUT.json and writes Dataset + KVS PNG artifacts', async () => {
    const cliStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'wcag-cli-run-'));
    try {
      const kvsDefault = path.join(cliStorage, 'key_value_stores', 'default');
      fs.mkdirSync(kvsDefault, { recursive: true });
      fs.writeFileSync(
        path.join(kvsDefault, 'INPUT.json'),
        JSON.stringify({
          urls: [`${baseUrl}/bad-shop`],
          includeVisualEvidence: true,
          domainDelayMs: 0,
        }),
        'utf8',
      );

      const { stdout } = await execFileAsync(process.execPath, ['dist/main.js'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ALLOW_LOCALHOST_FOR_TESTS: '1',
          APIFY_LOCAL_STORAGE_DIR: cliStorage,
        },
        timeout: 30_000,
      });

      assert.match(stdout, /Completed batch audit/);

      const datasetDir = path.join(cliStorage, 'datasets', 'default');
      const datasetFiles = fs.readdirSync(datasetDir).filter((f) => f.endsWith('.json'));
      assert.equal(datasetFiles.length, 1);

      const datasetItem = JSON.parse(
        fs.readFileSync(path.join(datasetDir, datasetFiles[0]), 'utf8'),
      );
      assert.equal(datasetItem.status, 'audited');
      assert.equal(datasetItem.overlayDetected, true);
      assert.ok(datasetItem.visualEvidenceKey);
      assert.equal(
        fs.existsSync(path.join(kvsDefault, datasetItem.visualEvidenceKey)),
        true,
      );
    } finally {
      fs.rmSync(cliStorage, { recursive: true, force: true });
    }
  });

  it('7. BrowserAuditEngine.isHealthy() tracks live browser health and transitions to false after close()', async () => {
    const engine = await createBrowserAuditEngine();
    try {
      assert.equal(engine.isHealthy(), true, 'Engine should report healthy immediately after launch');
    } finally {
      await engine.close();
    }
    assert.equal(engine.isHealthy(), false, 'Engine should report unhealthy after close()');
  });
});
