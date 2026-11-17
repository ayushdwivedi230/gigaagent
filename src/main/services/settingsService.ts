import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '@shared/settings';
import type { AppSettings, ClientSettings, CredentialStorage, Preferences, UpdateSettingsRequest } from '@shared/types';

export interface SettingsStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(cipherText: Buffer): string;
}

export class SettingsService {
  private readonly filePath: string | null;
  private readonly adapter: SettingsStorageAdapter | null;
  private cached: AppSettings;

  constructor(filePath: string | null = null, adapter: SettingsStorageAdapter | null = null) {
    this.filePath = filePath;
    this.adapter = adapter;
    this.cached = this.load();
  }

  getSettings(): AppSettings {
    return { ...this.cached };
  }

  /** Always returns a complete, validated preferences object. */
  getPreferences(): Preferences {
    return this.cached.preferences ?? DEFAULT_PREFERENCES;
  }

  /**
   * 'os-encrypted': keys are encrypted with the OS keystore (Windows DPAPI via Electron safeStorage).
   * 'memory-only': no OS encryption is available, so keys are kept for this run only and are
   * never written to disk in plain text.
   */
  getCredentialStorage(): CredentialStorage {
    return this.filePath && this.adapter?.isEncryptionAvailable() ? 'os-encrypted' : 'memory-only';
  }

  getClientSettings(): ClientSettings {
    const effectiveStt = this.getEffectiveSttKey();
    const effectiveGemini = this.getEffectiveGeminiKey();

    const mask = (key?: string): string | undefined => {
      if (!key) return undefined;
      const trimmed = key.trim();
      if (!trimmed) return undefined;
      if (trimmed.length <= 4) return '••••';
      return `••••••••${trimmed.slice(-4)}`;
    };

    return {
      sttProvider: this.cached.sttProvider,
      hasSttKey: Boolean(effectiveStt && effectiveStt.trim().length > 0),
      hasGeminiKey: Boolean(effectiveGemini && effectiveGemini.trim().length > 0),
      maskedSttKey: mask(effectiveStt),
      maskedGeminiKey: mask(effectiveGemini),
      screenShareInvisibility: this.cached.screenShareInvisibility ?? true,
      preferences: this.getPreferences(),
      credentialStorage: this.getCredentialStorage(),
    };
  }

  saveSettings(updates: UpdateSettingsRequest): ClientSettings {
    // IPC input is untrusted: every field is type-checked before it is stored.
    if (updates.sttProvider === 'deepgram' || updates.sttProvider === 'google' || updates.sttProvider === 'mock') {
      this.cached.sttProvider = updates.sttProvider;
    }
    if (typeof updates.sttApiKey === 'string' && updates.sttApiKey.length <= 512) {
      this.cached.sttApiKey = updates.sttApiKey.trim();
    }
    if (typeof updates.geminiApiKey === 'string' && updates.geminiApiKey.length <= 512) {
      this.cached.geminiApiKey = updates.geminiApiKey.trim();
    }
    if (typeof updates.screenShareInvisibility === 'boolean') {
      this.cached.screenShareInvisibility = updates.screenShareInvisibility;
    }
    if (updates.preferences !== undefined) {
      this.cached.preferences = sanitizePreferences(mergeDeep(this.getPreferences(), updates.preferences), this.getPreferences());
    }

    if (this.filePath) {
      this.persist();
    }

    return this.getClientSettings();
  }

  getEffectiveSttKey(): string | undefined {
    return this.cached.sttApiKey || process.env.DEEPGRAM_API_KEY || process.env.STT_API_KEY;
  }

  getEffectiveGeminiKey(): string | undefined {
    return this.cached.geminiApiKey || process.env.GEMINI_API_KEY;
  }

  private load(): AppSettings {
    const defaults: AppSettings = {
      sttProvider: 'deepgram',
      sttApiKey: process.env.DEEPGRAM_API_KEY || '',
      geminiApiKey: process.env.GEMINI_API_KEY || '',
      screenShareInvisibility: true,
      preferences: DEFAULT_PREFERENCES,
    };

    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return defaults;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Legacy plain-text keys (pre-3.0 fallback) are still read once, then re-saved encrypted or dropped.
      let sttApiKey = (typeof parsed.sttApiKey === 'string' && parsed.sttApiKey) || defaults.sttApiKey;
      let geminiApiKey = (typeof parsed.geminiApiKey === 'string' && parsed.geminiApiKey) || defaults.geminiApiKey;

      if (this.adapter?.isEncryptionAvailable()) {
        if (typeof parsed.sttApiKeyEncrypted === 'string') {
          try {
            sttApiKey = this.adapter.decryptString(Buffer.from(parsed.sttApiKeyEncrypted, 'base64'));
          } catch {}
        }
        if (typeof parsed.geminiApiKeyEncrypted === 'string') {
          try {
            geminiApiKey = this.adapter.decryptString(Buffer.from(parsed.geminiApiKeyEncrypted, 'base64'));
          } catch {}
        }
      }

      const sttProvider =
        parsed.sttProvider === 'deepgram' || parsed.sttProvider === 'google' || parsed.sttProvider === 'mock'
          ? parsed.sttProvider
          : 'deepgram';

      const screenShareInvisibility =
        parsed.screenShareInvisibility !== undefined ? Boolean(parsed.screenShareInvisibility) : true;

      return {
        sttProvider,
        sttApiKey,
        geminiApiKey,
        screenShareInvisibility,
        preferences: sanitizePreferences(parsed.preferences),
      };
    } catch {
      // Corrupted settings file: keep a copy for support and start from defaults.
      try {
        if (this.filePath) fs.copyFileSync(this.filePath, `${this.filePath}.corrupt`);
      } catch {}
      return defaults;
    }
  }

  private persist(): void {
    if (!this.filePath) return;

    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const dataToSave: Record<string, unknown> = {
        sttProvider: this.cached.sttProvider,
        screenShareInvisibility: this.cached.screenShareInvisibility ?? true,
        preferences: this.getPreferences(),
      };

      if (this.adapter?.isEncryptionAvailable()) {
        if (this.cached.sttApiKey) {
          dataToSave.sttApiKeyEncrypted = this.adapter.encryptString(this.cached.sttApiKey).toString('base64');
        }
        if (this.cached.geminiApiKey) {
          dataToSave.geminiApiKeyEncrypted = this.adapter.encryptString(this.cached.geminiApiKey).toString('base64');
        }
      }
      // No OS encryption available: API keys stay in memory for this run and are NOT written to disk.

      // Atomic write so a crash mid-save cannot leave a truncated settings file.
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(dataToSave, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('[SettingsService] Failed to persist settings', err);
    }
  }
}


function mergeDeep(base: unknown, patch: unknown): unknown {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = mergeDeep(out[key], value);
  }
  return out;
}
