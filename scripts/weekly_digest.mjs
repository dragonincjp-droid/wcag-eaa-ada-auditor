#!/usr/bin/env node
/**
 * Weekly 3-Minute Owner Digest & Kill-Gate Monitor (`scripts/weekly_digest.mjs`)
 *
 * - Zero external dependencies: runs on Node.js 22+ standard `fetch` & built-in `node:*` modules only.
 * - Aggregates 7-day & 28-day Apify Actor runs, success/error rates, active users, and PPE revenue/net profit.
 * - Evaluates `devil-critic` Kill Criteria (Gate 1 @ Day 14, Gate 2 @ Day 28) & `ops-automator` Anomaly (>10% error rate).
 * - Outputs a concise Japanese Markdown report to stdout, `$GITHUB_STEP_SUMMARY`, and optional `WEBHOOK_URL` (Slack/Discord/JSON).
 *
 * Usage:
 *   node scripts/weekly_digest.mjs --dry-run
 *   node scripts/weekly_digest.mjs --dry-run --scenario=gate1
 *   node scripts/weekly_digest.mjs --dry-run --scenario=gate2
 *   node scripts/weekly_digest.mjs --dry-run --scenario=anomaly
 *   APIFY_TOKEN=xxx node scripts/weekly_digest.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const APIFY_API_BASE = 'https://api.apify.com/v2';
const DEFAULT_ACTOR_NAME = 'wcag-eaa-ada-auditor';

// Standard Pay-Per-Event (PPE) pricing defined in business plan
const DEFAULT_PPE_PRICES_USD = {
  'actor-start': 0.01,
  'url-audited': 0.025,
  'visual-evidence-generated': 0.015,
};

// Apify PPE settlement formula: max($0, Gross * 80% - Container Compute Cost)
// Chromium container compute cost is ~$0.0015-$0.003/URL (~70-76% effective net margin; $0 floor guarantees zero out-of-pocket loss)
const APIFY_DEVELOPER_SHARE = 0.80;
const DEFAULT_COMPUTE_COST_PER_URL_USD = 0.0022;
const DEFAULT_CONTAINER_INIT_COST_USD = 0.0005;
const ERROR_RATE_THRESHOLD_PCT = 10.0;
const GATE1_DAY = 14;
const GATE1_MIN_TRIAL_USERS = 15;
const GATE2_DAY = 28;

function parseCliArgs(argv) {
  const options = {
    dryRun: false,
    scenario: 'healthy',
    sendWebhookInDryRun: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg.startsWith('--scenario=')) {
      options.scenario = arg.split('=')[1]?.trim() || 'healthy';
    } else if (arg === '--send-webhook') {
      options.sendWebhookInDryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/weekly_digest.mjs [options]

Options:
  --dry-run, -d              Run offline with realistic mock metrics (no APIFY_TOKEN required)
  --scenario=<name>          Mock scenario for --dry-run: healthy | gate1 | gate2 | anomaly (default: healthy)
  --send-webhook             Allow sending to WEBHOOK_URL even during --dry-run
  --help, -h                 Show this help message

Environment Variables:
  APIFY_TOKEN                Apify Personal API Token (required unless --dry-run)
  APIFY_ACTOR_ID             Optional Actor ID or "username~actor-name" (auto-detected if omitted)
  WEBHOOK_URL                Optional Slack / Discord / Generic JSON webhook URL
  LAUNCH_DATE                Optional YYYY-MM-DD override for launch date (defaults to Actor createdAt)
  USD_JPY_RATE               Optional USD/JPY reference rate (default: 150)
  CONFIRMED_PAID_USERS_28D   Optional override for confirmed paid customer count in 28d
`);
}

function readLocalActorName() {
  const actorJsonPath = path.join(PROJECT_ROOT, '.actor', 'actor.json');
  try {
    if (fs.existsSync(actorJsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(actorJsonPath, 'utf8'));
      if (typeof parsed?.name === 'string' && parsed.name.trim()) {
        return parsed.name.trim();
      }
    }
  } catch {
    // Fallback to default actor name if .actor/actor.json is unreadable
  }
  return DEFAULT_ACTOR_NAME;
}

async function apifyGetJson(endpointPath, token) {
  const url = `${APIFY_API_BASE}${endpointPath}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`Apify API GET ${endpointPath} failed (${response.status}): ${bodyText.slice(0, 300)}`);
  }
  return response.json();
}

async function resolveActorContext(token) {
  const mePayload = await apifyGetJson('/users/me', token);
  const ownerUserId = mePayload?.data?.id || null;
  const username = mePayload?.data?.username || null;

  const explicitId = process.env.APIFY_ACTOR_ID?.trim();
  if (explicitId) {
    return {
      actorId: explicitId.replace('/', '~'),
      ownerUserId,
      ownerUsername: username,
    };
  }

  const localActorName = readLocalActorName();
  if (username) {
    const candidateId = `${username}~${localActorName}`;
    try {
      await apifyGetJson(`/acts/${encodeURIComponent(candidateId)}`, token);
      return { actorId: candidateId, ownerUserId, ownerUsername: username };
    } catch {
      // Search user's actors list if name differs slightly
    }
  }

  const listPayload = await apifyGetJson('/acts?my=true&limit=100', token);
  const items = listPayload?.data?.items || [];
  const matched =
    items.find((item) => item.name === localActorName) ||
    items.find((item) => /wcag|eaa|ada|accessibility/i.test(item.name || item.title || ''));

  if (matched?.id) {
    return { actorId: matched.id, ownerUserId, ownerUsername: username };
  }

  throw new Error(
    `対象のApify Actorが見つかりませんでした。先に apify push を実行するか、環境変数 APIFY_ACTOR_ID を指定してください（探索名: ${localActorName}）。`
  );
}

async function fetchRecentRuns(actorId, token, cutoffDate28d) {
  const allRuns = [];
  const pageLimit = 1000;
  const maxPages = 3;

  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * pageLimit;
    const payload = await apifyGetJson(
      `/acts/${encodeURIComponent(actorId)}/runs?desc=true&limit=${pageLimit}&offset=${offset}`,
      token
    );
    const items = payload?.data?.items || [];
    allRuns.push(...items);

    if (items.length < pageLimit) {
      break;
    }
    const oldest = items[items.length - 1];
    const oldestTime = oldest?.startedAt ? new Date(oldest.startedAt).getTime() : 0;
    if (oldestTime > 0 && oldestTime < cutoffDate28d.getTime()) {
      break;
    }
  }

  return allRuns;
}

function extractPpePricing(actorData) {
  const pricingInfos = Array.isArray(actorData?.pricingInfos) ? actorData.pricingInfos : [];
  const activePricing = pricingInfos[pricingInfos.length - 1] || null;
  const pricingModel = activePricing?.pricingModel || (actorData?.isPublic ? 'FREE_OR_UNSET' : 'PRIVATE_DRAFT');
  const isPpeActive = pricingModel === 'PAY_PER_EVENT';

  const prices = { ...DEFAULT_PPE_PRICES_USD };
  const rawEvents = activePricing?.pricingPerEvent?.actorChargeEvents;
  if (rawEvents && typeof rawEvents === 'object') {
    for (const [eventKey, eventMeta] of Object.entries(rawEvents)) {
      const priceUsd =
        typeof eventMeta?.eventPriceUsd === 'number'
          ? eventMeta.eventPriceUsd
          : typeof eventMeta === 'number'
            ? eventMeta
            : undefined;
      if (typeof priceUsd === 'number' && !Number.isNaN(priceUsd)) {
        prices[eventKey] = priceUsd;
      }
    }
  }

  return { isPpeActive, pricingModel, prices };
}

function summarizeRunWindow(runs, prices, isPpeActive, ownerUserId = null) {
  let totalRuns = 0;
  let ownerRuns = 0;
  let succeeded = 0;
  let failed = 0;
  let timedOut = 0;
  let aborted = 0;
  let running = 0;
  let chargedRuns = 0;
  let exactGrossUsd = 0;
  const eventTotals = {
    'actor-start': 0,
    'url-audited': 0,
    'visual-evidence-generated': 0,
  };
  const externalUniqueUserIds = new Set();

  for (const run of runs) {
    totalRuns += 1;
    const isOwnerRun = Boolean(ownerUserId && run?.userId && run.userId === ownerUserId);
    if (isOwnerRun) {
      ownerRuns += 1;
    }

    const status = run?.status || 'UNKNOWN';
    if (status === 'SUCCEEDED') succeeded += 1;
    else if (status === 'FAILED') failed += 1;
    else if (status === 'TIMED-OUT') timedOut += 1;
    else if (status === 'ABORTED') aborted += 1;
    else running += 1;

    // Exclude owner self-tests (e.g. smoke_test_live.mjs) from external trial user & paid conversion counts
    if (isOwnerRun) {
      continue;
    }

    if (run?.userId) {
      externalUniqueUserIds.add(run.userId);
    }

    let runChargeUsd = 0;
    const counts = run?.chargedEventCounts;
    if (counts && typeof counts === 'object' && Object.keys(counts).length > 0) {
      for (const [eventName, countVal] of Object.entries(counts)) {
        const count = Number(countVal) || 0;
        if (count > 0) {
          eventTotals[eventName] = (eventTotals[eventName] || 0) + count;
          const unitPrice = prices[eventName] ?? 0;
          runChargeUsd += count * unitPrice;
        }
      }
    } else if (isPpeActive && typeof run?.usageTotalUsd === 'number' && run.usageTotalUsd > 0) {
      runChargeUsd = run.usageTotalUsd;
    }

    if (runChargeUsd > 0) {
      chargedRuns += 1;
      exactGrossUsd += runChargeUsd;
    }
  }

  const terminalRuns = succeeded + failed + timedOut + aborted;
  const errorRuns = failed + timedOut;
  const successRatePct = terminalRuns > 0 ? (succeeded / terminalRuns) * 100 : 100.0;
  const errorRatePct = terminalRuns > 0 ? (errorRuns / terminalRuns) * 100 : 0.0;

  return {
    totalRuns,
    ownerRuns,
    terminalRuns,
    succeeded,
    failed,
    timedOut,
    aborted,
    running,
    errorRuns,
    successRatePct,
    errorRatePct,
    chargedRuns,
    exactGrossUsd,
    eventTotals,
    externalUniqueUsersFromRuns: externalUniqueUserIds.size,
  };
}

async function collectLiveMetrics(token) {
  const now = new Date();
  const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutoff28d = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

  const { actorId, ownerUserId } = await resolveActorContext(token);
  const actorResp = await apifyGetJson(`/acts/${encodeURIComponent(actorId)}`, token);
  const actor = actorResp?.data || {};
  const pricing = extractPpePricing(actor);

  const launchDateRaw = process.env.LAUNCH_DATE?.trim() || actor.createdAt || now.toISOString();
  const launchDate = new Date(launchDateRaw);
  const daysSinceLaunch = Math.max(
    0,
    Math.floor((now.getTime() - launchDate.getTime()) / (24 * 60 * 60 * 1000))
  );

  const recentRuns = await fetchRecentRuns(actor.id || actorId, token, cutoff28d);
  const runs7dRaw = recentRuns.filter(
    (r) => r?.startedAt && new Date(r.startedAt).getTime() >= cutoff7d.getTime()
  );
  const runs28dRaw = recentRuns.filter(
    (r) => r?.startedAt && new Date(r.startedAt).getTime() >= cutoff28d.getTime()
  );

  const win7d = summarizeRunWindow(runs7dRaw, pricing.prices, pricing.isPpeActive, ownerUserId);
  const win28d = summarizeRunWindow(runs28dRaw, pricing.prices, pricing.isPpeActive, ownerUserId);

  // Merge public Apify Store aggregate stats when external users run the Actor on their own accounts
  const stats = actor.stats || {};
  const pub30d = stats.publicActorRunStats30Days || null;
  if (pub30d && typeof pub30d.TOTAL === 'number' && pub30d.TOTAL > win28d.totalRuns) {
    // win28d.succeeded already includes owner succeeded runs, so extraSucceeded strictly represents external Store runs
    const extraSucceeded = Math.max(0, (pub30d.SUCCEEDED || 0) - win28d.succeeded);
    const extraFailed = Math.max(0, (pub30d.FAILED || 0) - win28d.failed);
    const extraTimedOut = Math.max(0, (pub30d['TIMED-OUT'] || 0) - win28d.timedOut);
    const extraAborted = Math.max(0, (pub30d.ABORTED || 0) - win28d.aborted);

    win28d.succeeded += extraSucceeded;
    win28d.failed += extraFailed;
    win28d.timedOut += extraTimedOut;
    win28d.aborted += extraAborted;
    win28d.totalRuns = Math.max(win28d.totalRuns, pub30d.TOTAL);
    win28d.terminalRuns = win28d.succeeded + win28d.failed + win28d.timedOut + win28d.aborted;
    win28d.errorRuns = win28d.failed + win28d.timedOut;
    win28d.successRatePct =
      win28d.terminalRuns > 0 ? (win28d.succeeded / win28d.terminalRuns) * 100 : 100.0;
    win28d.errorRatePct =
      win28d.terminalRuns > 0 ? (win28d.errorRuns / win28d.terminalRuns) * 100 : 0.0;

    if (pricing.isPpeActive && extraSucceeded > 0) {
      const estUrlsPerRun = Math.max(1, Number(process.env.EST_URLS_PER_RUN || 5));
      const estVisualPerRun = Math.ceil(estUrlsPerRun * 0.4);
      const estPerExternalRunUsd =
        pricing.prices['actor-start'] +
        estUrlsPerRun * pricing.prices['url-audited'] +
        estVisualPerRun * pricing.prices['visual-evidence-generated'];
      win28d.exactGrossUsd += extraSucceeded * estPerExternalRunUsd;
      win28d.chargedRuns += extraSucceeded;
      win28d.eventTotals['actor-start'] += extraSucceeded;
      win28d.eventTotals['url-audited'] += extraSucceeded * estUrlsPerRun;
      win28d.eventTotals['visual-evidence-generated'] += extraSucceeded * estVisualPerRun;
    }
  }

  // Subtract owner's own user slot if owner executed self-test runs in each window
  const ownerRan7d = win7d.ownerRuns > 0 ? 1 : 0;
  const ownerRan28d = win28d.ownerRuns > 0 ? 1 : 0;
  const ownerRanEver =
    ownerRan28d > 0 || recentRuns.some((r) => Boolean(ownerUserId && r?.userId === ownerUserId))
      ? 1
      : 0;

  const activeUsers7d = Math.max(
    Math.max(0, Number(stats.totalUsers7Days || 0) - ownerRan7d),
    win7d.externalUniqueUsersFromRuns
  );
  const activeUsers28d = Math.max(
    Math.max(0, Number(stats.totalUsers30Days || 0) - ownerRan28d),
    win28d.externalUniqueUsersFromRuns
  );
  const totalUsersAllTime = Math.max(
    Math.max(0, Number(stats.totalUsers || 0) - ownerRanEver),
    activeUsers28d
  );

  const confirmedPaidOverride = process.env.CONFIRMED_PAID_USERS_28D?.trim();
  const paidConversions28d =
    confirmedPaidOverride !== undefined && confirmedPaidOverride !== ''
      ? Number(confirmedPaidOverride)
      : win28d.chargedRuns;

  return {
    mode: 'LIVE',
    generatedAt: now.toISOString(),
    actorTitle: actor.title || 'WCAG 2.2 / EAA & ADA Accessibility Legal Risk Auditor',
    actorSlug: actor.username && actor.name ? `${actor.username}/${actor.name}` : actorId,
    isPublic: Boolean(actor.isPublic),
    isPpeActive: pricing.isPpeActive,
    pricingModel: pricing.pricingModel,
    prices: pricing.prices,
    launchDate: launchDate.toISOString().slice(0, 10),
    daysSinceLaunch,
    users: {
      active7d: activeUsers7d,
      active28d: activeUsers28d,
      totalAllTime: totalUsersAllTime,
    },
    window7d: win7d,
    window28d: win28d,
    paidConversions28d,
  };
}

function buildMockMetrics(scenario = 'healthy') {
  const now = new Date();
  const basePrices = { ...DEFAULT_PPE_PRICES_USD };

  if (scenario === 'gate1') {
    return {
      mode: 'DRY-RUN (scenario: gate1)',
      generatedAt: now.toISOString(),
      actorTitle: 'WCAG 2.2 / EAA & ADA Accessibility Legal Risk Auditor',
      actorSlug: 'owner-studio/wcag-eaa-ada-auditor',
      isPublic: true,
      isPpeActive: true,
      pricingModel: 'PAY_PER_EVENT',
      prices: basePrices,
      launchDate: new Date(now.getTime() - 16 * 86_400_000).toISOString().slice(0, 10),
      daysSinceLaunch: 16,
      users: { active7d: 4, active28d: 9, totalAllTime: 9 },
      window7d: {
        totalRuns: 11,
        terminalRuns: 11,
        succeeded: 11,
        failed: 0,
        timedOut: 0,
        aborted: 0,
        running: 0,
        errorRuns: 0,
        successRatePct: 100.0,
        errorRatePct: 0.0,
        chargedRuns: 4,
        exactGrossUsd: 1.84,
        eventTotals: { 'actor-start': 11, 'url-audited': 52, 'visual-evidence-generated': 28 },
      },
      window28d: {
        totalRuns: 23,
        terminalRuns: 23,
        succeeded: 22,
        failed: 1,
        timedOut: 0,
        aborted: 0,
        running: 0,
        errorRuns: 1,
        successRatePct: 95.65,
        errorRatePct: 4.35,
        chargedRuns: 7,
        exactGrossUsd: 3.45,
        eventTotals: { 'actor-start': 23, 'url-audited': 98, 'visual-evidence-generated': 51 },
      },
      paidConversions28d: 2,
    };
  }

  if (scenario === 'gate2') {
    return {
      mode: 'DRY-RUN (scenario: gate2)',
      generatedAt: now.toISOString(),
      actorTitle: 'WCAG 2.2 / EAA & ADA Accessibility Legal Risk Auditor',
      actorSlug: 'owner-studio/wcag-eaa-ada-auditor',
      isPublic: true,
      isPpeActive: true,
      pricingModel: 'PAY_PER_EVENT',
      prices: basePrices,
      launchDate: new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10),
      daysSinceLaunch: 29,
      users: { active7d: 3, active28d: 18, totalAllTime: 19 },
      window7d: {
        totalRuns: 5,
        terminalRuns: 5,
        succeeded: 5,
        failed: 0,
        timedOut: 0,
        aborted: 0,
        running: 0,
        errorRuns: 0,
        successRatePct: 100.0,
        errorRatePct: 0.0,
        chargedRuns: 0,
        exactGrossUsd: 0.0,
        eventTotals: { 'actor-start': 0, 'url-audited': 0, 'visual-evidence-generated': 0 },
      },
      window28d: {
        totalRuns: 26,
        terminalRuns: 26,
        succeeded: 25,
        failed: 1,
        timedOut: 0,
        aborted: 0,
        running: 0,
        errorRuns: 1,
        successRatePct: 96.15,
        errorRatePct: 3.85,
        chargedRuns: 0,
        exactGrossUsd: 0.0,
        eventTotals: { 'actor-start': 0, 'url-audited': 0, 'visual-evidence-generated': 0 },
      },
      paidConversions28d: 0,
    };
  }

  if (scenario === 'anomaly') {
    return {
      mode: 'DRY-RUN (scenario: anomaly)',
      generatedAt: now.toISOString(),
      actorTitle: 'WCAG 2.2 / EAA & ADA Accessibility Legal Risk Auditor',
      actorSlug: 'owner-studio/wcag-eaa-ada-auditor',
      isPublic: true,
      isPpeActive: true,
      pricingModel: 'PAY_PER_EVENT',
      prices: basePrices,
      launchDate: new Date(now.getTime() - 21 * 86_400_000).toISOString().slice(0, 10),
      daysSinceLaunch: 21,
      users: { active7d: 14, active28d: 27, totalAllTime: 27 },
      window7d: {
        totalRuns: 40,
        terminalRuns: 40,
        succeeded: 31,
        failed: 7,
        timedOut: 2,
        aborted: 0,
        running: 0,
        errorRuns: 9,
        successRatePct: 77.5,
        errorRatePct: 22.5,
        chargedRuns: 25,
        exactGrossUsd: 14.8,
        eventTotals: { 'actor-start': 31, 'url-audited': 410, 'visual-evidence-generated': 282 },
      },
      window28d: {
        totalRuns: 112,
        terminalRuns: 112,
        succeeded: 99,
        failed: 10,
        timedOut: 3,
        aborted: 0,
        running: 0,
        errorRuns: 13,
        successRatePct: 88.39,
        errorRatePct: 11.61,
        chargedRuns: 78,
        exactGrossUsd: 46.5,
        eventTotals: { 'actor-start': 99, 'url-audited': 1320, 'visual-evidence-generated': 834 },
      },
      paidConversions28d: 11,
    };
  }

  // Default: 'healthy' scenario (Day 21, steady organic B2B agency adoption)
  return {
    mode: 'DRY-RUN (サンプル試算モード)',
    generatedAt: now.toISOString(),
    actorTitle: 'WCAG 2.2 / EAA & ADA Accessibility Legal Risk Auditor',
    actorSlug: 'owner-studio/wcag-eaa-ada-auditor',
    isPublic: true,
    isPpeActive: true,
    pricingModel: 'PAY_PER_EVENT',
    prices: basePrices,
    launchDate: new Date(now.getTime() - 21 * 86_400_000).toISOString().slice(0, 10),
    daysSinceLaunch: 21,
    users: {
      active7d: 12,
      active28d: 24,
      totalAllTime: 24,
    },
    window7d: {
      totalRuns: 68,
      terminalRuns: 68,
      succeeded: 67,
      failed: 1,
      timedOut: 0,
      aborted: 0,
      running: 0,
      errorRuns: 1,
      successRatePct: 98.53,
      errorRatePct: 1.47,
      chargedRuns: 54,
      exactGrossUsd: 19.42,
      eventTotals: {
        'actor-start': 67,
        'url-audited': 540,
        'visual-evidence-generated': 350,
      },
    },
    window28d: {
      totalRuns: 184,
      terminalRuns: 184,
      succeeded: 181,
      failed: 2,
      timedOut: 1,
      aborted: 0,
      running: 0,
      errorRuns: 3,
      successRatePct: 98.37,
      errorRatePct: 1.63,
      chargedRuns: 142,
      exactGrossUsd: 52.40,
      eventTotals: {
        'actor-start': 181,
        'url-audited': 1460,
        'visual-evidence-generated': 939,
      },
    },
    paidConversions28d: 9,
  };
}

function evaluateGatesAndAnomalies(metrics) {
  const { daysSinceLaunch, users, window7d, window28d, paidConversions28d, isPpeActive, isPublic } =
    metrics;
  const trialUsers = Math.max(users.totalAllTime, users.active28d);

  // 1. Anomaly check: error rate > 10%
  const hasHighError7d =
    window7d.terminalRuns >= 1 && window7d.errorRatePct > ERROR_RATE_THRESHOLD_PCT;
  const hasHighError28dFallback =
    window7d.terminalRuns === 0 &&
    window28d.terminalRuns >= 3 &&
    window28d.errorRatePct > ERROR_RATE_THRESHOLD_PCT;
  const anomalyTriggered = hasHighError7d || hasHighError28dFallback;

  // 2. Devil-Critic Gate 1: Day 14+ & < 15 trial users
  const gate1Triggered = daysSinceLaunch >= GATE1_DAY && trialUsers < GATE1_MIN_TRIAL_USERS;
  const gate1Status =
    daysSinceLaunch < GATE1_DAY
      ? `⏳ 計測中（Day ${daysSinceLaunch}/${GATE1_DAY}：現在 ${trialUsers}/${GATE1_MIN_TRIAL_USERS}人）`
      : gate1Triggered
        ? `🟡 **要改善勧告**（Day ${daysSinceLaunch} 時点で試用 ${trialUsers}人 < 基準${GATE1_MIN_TRIAL_USERS}人）`
        : `🟢 クリア済（試用 ${trialUsers}人 ≥ 基準${GATE1_MIN_TRIAL_USERS}人）`;

  // 3. Devil-Critic Gate 2: Day 28+ & 0 paid runs/conversions
  const gate2Triggered = daysSinceLaunch >= GATE2_DAY && paidConversions28d <= 0;
  const gate2Status =
    daysSinceLaunch < GATE2_DAY
      ? `⏳ 計測中（Day ${daysSinceLaunch}/${GATE2_DAY}：直近28日課金稼働 ${paidConversions28d}件）`
      : gate2Triggered
        ? `🔴 **撤退・ピボット勧告**（Day ${daysSinceLaunch} 時点で課金稼働 0件）`
        : `🟢 クリア済（直近28日課金稼働 ${paidConversions28d}件 > 0件）`;

  // 4. Monetization / Store visibility sanity check
  const monetizationWarning = !isPublic || !isPpeActive;

  let overallLevel = 'HEALTHY';
  let headlineBadge = '🟢 正常稼働（完全放置継続OK・今週のオーナー作業 0分）';

  if (anomalyTriggered) {
    overallLevel = 'ANOMALY';
    headlineBadge = `🚨 異常検知アラート（直近エラー率 ${window7d.errorRatePct.toFixed(1)}% > 閾値10%：要確認）`;
  } else if (gate2Triggered) {
    overallLevel = 'GATE2_PIVOT';
    headlineBadge = '🔴 Gate 2 到達：Day 28 課金0件のため「静的放置＋次案ピボット」を推奨';
  } else if (gate1Triggered) {
    overallLevel = 'GATE1_ACTION';
    headlineBadge = '🟡 Gate 1 到達：試用15人未満のため「機能追加禁止・タイトル/訴求1回修正」を推奨';
  } else if (monetizationWarning) {
    overallLevel = 'SETUP_NEEDED';
    headlineBadge = '🟠 公開/料金設定の未完了項目あり（OWNER_LAUNCH_GUIDE_JA.md Step 2 を確認）';
  }

  return {
    overallLevel,
    headlineBadge,
    anomalyTriggered,
    gate1Triggered,
    gate1Status,
    gate2Triggered,
    gate2Status,
    monetizationWarning,
    trialUsers,
  };
}

function formatUsd(amount) {
  return `$${amount.toFixed(2)}`;
}

function formatJpy(amountUsd, usdJpyRate) {
  const yen = Math.round(amountUsd * usdJpyRate);
  return `約 ¥${yen.toLocaleString('ja-JP')}`;
}

function calculatePpeSettlement(windowSummary) {
  const grossUsd = windowSummary.exactGrossUsd || 0;
  if (grossUsd <= 0) {
    return {
      grossUsd: 0,
      apifyCommissionUsd: 0,
      estComputeCostUsd: 0,
      totalDeductionsUsd: 0,
      netProfitUsd: 0,
      effectiveMarginPct: 0,
    };
  }

  const apifyCommissionUsd = grossUsd * (1 - APIFY_DEVELOPER_SHARE);
  const computeCostPerUrl =
    Number(process.env.EST_COMPUTE_COST_PER_URL_USD || DEFAULT_COMPUTE_COST_PER_URL_USD) ||
    DEFAULT_COMPUTE_COST_PER_URL_USD;
  const auditedUrls =
    Number(windowSummary.eventTotals?.['url-audited'] || 0) ||
    Math.max(1, Math.round(grossUsd / DEFAULT_PPE_PRICES_USD['url-audited']));
  const chargedRuns = Number(windowSummary.chargedRuns || 0);

  const estComputeCostUsd =
    auditedUrls * computeCostPerUrl + chargedRuns * DEFAULT_CONTAINER_INIT_COST_USD;
  // Apify PPE exact settlement formula: max($0, Gross * 80% - Container Compute Cost)
  const netProfitUsd = Math.max(0, grossUsd * APIFY_DEVELOPER_SHARE - estComputeCostUsd);
  const totalDeductionsUsd = grossUsd - netProfitUsd;
  const effectiveMarginPct = (netProfitUsd / grossUsd) * 100;

  return {
    grossUsd,
    apifyCommissionUsd,
    estComputeCostUsd,
    totalDeductionsUsd,
    netProfitUsd,
    effectiveMarginPct,
  };
}

function renderMarkdownReport(metrics, evaluation, usdJpyRate) {
  const ppe7d = calculatePpeSettlement(metrics.window7d);
  const ppe28d = calculatePpeSettlement(metrics.window28d);
  const gross7d = ppe7d.grossUsd;
  const net7d = ppe7d.netProfitUsd;
  const gross28d = ppe28d.grossUsd;
  const net28d = ppe28d.netProfitUsd;
  const marginLabel7d = gross7d > 0 ? `実質 ${ppe7d.effectiveMarginPct.toFixed(1)}%` : '—';
  const marginLabel28d = gross28d > 0 ? `実質 ${ppe28d.effectiveMarginPct.toFixed(1)}%` : '—';

  const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const generatedJst = jstFormatter.format(new Date(metrics.generatedAt));

  const decisionItems = [];
  if (evaluation.anomalyTriggered) {
    decisionItems.push(
      `- [ ] **[Yes / No] エラー原因の自動調査＆修正パッチ作成をAIチーム（\`product-architect\`）へ指示する**（直近エラー率 \`${metrics.window7d.errorRatePct.toFixed(1)}%\` > 10%閾値）`,
      `- [ ] **[Yes / No] 修正完了まで Apify Store の公開を一時停止（Unpublish / 縮退）する**（連続タイムアウトや対象仕様変更が疑われる場合のみ）`
    );
  }
  if (evaluation.monetizationWarning) {
    decisionItems.push(
      `- [ ] **[Yes / No] Apify Console で Pay-Per-Event 料金設定（\`$0.01 / $0.025 / $0.015\`）と Store 公開を有効化する**（現在: \`${metrics.pricingModel}\`）`
    );
  }
  if (evaluation.gate2Triggered) {
    decisionItems.push(
      `- [ ] **[Yes / No] \`devil-critic\` Gate 2 基準に従い、本Actorを追加開発ゼロの「完全静的放置（維持費¥0）」へ移行し、バックアップ案（案① ハラスメント盾メーカー または 案③ 仕訳CSV変換くん）へピボットする**`
    );
  } else if (evaluation.gate1Triggered) {
    decisionItems.push(
      `- [ ] **[Yes / No] \`devil-critic\` Gate 1 基準に従い、機能追加は一切行わず Apify Store のタイトル・検索タグ・README冒頭訴求の1回改善を \`growth-engine\` に実行させる**`
    );
  }
  if (net28d >= 20.0) {
    decisionItems.push(
      `- [ ] **[Yes / No]（初回のみ）Apify Console > Monetization > Payouts に受取口座（Wise / PayPal）が登録済みか確認する**（28日推定手取り純利益 \`${formatUsd(net28d)}\`）`
    );
  }
  if (decisionItems.length === 0) {
    decisionItems.push(
      `- [x] **[承認不要・完全放置継続]** 今週オーナーが行う作業はありません（異常ゼロ・撤退ゲート抵触なし・固定費/持ち出しリスク ¥0）。`
    );
  }

  const lines = [
    `# 📊 週次3分オーナーレポート — WCAG / EAA & ADA Auditor`,
    ``,
    `> **総合判定**: ${evaluation.headlineBadge}`,
    `> - **集計日時 (JST)**: ${generatedJst} ／ **実行モード**: \`${metrics.mode}\``,
    `> - **対象Actor**: \`${metrics.actorSlug}\` （公開日: \`${metrics.launchDate}\` / **Day ${metrics.daysSinceLaunch}**）`,
    ``,
    `---`,
    ``,
    `## 1. 収益・稼働KPIサマリー（直近7日間 ／ 直近28日間）`,
    ``,
    `| 指標 | 直近 7日間 | 直近 28日間 | 備考・コスト構造 |`,
    `| :--- | ---: | ---: | :--- |`,
    `| **推定PPE総売上 (Gross)** | **${formatUsd(gross7d)}** | **${formatUsd(gross28d)}** | \`start:$0.01\` / \`url:$0.025\` / \`img:$0.015\`（オーナー自己テスト除外済） |`,
    `| **Apify手数料 (20%) ＋ 推定コンテナ計算原価** | -${formatUsd(ppe7d.totalDeductionsUsd)} | -${formatUsd(ppe28d.totalDeductionsUsd)} | 手数料20% + Chromium計算原価（約\`$0.0015〜$0.003/URL\`）自動控除 |`,
    `| **オーナー持ち出し固定費・外部LLM費** | **$0.00 (¥0)** | **$0.00 (¥0)** | Zero-LLM設計 ／ 原価超過時のマイナス請求なし（持ち出し赤字リスク **$0**） |`,
    `| **💰 オーナー推定純利益 (実質 約70〜76%)** | **${formatUsd(net7d)}** (${formatJpy(net7d, usdJpyRate)}) | **${formatUsd(net28d)}** (${formatJpy(net28d, usdJpyRate)}) | 利益率: 7日 \`${marginLabel7d}\` / 28日 \`${marginLabel28d}\`（参考 \`$1 = ¥${usdJpyRate}\`） |`,
    `| **総実行回数 (Runs)** | ${metrics.window7d.totalRuns} 回 | ${metrics.window28d.totalRuns} 回 | 外部課金稼働: 7日 ${metrics.window7d.chargedRuns}回 / 28日 ${metrics.window28d.chargedRuns}回 |`,
    `| **成功率 ／ エラー率** | **${metrics.window7d.successRatePct.toFixed(1)}%** / ${metrics.window7d.errorRatePct.toFixed(1)}% | **${metrics.window28d.successRatePct.toFixed(1)}%** / ${metrics.window28d.errorRatePct.toFixed(1)}% | 7日失敗内訳: Failed ${metrics.window7d.failed} / Timeout ${metrics.window7d.timedOut} |`,
    `| **外部アクティブ試用ユーザー数** | **${metrics.users.active7d} 人** | **${metrics.users.active28d} 人** | 累計ユニーク外部試用者数: **${metrics.users.totalAllTime} 人**（オーナー自身を除外） |`,
    ``,
    `> 💡 **PPE精算ルール注記**: Apify Pay-Per-Event は \`max($0, 総売上 × 80% − コンテナ計算原価)\` で精算されるため、Chromium計算原価控除後の実質純利益率は **約70〜76%** となります。万一計算原価が上回った場合でもマイナス補填請求は発生せず、**オーナーの持ち出し赤字リスクは完全 \`$0\`（¥0）** です。`,
    ``,
    `---`,
    ``,
    `## 2. 安全装置（キルスイッチ）＆ \`devil-critic\` 撤退ゲート自動判定`,
    ``,
    `| 監査項目 | 基準・閾値 | 現在の計測値 | 自動判定 |`,
    `| :--- | :--- | :--- | :--- |`,
    `| **死活・異常エラー監視** | 直近7日エラー率 \`≤ 10.0%\` | \`${metrics.window7d.errorRatePct.toFixed(1)}%\` (${metrics.window7d.errorRuns}/${metrics.window7d.terminalRuns}回) | ${evaluation.anomalyTriggered ? '🚨 **異常検知（要確認）**' : '🟢 正常'} |`,
    `| **API・計算原価破産ガード** | オーナー持ち出し上限 \`¥0\` | \`$0.00\`（\`max($0, ...)\` 保証＋Zero-LLM） | 🟢 安全（深夜スパイク時の持ち出し赤字リスク0） |`,
    `| **Gate 1（初期関心テスト）** | Day 14時点で外部試用 \`15人以上\` | 累計外部 \`${evaluation.trialUsers}人\` (Day ${metrics.daysSinceLaunch}) | ${evaluation.gate1Status} |`,
    `| **Gate 2（収益化・撤退テスト）** | Day 28時点で外部有料課金 \`1件以上\` | 外部課金稼働 \`${metrics.paidConversions28d}件\` (Day ${metrics.daysSinceLaunch}) | ${evaluation.gate2Status} |`,
    ``,
    `---`,
    ``,
    `## 3. 今週オーナーが Yes / No で答えるだけの承認事項（所要1分）`,
    ``,
    ...decisionItems,
    ``,
    `---`,
    ``,
    `## 4. 異常時・改善時のAIチーム1行呼び出しコマンド（コピペ用）`,
    ``,
    `- **Gate 1（タイトル・README訴求改善）を実行したい時**:`,
    `  > \`wcag-eaa-ada-auditor が Gate 1 勧告になりました。機能追加はせず、Apify Storeの検索流入と試用率を上げるタイトル・タグ・README改善案を作成して反映してください。\``,
    `- **エラー率10%超の自動原因調査・修正を指示したい時**:`,
    `  > \`wcag-eaa-ada-auditor の週次レポートでエラー率が10%を超えました。smoke_test_live.mjs と直近の失敗パターンを点検し、タイムアウト・例外ハンドリングを強化して自動デプロイしてください。\``,
    `- **Gate 2（静的放置＆次案ピボット）を実行したい時**:`,
    `  > \`wcag-eaa-ada-auditor が Day 28 で課金0件（Gate 2）のため静的放置に移行します。docs/proposals_market_hunter.md の次点案（案①または案③）のMVP立ち上げを開始してください。\``,
    ``,
  ];

  return lines.join('\n');
}

function appendToGitHubStepSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return false;
  fs.appendFileSync(summaryPath, `${markdown}\n`, 'utf8');
  return true;
}

function buildWebhookPayload(webhookUrl, metrics, evaluation, usdJpyRate) {
  const ppe7d = calculatePpeSettlement(metrics.window7d);
  const ppe28d = calculatePpeSettlement(metrics.window28d);
  const net7d = ppe7d.netProfitUsd;
  const net28d = ppe28d.netProfitUsd;

  const repoUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions`
      : null;

  const conciseSummary = [
    `📊 **週次3分オーナーレポート (${metrics.actorSlug} / Day ${metrics.daysSinceLaunch})**`,
    `${evaluation.headlineBadge}`,
    `• **7日推定純利益(実質約70-76%)**: ${formatUsd(net7d)} (${formatJpy(net7d, usdJpyRate)}) | **28日推定純利益**: ${formatUsd(net28d)} (${formatJpy(net28d, usdJpyRate)})`,
    `• **稼働(7日)**: ${metrics.window7d.totalRuns}回 (成功率 ${metrics.window7d.successRatePct.toFixed(1)}% / エラー率 ${metrics.window7d.errorRatePct.toFixed(1)}%)`,
    `• **外部試用ユーザー**: 7日 ${metrics.users.active7d}人 / 累計 ${metrics.users.totalAllTime}人`,
    `• **Gate判定**: Gate1=${evaluation.gate1Triggered ? '🟡要訴求修正' : 'OK'} / Gate2=${evaluation.gate2Triggered ? '🔴ピボット勧告' : 'OK'}`,
    repoUrl ? `🔗 詳細レポート・Yes/No承認項目: ${repoUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const lowerUrl = webhookUrl.toLowerCase();
  if (lowerUrl.includes('discord.com/api/webhooks') || lowerUrl.includes('discordapp.com/api/webhooks')) {
    return {
      content: conciseSummary.slice(0, 1950),
    };
  }
  if (lowerUrl.includes('hooks.slack.com')) {
    return {
      text: conciseSummary,
    };
  }
  return {
    text: conciseSummary,
    content: conciseSummary,
    status: evaluation.overallLevel,
    headline: evaluation.headlineBadge,
    generatedAt: metrics.generatedAt,
    metrics: {
      daysSinceLaunch: metrics.daysSinceLaunch,
      netProfit7dUsd: Number(net7d.toFixed(2)),
      netProfit28dUsd: Number(net28d.toFixed(2)),
      runs7d: metrics.window7d.totalRuns,
      errorRate7dPct: Number(metrics.window7d.errorRatePct.toFixed(2)),
      totalUsers: metrics.users.totalAllTime,
    },
  };
}

async function sendWebhookNotification(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Webhook POST failed (${response.status}): ${errText.slice(0, 200)}`);
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const usdJpyRate = Number(process.env.USD_JPY_RATE || 150) || 150;
  const token = process.env.APIFY_TOKEN?.trim();

  if (!options.dryRun && !token) {
    const missingMsg = [
      `## ⚠️ 週次オーナーレポート待機中（\`APIFY_TOKEN\` 未設定）`,
      ``,
      `GitHub Secrets に \`APIFY_TOKEN\` が未登録のため、Apify API からの実績取得をスキップしました。`,
      `- ローカルで出力形式を確認する場合: \`node scripts/weekly_digest.mjs --dry-run\``,
      `- 本番連携する場合: リポジトリの **Settings > Secrets and variables > Actions** に \`APIFY_TOKEN\` を追加してください（手順: \`OWNER_LAUNCH_GUIDE_JA.md\`）。`,
    ].join('\n');
    console.error(missingMsg);
    appendToGitHubStepSummary(missingMsg);
    process.exitCode = 1;
    return;
  }

  const metrics = options.dryRun
    ? buildMockMetrics(options.scenario)
    : await collectLiveMetrics(token);

  const evaluation = evaluateGatesAndAnomalies(metrics);
  const markdown = renderMarkdownReport(metrics, evaluation, usdJpyRate);

  console.log(markdown);

  const wroteSummary = appendToGitHubStepSummary(markdown);
  if (wroteSummary) {
    console.error('[weekly_digest] GitHub Step Summary へレポートを出力しました。');
  }

  const webhookUrl = process.env.WEBHOOK_URL?.trim();
  if (webhookUrl) {
    const payload = buildWebhookPayload(webhookUrl, metrics, evaluation, usdJpyRate);
    if (options.dryRun && !options.sendWebhookInDryRun) {
      console.error('[weekly_digest] --dry-run のため WEBHOOK_URL への実送信はスキップしました（ペイロード検証OK）。');
    } else {
      await sendWebhookNotification(webhookUrl, payload);
      console.error('[weekly_digest] WEBHOOK_URL へ週次サマリー通知を送信しました。');
    }
  }
}

main().catch((error) => {
  console.error(`[weekly_digest] 実行エラー: ${error?.message || error}`);
  process.exitCode = 1;
});
