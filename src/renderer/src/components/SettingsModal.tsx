import { useState, useEffect } from 'react';
import type { ClientSettings, UpdateSettingsRequest } from '@shared/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: ClientSettings | null;
  onSave: (updates: UpdateSettingsRequest) => Promise<void>;
}

export function SettingsModal({ isOpen, onClose, settings, onSave }: Props) {
  const [provider, setProvider] = useState<'deepgram' | 'google' | 'mock'>('deepgram');
  const [sttKey, setSttKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (settings) {
      setProvider(settings.sttProvider || 'deepgram');
      setSttKey('');
      setGeminiKey('');
    }
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const updates: UpdateSettingsRequest = {
        sttProvider: provider,
      };

      if (sttKey.trim()) {
        updates.sttApiKey = sttKey.trim();
      }
      if (geminiKey.trim()) {
        updates.geminiApiKey = geminiKey.trim();
      }

      await onSave(updates);
      setSttKey('');
      setGeminiKey('');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings & API Credentials</h3>
          <button className="btn-quiet" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <p className="modal-description">
            Credentials are securely encrypted at rest using Windows DPAPI via Electron{' '}
            <code>safeStorage</code>. Secrets are never exposed to renderer logs.
          </p>

          <div className="field-group">
            <label htmlFor="settings-provider">Speech-to-Text Provider</label>
            <select
              id="settings-provider"
              value={provider}
              onChange={(e) =>
                setProvider(e.target.value as 'deepgram' | 'google' | 'mock')
              }
              className="select-input"
            >
              <option value="deepgram">Deepgram Streaming (WebSocket - Recommended)</option>
              <option value="google">Google Cloud STT</option>
              <option value="mock">Local Energy Simulation (No API Key Required)</option>
            </select>
          </div>

          <div className="field-group">
            <label htmlFor="settings-stt-key">
              Deepgram API Key
              {settings?.hasSttKey ? (
                <span className="field-hint"> · Active ({settings.maskedSttKey})</span>
              ) : (
                <span className="field-hint"> · (or set DEEPGRAM_API_KEY environment variable)</span>
              )}
            </label>
            <input
              id="settings-stt-key"
              type="password"
              value={sttKey}
              onChange={(e) => setSttKey(e.target.value)}
              placeholder={
                settings?.hasSttKey
                  ? 'Enter new key to replace existing'
                  : 'e.g. 4880c54...'
              }
              autoComplete="off"
            />
          </div>

          <div className="field-group">
            <label htmlFor="settings-gemini-key">
              Google Gemini API Key
              {settings?.hasGeminiKey ? (
                <span className="field-hint"> · Active ({settings.maskedGeminiKey})</span>
              ) : (
                <span className="field-hint"> · (for live contextual copilot suggestions)</span>
              )}
            </label>
            <input
              id="settings-gemini-key"
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={
                settings?.hasGeminiKey
                  ? 'Enter new key to replace existing'
                  : 'e.g. AIzaSy...'
              }
              autoComplete="off"
            />
          </div>

          {saveSuccess && (
            <div className="save-badge">
              ✓ Credentials saved securely.
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
