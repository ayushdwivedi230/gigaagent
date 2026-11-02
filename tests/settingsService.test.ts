import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SettingsService } from '../src/main/services/settingsService';
import type { SettingsStorageAdapter } from '../src/main/services/settingsService';

test('SettingsService loads defaults when file does not exist', () => {
  const service = new SettingsService(null, null);
  const settings = service.getSettings();
  assert.equal(settings.sttProvider, 'deepgram');
});

test('SettingsService saves and loads settings with encryption adapter', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'giga-settings-test-'));
  const filePath = path.join(tmpDir, 'settings.json');

  const mockAdapter: SettingsStorageAdapter = {
    isEncryptionAvailable: () => true,
    encryptString: (str: string) => Buffer.from(`enc_${str}`),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc_/, ''),
  };

  const service = new SettingsService(filePath, mockAdapter);
  service.saveSettings({
    sttApiKey: 'test-deepgram-key',
    geminiApiKey: 'test-gemini-key',
    sttProvider: 'google',
  });

  // Verify file on disk is encrypted
  const rawDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.ok(rawDisk.sttApiKeyEncrypted);
  assert.equal(rawDisk.sttApiKey, undefined);

  // Reload in new instance with adapter
  const reloaded = new SettingsService(filePath, mockAdapter);
  const loadedSettings = reloaded.getSettings();
  assert.equal(loadedSettings.sttApiKey, 'test-deepgram-key');
  assert.equal(loadedSettings.geminiApiKey, 'test-gemini-key');
  assert.equal(loadedSettings.sttProvider, 'google');

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
