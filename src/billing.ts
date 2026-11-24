import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApifyRuntimeAdapter } from './apifyRuntime.js';
import { PPE_EVENTS, type PpeEventName } from './types.js';

const DEFAULT_PRICES_USD: Record<PpeEventName, number> = {
  [PPE_EVENTS.ACTOR_START]: 0.01,
  [PPE_EVENTS.URL_AUDITED]: 0.025,
  [PPE_EVENTS.VISUAL_EVIDENCE_GENERATED]: 0.015,
};

export interface ChargeAttemptResult {
  charged: boolean;
  chargedCount: number;
  limitReached: boolean;
  estimatedTotalUsd: number;
}

export interface BillingSummary {
  chargedCounts: Record<PpeEventName, number>;
  estimatedTotalUsd: number;
  maxBudgetUsd: number | null;
  limitReached: boolean;
}

function loadPpePricesFromDisk(): Record<PpeEventName, number> {
  const prices: Record<PpeEventName, number> = { ...DEFAULT_PRICES_USD };
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const ppePath = path.resolve(__dirname, '..', '.actor', 'pay_per_event.json');
    if (fs.existsSync(ppePath)) {
      const parsed = JSON.parse(fs.readFileSync(ppePath, 'utf8')) as Record<
        string,
        { eventPriceUsd?: number }
      >;
      for (const key of Object.values(PPE_EVENTS)) {
        const val = parsed?.[key]?.eventPriceUsd;
        if (typeof val === 'number' && val >= 0) {
          prices[key] = val;
        }
      }
    }
  } catch {
    // Use built-in defaults
  }
  return prices;
}

export class BillingManager {
  private readonly runtime: ApifyRuntimeAdapter;
  private readonly pricesUsd: Record<PpeEventName, number>;
  private readonly maxBudgetUsd: number | null;
  private readonly counts: Record<PpeEventName, number> = {
    [PPE_EVENTS.ACTOR_START]: 0,
    [PPE_EVENTS.URL_AUDITED]: 0,
    [PPE_EVENTS.VISUAL_EVIDENCE_GENERATED]: 0,
  };
  private totalUsd = 0;
  private limitReached = false;

  public constructor(runtime: ApifyRuntimeAdapter, explicitMaxBudgetUsd?: number) {
    this.runtime = runtime;
    this.pricesUsd = loadPpePricesFromDisk();

    const envCapRaw =
      process.env.ACTOR_MAX_TOTAL_CHARGE_USD ?? process.env.APIFY_MAX_TOTAL_CHARGE_USD;
    const envCap = envCapRaw !== undefined && envCapRaw !== '' ? Number(envCapRaw) : NaN;

    if (typeof explicitMaxBudgetUsd === 'number' && !Number.isNaN(explicitMaxBudgetUsd) && explicitMaxBudgetUsd >= 0) {
      this.maxBudgetUsd = explicitMaxBudgetUsd;
    } else if (!Number.isNaN(envCap) && envCap >= 0) {
      this.maxBudgetUsd = envCap;
    } else {
      this.maxBudgetUsd = null;
    }
  }

  public canAfford(eventName: PpeEventName, count = 1): boolean {
    if (this.limitReached) return false;
    if (this.maxBudgetUsd === null) return true;
    const nextCost = this.totalUsd + this.pricesUsd[eventName] * count;
    return nextCost <= this.maxBudgetUsd + 1e-9;
  }

  public isLimitReached(): boolean {
    return this.limitReached;
  }

  public async chargeEvent(eventName: PpeEventName, count = 1): Promise<ChargeAttemptResult> {
    if (count <= 0) {
      return {
        charged: true,
        chargedCount: 0,
        limitReached: this.limitReached,
        estimatedTotalUsd: Number(this.totalUsd.toFixed(6)),
      };
    }

    const unitPrice = this.pricesUsd[eventName] ?? 0;
    if (this.maxBudgetUsd !== null && this.totalUsd + unitPrice * count > this.maxBudgetUsd + 1e-9) {
      this.limitReached = true;
      return {
        charged: false,
        chargedCount: 0,
        limitReached: true,
        estimatedTotalUsd: Number(this.totalUsd.toFixed(6)),
      };
    }

    const sdkRes = await this.runtime.sdkCharge(eventName, count);
    if (sdkRes) {
      if (sdkRes.eventChargeLimitReached === true) {
        const partialCharged =
          typeof sdkRes.chargedCount === 'number' && sdkRes.chargedCount > 0
            ? sdkRes.chargedCount
            : 0;
        this.counts[eventName] += partialCharged;
        this.totalUsd += unitPrice * partialCharged;
        this.limitReached = true;
        return {
          charged: partialCharged > 0,
          chargedCount: partialCharged,
          limitReached: true,
          estimatedTotalUsd: Number(this.totalUsd.toFixed(6)),
        };
      }

      // When PPE monetization is not yet enabled (Private test run) or when the Actor creator
      // runs their own Actor for $0, Apify returns { eventChargeLimitReached: false, chargedCount: 0 }.
      // Allow the audit to proceed normally while recording actual billed count.
      const actualCharged =
        typeof sdkRes.chargedCount === 'number' ? sdkRes.chargedCount : count;
      const effectiveUnits = actualCharged > 0 ? actualCharged : count;
      this.counts[eventName] += effectiveUnits;
      this.totalUsd += unitPrice * actualCharged;

      return {
        charged: true,
        chargedCount: actualCharged,
        limitReached: false,
        estimatedTotalUsd: Number(this.totalUsd.toFixed(6)),
      };
    }

    this.counts[eventName] += count;
    this.totalUsd += unitPrice * count;

    return {
      charged: true,
      chargedCount: count,
      limitReached: this.limitReached,
      estimatedTotalUsd: Number(this.totalUsd.toFixed(6)),
    };
  }

  public getSummary(): BillingSummary {
    return {
      chargedCounts: { ...this.counts },
      estimatedTotalUsd: Number(this.totalUsd.toFixed(6)),
      maxBudgetUsd: this.maxBudgetUsd,
      limitReached: this.limitReached,
    };
  }
}
