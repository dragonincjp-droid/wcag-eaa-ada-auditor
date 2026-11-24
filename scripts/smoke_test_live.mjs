#!/usr/bin/env node
/**
 * Live Production Health & Cost-Cap Smoke Test (`scripts/smoke_test_live.mjs`)
 *
 * - Executes the deployed Apify Actor against 1 safe URL (`https://example.com`)
 *   with a strict `maxTotalChargeUsd: 0.10` circuit breaker.
 * - Verifies HTTP status, SUCCEEDED run state, post-run billed USD <= $0.10,
 *   non-empty dataset output, and schema/semantic integrity.
 * - Automatically aborts the Actor run if wall-clock timeout (150s) is exceeded.
 * - Zero external npm dependencies (Node.js 22+ standard `fetch` & `node:*`).
 *
 * Usage:
 *   node scripts/smoke_test_live.mjs --dry-run
 *   APIFY_TOKEN=xxx node scripts/smoke_test_live.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const APIFY_API_BASE = 'https://api.apify.com/v2';
const DEFAULT_ACTOR_NAME = 'wcag-eaa-ada-auditor';
const DEFAULT_TARGET_URL = 'https://example.com';
const HARD_MAX_CHARGE_USD = 0.10;
const RUN_TIMEOUT_SECS = 120;
const RUN_MEMORY_MB = 1024;
const MAX_WALL_WAIT_MS = 150_000;

const PPE_EVENT_PRICES_USD = {
  'actor-start': 0.01,
  'url-audited': 0.025,
  'visual-evidence-generated': 0.015,
};

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

function parseCliArgs(argv) {
  const opts = {
    dryRun: false,
    targetUrl: DEFAULT_TARGET_URL,
    maxChargeUsd: HARD_MAX_CHARGE_USD,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-d') {
      opts.dryRun = true;
    } else if (arg.startsWith('--url=')) {
      opts.targetUrl = arg.slice('--url='.length).trim();
    } else if (arg.startsWith('--max-charge=')) {
      const val = Number(arg.slice('--max-charge='.length));
      if (!Number.isNaN(val) && val > 0 && val <= 0.25) {
        opts.maxChargeUsd = val;
      }
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/smoke_test_live.mjs [options]

Options:
  --dry-run, -d            Validate input construction, $0.10 cap config, and schema checks offline
  --url=<https://...>      Single URL to audit (default: https://example.com)
  --max-charge=<usd>       Safety charge ceiling in USD (default: 0.10, hard max: 0.25)
  --help, -h               Show help

Environment Variables:
  APIFY_TOKEN              Apify Personal API Token (required unless --dry-run)
  APIFY_ACTOR_ID           Optional Actor ID or "username~actor-name" (auto-resolved if omitted)
`);
}

function readJsonIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    // Ignore malformed or missing optional file
  }
  return null;
}

function readLocalActorName() {
  const actorJson = readJsonIfExists(path.join(PROJECT_ROOT, '.actor', 'actor.json'));
  if (typeof actorJson?.name === 'string' && actorJson.name.trim()) {
    return actorJson.name.trim();
  }
  return DEFAULT_ACTOR_NAME;
}

/**
 * Builds a minimal 1-URL input payload matching `.actor/input_schema.json` if present,
 * ensuring compatibility even when `additionalProperties: false` is set.
 */
function buildSmokeInputPayload(targetUrl) {
  const inputSchema = readJsonIfExists(path.join(PROJECT_ROOT, '.actor', 'input_schema.json'));
  const props = inputSchema?.properties;

  if (props && typeof props === 'object') {
    const payload = {};

    if (props.urls) {
      const itemType = props.urls?.items?.type;
      payload.urls = itemType === 'object' ? [{ url: targetUrl }] : [targetUrl];
    } else if (props.startUrls) {
      const itemType = props.startUrls?.items?.type;
      payload.startUrls = itemType === 'string' ? [targetUrl] : [{ url: targetUrl }];
    } else if (props.url) {
      payload.url = targetUrl;
    }

    if (props.maxUrls && typeof payload.maxUrls === 'undefined') {
      payload.maxUrls = 1;
    }
    if (props.includeVisualEvidence && typeof payload.includeVisualEvidence === 'undefined') {
      payload.includeVisualEvidence = false;
    }
    if (props.maxPagesPerDomain && typeof payload.maxPagesPerDomain === 'undefined') {
      payload.maxPagesPerDomain = 1;
    }
    if (props.maxCrawlPages && typeof payload.maxCrawlPages === 'undefined') {
      payload.maxCrawlPages = 1;
    }

    if (Object.keys(payload).length > 0) {
      return { payload, schemaDetected: true };
    }
  }

  return {
    payload: {
      urls: [targetUrl],
      includeVisualEvidence: false,
      maxUrls: 1,
    },
    schemaDetected: false,
  };
}

