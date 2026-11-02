import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, ClientSettings, UpdateSettingsRequest } from '@shared/types';

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
    };
  }

  saveSettings(updates: UpdateSettingsRequest): ClientSettings {
    if (updates.sttProvider) {
      this.cached.sttProvider = updates.sttProvider;
    }
    if (updates.sttApiKey !== undefined) {
      this.cached.sttApiKey = updates.sttApiKey.trim();
    }
    if (updates.geminiApiKey !== undefined) {
      this.cached.geminiApiKey = updates.geminiApiKey.trim();
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
    };

    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return defaults;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      let sttApiKey = (parsed.sttApiKey as string) || defaults.sttApiKey;
      let geminiApiKey = (parsed.geminiApiKey as string) || defaults.geminiApiKey;

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

      return {
        sttProvider,
        sttApiKey,
        geminiApiKey,
      };
    } catch {
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
      };

      if (this.adapter?.isEncryptionAvailable()) {
        if (this.cached.sttApiKey) {
          dataToSave.sttApiKeyEncrypted = this.adapter.encryptString(this.cached.sttApiKey).toString('base64');
        }
        if (this.cached.geminiApiKey) {
          dataToSave.geminiApiKeyEncrypted = this.adapter.encryptString(this.cached.geminiApiKey).toString('base64');
        }
      } else {
        dataToSave.sttApiKey = this.cached.sttApiKey;
        dataToSave.geminiApiKey = this.cached.geminiApiKey;
      }

      fs.writeFileSync(this.filePath, JSON.stringify(dataToSave, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SettingsService] Failed to persist settings', err);
    }
  }
}

