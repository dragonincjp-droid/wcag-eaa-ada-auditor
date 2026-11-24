import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PpeEventName, RawActorInput } from './types.js';

export interface SdkChargeResponse {
  eventChargeLimitReached?: boolean;
  chargedCount?: number;
}

interface ApifyKeyValueStoreLike {
  getPublicUrl?: (key: string) => string;
}

interface ApifyActorSdkLike {
  init: () => Promise<void>;
  exit: (exitCode?: number) => Promise<void>;
  getInput: <T = unknown>() => Promise<T | null>;
  pushData: (item: unknown) => Promise<void>;
  setValue: (key: string, value: unknown, options?: { contentType?: string }) => Promise<void>;
  openKeyValueStore: () => Promise<ApifyKeyValueStoreLike>;
  charge?: (options: { eventName: string; count?: number }) => Promise<SdkChargeResponse>;
}

export class ApifyRuntimeAdapter {
  private sdkActor: ApifyActorSdkLike | null = null;
  private initialized = false;
  private localDatasetCounter = 0;

  public getStorageRoot(): string {
    return path.resolve(process.env.APIFY_LOCAL_STORAGE_DIR || path.join(process.cwd(), 'storage'));
  }

  public async init(): Promise<void> {
    if (this.initialized) return;

    const pkgName = 'apify';
    try {
      const mod = (await import(pkgName)) as { Actor?: ApifyActorSdkLike };
      if (mod?.Actor && typeof mod.Actor.init === 'function') {
        this.sdkActor = mod.Actor;
        await this.sdkActor.init();
        this.initialized = true;
        return;
      }
    } catch {
      // Fallback to local file-backed Apify storage layout when running outside node_modules/apify
    }

    const root = this.getStorageRoot();
    fs.mkdirSync(path.join(root, 'datasets', 'default'), { recursive: true });
    fs.mkdirSync(path.join(root, 'key_value_stores', 'default'), { recursive: true });
    this.initialized = true;
  }

  public async getInput(): Promise<RawActorInput | null> {
    await this.init();
    if (this.sdkActor) {
      return await this.sdkActor.getInput<RawActorInput>();
    }

    if (process.env.APIFY_INPUT_JSON) {
      try {
        return JSON.parse(process.env.APIFY_INPUT_JSON) as RawActorInput;
      } catch {
        return null;
      }
    }

    const inputPath = path.join(this.getStorageRoot(), 'key_value_stores', 'default', 'INPUT.json');
    if (fs.existsSync(inputPath)) {
      try {
        return JSON.parse(fs.readFileSync(inputPath, 'utf8')) as RawActorInput;
      } catch {
        return null;
      }
    }
    return null;
  }

  public async pushData(item: unknown): Promise<void> {
    await this.init();
    if (this.sdkActor) {
      await this.sdkActor.pushData(item);
      return;
    }

    const items = Array.isArray(item) ? item : [item];
    const dsDir = path.join(this.getStorageRoot(), 'datasets', 'default');
    fs.mkdirSync(dsDir, { recursive: true });
    for (const entry of items) {
      this.localDatasetCounter += 1;
      const filename = `${String(this.localDatasetCounter).padStart(9, '0')}.json`;
      fs.writeFileSync(path.join(dsDir, filename), JSON.stringify(entry, null, 2), 'utf8');
    }
  }

  public async savePngToKeyValueStore(
    key: string,
    pngBuffer: Buffer,
  ): Promise<{ key: string; publicUrl: string }> {
    await this.init();
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, '-');

    if (this.sdkActor) {
      await this.sdkActor.setValue(safeKey, pngBuffer, { contentType: 'image/png' });
      const kvsId = process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
      try {
        const store = await this.sdkActor.openKeyValueStore();
        if (typeof store.getPublicUrl === 'function') {
          return { key: safeKey, publicUrl: store.getPublicUrl(safeKey) };
        }
      } catch {
        // Fallback URL resolution below
      }
      if (kvsId) {
        return {
          key: safeKey,
          publicUrl: `https://api.apify.com/v2/key-value-stores/${encodeURIComponent(kvsId)}/records/${encodeURIComponent(safeKey)}`,
        };
      }
      const localFallback = path.join(this.getStorageRoot(), 'key_value_stores', 'default', safeKey);
      return { key: safeKey, publicUrl: pathToFileURL(localFallback).toString() };
    }

    const kvsDir = path.join(this.getStorageRoot(), 'key_value_stores', 'default');
    fs.mkdirSync(kvsDir, { recursive: true });
    const filePath = path.join(kvsDir, safeKey);
    fs.writeFileSync(filePath, pngBuffer);

    const kvsId = process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
    const publicUrl = kvsId
      ? `https://api.apify.com/v2/key-value-stores/${encodeURIComponent(kvsId)}/records/${encodeURIComponent(safeKey)}`
      : pathToFileURL(filePath).toString();

    return { key: safeKey, publicUrl };
  }

  public async sdkCharge(eventName: PpeEventName, count = 1): Promise<SdkChargeResponse | null> {
    await this.init();
    if (this.sdkActor && typeof this.sdkActor.charge === 'function') {
      try {
        return await this.sdkActor.charge({ eventName, count });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[billing] Actor.charge("${eventName}") warning: ${msg}`);
        return null;
      }
    }
    return null;
  }

  public async exit(exitCode = 0): Promise<void> {
    if (this.sdkActor) {
      await this.sdkActor.exit(exitCode);
      return;
    }
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  }
}