function loadLocalItemSchema() {
  const candidates = [
    path.join(PROJECT_ROOT, '.actor', 'dataset_schema.json'),
    path.join(PROJECT_ROOT, '.actor', 'output_schema.json'),
  ];

  for (const filePath of candidates) {
    const data = readJsonIfExists(filePath);
    if (!data || typeof data !== 'object') continue;
    // Apify dataset_schema.json may nest item schema under `fields` (`fields.properties` / `fields.required`)
    if (data.fields && typeof data.fields === 'object' && data.fields.properties) {
      return { source: path.basename(filePath), schema: data.fields };
    }
    if (data.items && typeof data.items === 'object' && data.items.properties) {
      return { source: path.basename(filePath), schema: data.items };
    }
    if (data.properties && typeof data.properties === 'object') {
      return { source: path.basename(filePath), schema: data };
    }
  }
  return null;
}

function matchesJsonType(value, expectedType) {
  const types = Array.isArray(expectedType) ? expectedType : [expectedType];
  return types.some((t) => {
    if (t === 'null') return value === null;
    if (t === 'array') return Array.isArray(value);
    if (t === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (t === 'number') return typeof value === 'number' && !Number.isNaN(value);
    if (t === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    if (t === 'string' || t === 'boolean') return typeof value === t;
    return true;
  });
}

function validateAuditDatasetItems(items, expectedTargetUrl) {
  const errors = [];
  const checks = [];

  if (!Array.isArray(items) || items.length === 0) {
    errors.push('Dataset items array is empty (expected at least 1 audit result item).');
    return { valid: false, errors, checks };
  }
  checks.push(`Dataset item count = ${items.length} (>= 1)`);

  const first = items[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) {
    errors.push('First dataset item is not a JSON object.');
    return { valid: false, errors, checks };
  }

  // 1. Check against local .actor dataset/output JSON schema if available
  const localSchemaInfo = loadLocalItemSchema();
  if (localSchemaInfo) {
    const { source, schema } = localSchemaInfo;
    const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
    for (const reqKey of requiredKeys) {
      if (!(reqKey in first) || typeof first[reqKey] === 'undefined') {
        errors.push(`Missing required schema property "${reqKey}" defined in ${source}.`);
      }
    }
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [propKey, propDef] of Object.entries(schema.properties)) {
        if (propKey in first && typeof first[propKey] !== 'undefined' && propDef?.type) {
          if (!matchesJsonType(first[propKey], propDef.type)) {
            errors.push(
              `Property "${propKey}" failed type check from ${source}: expected ${JSON.stringify(propDef.type)}, got ${typeof first[propKey]}.`
            );
          }
        }
      }
    }
    checks.push(`Validated against local schema (.actor/${source})`);
  }

  // 2. Semantic WCAG / EAA / ADA audit structure checks
  const urlCandidate =
    first.url ?? first.targetUrl ?? first.auditedUrl ?? first.finalUrl ?? first.pageUrl;
  if (typeof urlCandidate !== 'string' || !urlCandidate.trim()) {
    errors.push('Audit item missing URL string property (url / targetUrl / auditedUrl / finalUrl).');
  } else {
    try {
      const expectedHost = new URL(expectedTargetUrl).hostname.replace(/^www\./, '');
      const actualHost = new URL(urlCandidate).hostname.replace(/^www\./, '');
      if (actualHost !== expectedHost) {
        errors.push(`Audited URL hostname "${actualHost}" does not match target "${expectedHost}".`);
      } else {
        checks.push(`Audited URL verified (${urlCandidate})`);
      }
    } catch {
      errors.push(`Audited URL "${urlCandidate}" is not a valid URL.`);
    }
  }

  if (first.status === 'error') {
    errors.push(`Audit item reported status="error" (${first.errorMessage || 'audit failed on target URL'}).`);
  }

  const auditSignalKeys = [
    'legalRiskScore',
    'riskTier',
    'riskScore',
    'legalRiskLevel',
    'riskLevel',
    'score',
    'topViolations',
    'violations',
    'wcagViolations',
    'violationCount',
    'totalViolations',
    'issues',
    'summary',
    'eaaCompliance',
    'overlayDetection',
    'overlayDetected',
    'salesPitchHook',
    'accessibilityStatement',
    'accessibilityStatementFound',
    'disclaimer',
  ];
  const matchedSignals = auditSignalKeys.filter((k) => k in first && typeof first[k] !== 'undefined');
  if (matchedSignals.length === 0) {
    errors.push(
      `Audit item does not contain any recognized WCAG/EAA/ADA audit fields (checked: ${auditSignalKeys.slice(0, 6).join(', ')}, ...).`
    );
  } else {
    checks.push(`Recognized audit fields present: ${matchedSignals.join(', ')}`);
  }

  if (Array.isArray(first.topViolations) && first.topViolations.length > 0) {
    const v0 = first.topViolations[0];
    if (typeof v0?.ruleId !== 'string' || !Array.isArray(v0?.wcagCriteria)) {
      errors.push('topViolations[0] is missing required ViolationRemediationItem fields (ruleId: string, wcagCriteria: string[]).');
    } else {
      checks.push(`topViolations[0] schema verified (ruleId="${v0.ruleId}", wcagCriteria=${JSON.stringify(v0.wcagCriteria)})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    checks,
  };
}

function calculateRunChargeUsd(runData) {
  if (typeof runData?.usageTotalUsd === 'number' && runData.usageTotalUsd > 0) {
    return runData.usageTotalUsd;
  }
  let ppeSum = 0;
  const counts = runData?.chargedEventCounts;
  if (counts && typeof counts === 'object') {
    for (const [key, val] of Object.entries(counts)) {
      const count = Number(val) || 0;
      const unit = PPE_EVENT_PRICES_USD[key] ?? 0;
      ppeSum += count * unit;
    }
  }
  return ppeSum;
}

async function apifyRequest(method, endpointPath, token, bodyObj = undefined) {
  const url = `${APIFY_API_BASE}${endpointPath}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  let body;
  if (bodyObj !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(bodyObj);
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(75_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Apify API ${method} ${endpointPath} failed (${response.status}): ${text.slice(0, 350)}`);
  }
  return response.json();
}

async function resolveActorId(token) {
  const explicit = process.env.APIFY_ACTOR_ID?.trim();
  if (explicit) {
    return explicit.replace('/', '~');
  }
  const localName = readLocalActorName();
  const me = await apifyRequest('GET', '/users/me', token);
  const username = me?.data?.username;
  if (username) {
    const candidate = `${username}~${localName}`;
    try {
      await apifyRequest('GET', `/acts/${encodeURIComponent(candidate)}`, token);
      return candidate;
    } catch {
      // Fallback to listing user's actors
    }
  }
  const acts = await apifyRequest('GET', '/acts?my=true&limit=100', token);
  const items = acts?.data?.items || [];
  const found =
    items.find((a) => a.name === localName) ||
    items.find((a) => /wcag|eaa|ada|accessibility/i.test(a.name || a.title || ''));
  if (found?.id) {
    return found.id;
  }
  throw new Error(
    `Apify Actor が見つかりません（探索名: ${localName}）。先に apify push を実行するか APIFY_ACTOR_ID を設定してください。`
  );
}

function appendStepSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, `${markdown}\n`, 'utf8');
  }
}

function sampleValueForSchemaDef(propDef, targetUrl, propKey) {
  if (/url/i.test(propKey)) return targetUrl;
  const types = Array.isArray(propDef?.type) ? propDef.type : [propDef?.type];
  const primary = types.find((t) => t && t !== 'null') || 'string';
  if (primary === 'boolean') return false;
  if (primary === 'integer' || primary === 'number') return 1;
  if (primary === 'array') return [];
  if (primary === 'object') return {};
  return 'sample';
}

async function runDryRun(opts) {
  const actorName = readLocalActorName();
  const { payload, schemaDetected } = buildSmokeInputPayload(opts.targetUrl);
  const endpointPreview = `${APIFY_API_BASE}/acts/<username~${actorName}>/runs?waitForFinish=60&maxTotalChargeUsd=${opts.maxChargeUsd.toFixed(2)}&timeout=${RUN_TIMEOUT_SECS}&memory=${RUN_MEMORY_MB}`;

  const mockRun = {
    id: 'dryrun_smoke_001',
    status: 'SUCCEEDED',
    defaultDatasetId: 'dryrun_dataset_001',
    chargedEventCounts: {
      'actor-start': 1,
      'url-audited': 1,
    },
  };

  // Build mock output matching AuditReportItem & ViolationRemediationItem schema (src/types.ts & .actor/dataset_schema.json)
  const mockAuditItem = {
    url: opts.targetUrl,
    finalUrl: `${opts.targetUrl.replace(/\/$/, '')}/`,
    domain: new URL(opts.targetUrl).hostname,
    auditedAt: new Date().toISOString(),
    status: 'audited',
    httpStatus: 200,
    pageTitle: 'Example Domain',
    loadTimeMs: 412,
    legalRiskScore: 35,
    riskTier: 'MEDIUM',
    summary: {
      totalViolations: 1,
      totalAffectedNodes: 1,
      criticalCount: 0,
      seriousCount: 0,
      moderateCount: 1,
      minorCount: 0,
      passedChecksCount: 18,
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
      detectedLanguage: 'en',
      location: null,
      missingStatementRisk: 'MEDIUM — No Accessibility Statement link detected on the page.',
    },
    salesPitchHook: 'Automated WCAG 2.2 AA scan flagged 1 moderate landmark issue and a missing EAA statement.',
    visualEvidenceKey: null,
    visualEvidenceUrl: null,
    visualEvidence: {
      generated: false,
      key: null,
      url: null,
      highlightedCount: 0,
      byteLength: 0,
    },
    topViolations: [
      {
        badgeNumber: 1,
        ruleId: 'landmark-one-main',
        impact: 'moderate',
        wcagCriteria: ['wcag2a'],
        description: 'Document should have one main landmark',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/landmark-one-main',
        affectedNodesCount: 1,
        targetSelectors: ['html'],
        beforeHtml: '<body><div><h1>Example Domain</h1></div></body>',
        afterHtml: '<body><main><h1>Example Domain</h1></main></body>',
        suggestedFixHtml: '<body><main><h1>Example Domain</h1></main></body>',
        unifiedDiff:
          '- <body><div><h1>Example Domain</h1></div></body>\n+ <body><main><h1>Example Domain</h1></main></body>',
      },
    ],
    disclaimer:
      'Automated technical WCAG 2.2 Level A/AA inspection result powered by axe-core and deterministic DOM heuristics. Automated scans identify technical code barriers (~40-57% of WCAG criteria) and do not constitute legal advice or a formal guarantee of regulatory compliance under the European Accessibility Act (EAA), US ADA, or Section 508.',
  };

  const localSchemaInfo = loadLocalItemSchema();
  if (localSchemaInfo?.schema?.properties) {
    for (const [propKey, propDef] of Object.entries(localSchemaInfo.schema.properties)) {
      if (!(propKey in mockAuditItem)) {
        mockAuditItem[propKey] = sampleValueForSchemaDef(propDef, opts.targetUrl, propKey);
      }
    }
  }

  const validation = validateAuditDatasetItems([mockAuditItem], opts.targetUrl);
  const simulatedChargeUsd = calculateRunChargeUsd(mockRun);
  const withinBudget = simulatedChargeUsd <= opts.maxChargeUsd;

  console.log('============================================================');
  console.log('🧪 [DRY-RUN] 本番死活＆コスト上限スモークテスト検証');
  console.log('============================================================');
  console.log(`• 対象URL             : ${opts.targetUrl} (1 URL安全制限)`);
  console.log(`• コスト上限ガード    : maxTotalChargeUsd = $${opts.maxChargeUsd.toFixed(2)}`);
  console.log(`• 想定APIエンドポイント: POST ${endpointPreview}`);
  console.log(`• 入力スキーマ自動検出: ${schemaDetected ? '検出済 (.actor/input_schema.json)' : '標準互換ペイロード使用'}`);
  console.log(`• 送信ペイロード      : ${JSON.stringify(payload)}`);
  console.log(`• 試算PPE課金額       : $${simulatedChargeUsd.toFixed(3)} <= 上限 $${opts.maxChargeUsd.toFixed(2)} (${withinBudget ? 'OK ✅' : 'NG ❌'})`);
  for (const check of validation.checks) {
    console.log(`• スキーマ検証        : ${check} ✅`);
  }

  if (!withinBudget || !validation.valid) {
    console.error('❌ Dry-run 検証エラー:', validation.errors.join(' | '));
    process.exitCode = 1;
    return;
  }

  console.log('✅ [PASS] スモークテスト Dry-Run 全項目クリア（エラー 0 件）');
}

async function runLiveSmokeTest(opts, token) {
  const parsedUrl = new URL(opts.targetUrl);
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error(`Invalid target URL protocol: ${parsedUrl.protocol}`);
  }

  const actorId = await resolveActorId(token);
  const { payload } = buildSmokeInputPayload(opts.targetUrl);

  const query = new URLSearchParams({
    waitForFinish: '60',
    maxTotalChargeUsd: opts.maxChargeUsd.toFixed(2),
    timeout: String(RUN_TIMEOUT_SECS),
    memory: String(RUN_MEMORY_MB),
  });

  console.log(`[smoke_test] Starting live run for ${actorId} -> ${opts.targetUrl} (cap: $${opts.maxChargeUsd.toFixed(2)})...`);
  const startTime = Date.now();
  const startResp = await apifyRequest(
    'POST',
    `/acts/${encodeURIComponent(actorId)}/runs?${query.toString()}`,
    token,
    payload
  );

  let run = startResp?.data;
  if (!run?.id) {
    throw new Error('Apify run response did not include a run ID.');
  }

  while (!TERMINAL_STATUSES.has(run.status)) {
    if (Date.now() - startTime > MAX_WALL_WAIT_MS) {
      console.error(`[smoke_test] ⏰ Wall-clock timeout (${MAX_WALL_WAIT_MS / 1000}s) exceeded! Triggering emergency abort for run ${run.id}...`);
      await apifyRequest('POST', `/actor-runs/${encodeURIComponent(run.id)}/abort`, token).catch(() => {});
      throw new Error(`Smoke test exceeded ${MAX_WALL_WAIT_MS / 1000}s and was automatically aborted.`);
    }
    const pollResp = await apifyRequest(
      'GET',
      `/actor-runs/${encodeURIComponent(run.id)}?waitForFinish=60`,
      token
    );
    run = pollResp?.data || run;
  }

  const chargedUsd = calculateRunChargeUsd(run);
  console.log(`[smoke_test] Run ${run.id} finished with status=${run.status}, charged=$${chargedUsd.toFixed(4)}`);

  if (run.status !== 'SUCCEEDED') {
    throw new Error(`Smoke test Actor run did not succeed (status=${run.status}, runId=${run.id}).`);
  }

  if (chargedUsd > opts.maxChargeUsd + 1e-6) {
    throw new Error(
      `Cost circuit breaker breach: run charged $${chargedUsd.toFixed(4)} > cap $${opts.maxChargeUsd.toFixed(2)}`
    );
  }

  if (!run.defaultDatasetId) {
    throw new Error(`Run ${run.id} has no defaultDatasetId.`);
  }

  const datasetUrl = `${APIFY_API_BASE}/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&limit=10`;
  const dsResponse = await fetch(datasetUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!dsResponse.ok) {
    throw new Error(`Failed to fetch dataset items (${dsResponse.status}).`);
  }
  const items = await dsResponse.json();

  const validation = validateAuditDatasetItems(items, opts.targetUrl);
  if (!validation.valid) {
    throw new Error(`Dataset schema validation failed: ${validation.errors.join(' | ')}`);
  }

  const summaryMd = [
    `### 🧪 本番スモークテスト結果（PASS ✅）`,
    `- **Actor**: \`${actorId}\` (Run ID: \`${run.id}\`)`,
    `- **検査URL**: \`${opts.targetUrl}\` → 出力件数 \`${items.length}\` 件`,
    `- **課金実績**: \`$${chargedUsd.toFixed(4)}\` / 安全上限 \`$${opts.maxChargeUsd.toFixed(2)}\``,
    `- **検証項目**: ${validation.checks.join(' / ')}`,
  ].join('\n');

  console.log(summaryMd);
  appendStepSummary(summaryMd);
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.dryRun) {
    await runDryRun(opts);
    return;
  }

  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) {
    console.error(
      '[smoke_test] エラー: 環境変数 APIFY_TOKEN が未設定です。オフライン検証を行う場合は --dry-run を付与してください。'
    );
    process.exitCode = 1;
    return;
  }

  await runLiveSmokeTest(opts, token);
}

main().catch((err) => {
  console.error(`[smoke_test] ❌ 失敗: ${err?.message || err}`);
  appendStepSummary(`### ❌ 本番スモークテスト失敗\n- 原因: \`${err?.message || err}\``);
  process.exitCode = 1;
});
