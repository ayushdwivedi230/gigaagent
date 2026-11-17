import { useEffect, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { DiagnosticsSnapshot } from '@shared/errorTypes';
import { isValidAccelerator, TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '@shared/settings';
import { ACCENTS, ANSWER_FORMAT_LABELS, ANSWER_FORMATS, MODE_LABELS, SESSION_MODES, SPEAKING_TARGETS, THEMES } from '@shared/types';
import type { AnswerFormat, ClientSettings, DeepPartial, InvisibilityStatus, Preferences, SessionMode, SourceKind, ThemeName, UpdateSettingsRequest } from '@shared/types';
import type { AudioInputDevice } from '../audio/audioCaptureService';
import { msSinceAudio } from '../state/levels';
import { ConfirmDialog, Dialog } from './Dialog';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { LevelMeter } from './LevelMeter';
import { SOURCE_LABELS } from './SessionBar';

export type SettingsSection = 'general' | 'appearance' | 'ai' | 'audio' | 'ghost' | 'privacy' | 'shortcuts' | 'diagnostics';

interface SettingsDialogProps {
  open: boolean;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  settings: ClientSettings | null;
  prefs: Preferences;
  ghost: InvisibilityStatus | null;
  micDevices: AudioInputDevice[];
  sessionActive: boolean;
  onSave: (updates: UpdateSettingsRequest) => Promise<boolean>;
  onPrefs: (patch: DeepPartial<Preferences>) => void;
  onGhost: (enabled: boolean) => void;
  onRefreshMics: () => void;
  onTestGemini: () => Promise<{ title: string; content: string } | undefined>;
  onBackup: () => void;
  onWipe: () => void;
  onAlwaysOnTop: (value: boolean) => void;
}

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'sparkles' },
  { id: 'ai', label: 'AI', icon: 'wand' },
  { id: 'audio', label: 'Audio', icon: 'mic' },
  { id: 'ghost', label: 'Ghost Mode', icon: 'ghost' },
  { id: 'privacy', label: 'Privacy & data', icon: 'shield' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'activity' },
];

const THEME_LABELS: Record<ThemeName, string> = { dark: 'Dark', light: 'Light', 'high-contrast': 'High contrast', system: 'Match system' };

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        {hint && <span className="setting__hint">{hint}</span>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="switch__track" aria-hidden="true" />
    </label>
  );
}

/** Converts a key press into an Electron accelerator string, or null while only modifiers are held. */
export function acceleratorFromEvent(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  const named: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Escape', Enter: 'Enter', '+': 'Plus' };
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const key = named[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  return [...parts, key].join('+');
}

function ShortcutField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (!recording) return;
    if (e.key === 'Tab') return; // never trap keyboard users
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecording(false);
      return;
    }
    const accel = acceleratorFromEvent(e);
    if (!accel) return;
    if (!isValidAccelerator(accel)) {
      setError('Use Ctrl or Alt together with a key.');
      return;
    }
    setError('');
    setRecording(false);
    onChange(accel);
  };
  return (
    <Row label={label} hint={error || hint}>
      <button type="button" className={`kbd-field${recording ? ' kbd-field--rec' : ''}`} onClick={() => setRecording(true)} onBlur={() => setRecording(false)} onKeyDown={onKeyDown} aria-label={`${label}: ${value || 'not set'}. Press Enter to record a new shortcut.`}>
        {recording ? 'Press keys…' : value ? value.replace('CommandOrControl', 'Ctrl').split('+').join(' + ') : 'Not set'}
      </button>
      {value && (
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => onChange('')} aria-label={`Clear shortcut for ${label}`} title="Clear">
          <Icon name="close" size={12} />
        </button>
      )}
    </Row>
  );
}

function KeyField({ label, masked, has, onSave, placeholder }: { label: string; masked: string | undefined; has: boolean; onSave: (value: string) => Promise<boolean>; placeholder: string }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (v: string): Promise<void> => {
    setBusy(true);
    if (await onSave(v)) setValue('');
    setBusy(false);
  };
  return (
    <div className="keyfield">
      <label className="field">
        <span className="field__label">
          {label} <span className={`chip ${has ? 'chip--ok' : 'chip--warn'}`}>{has ? `Saved ${masked ?? ''}` : 'Not set'}</span>
        </span>
        <div className="row">
          <input className="input" type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder={has ? 'Enter a new key to replace' : placeholder} autoComplete="off" spellCheck={false} maxLength={512} />
          <button type="button" className="btn btn--primary" disabled={!value.trim() || busy} onClick={() => void save(value)}>
            Save
          </button>
          {has && (
            <button type="button" className="btn" disabled={busy} onClick={() => void save('')}>
              Remove
            </button>
          )}
        </div>
      </label>
    </div>
  );
}

export function SettingsDialog(p: SettingsDialogProps) {
  const { prefs, settings, ghost } = p;
  const [diag, setDiag] = useState<DiagnosticsSnapshot | null>(null);
  const [test, setTest] = useState<{ state: 'idle' | 'busy' | 'ok' | 'fail'; text: string }>({ state: 'idle', text: '' });
  const [wipe, setWipe] = useState(false);
  const [instructions, setInstructions] = useState(prefs.ai.customInstructions);
  const [, tick] = useState(0);

  useEffect(() => setInstructions(prefs.ai.customInstructions), [prefs.ai.customInstructions, p.open]);

  const loadDiag = async (): Promise<void> => {
    const res = await window.api?.diagnostics.get();
    if (res?.ok) setDiag(res.value);
  };
  useEffect(() => {
    if (!p.open || (p.section !== 'diagnostics' && p.section !== 'audio')) return;
    void loadDiag();
    const timer = setInterval(() => {
      if (p.section === 'diagnostics') void loadDiag();
      else tick((n) => n + 1);
    }, 3000);
    return () => clearInterval(timer);
  }, [p.open, p.section]);

  const runTest = async (): Promise<void> => {
    setTest({ state: 'busy', text: '' });
    const res = await p.onTestGemini();
    setTest(res ? { state: 'ok', text: `${res.title} — ${res.content.slice(0, 120)}` } : { state: 'fail', text: 'The test failed. See the message at the top of the window.' });
  };

  const exportDiag = async (): Promise<void> => {
    const res = await window.api?.diagnostics.export();
    if (res?.ok) setTest({ state: 'ok', text: `Diagnostics saved to ${res.value.exportedPath}` });
  };

  const ghostState = ghost?.state ?? 'off';
  const audioAge = (s: 'mic' | 'system'): string => {
    const ms = msSinceAudio(s);
    return !Number.isFinite(ms) ? 'No audio received yet' : ms < 1500 ? 'Receiving audio' : `Last audio ${Math.round(ms / 1000)} s ago`;
  };

  let body: ReactNode = null;
  switch (p.section) {
    case 'general':
      body = (
        <>
          <Row label="Default mode" hint="Used when the app starts.">
            <select className="select" value={prefs.audio.defaultMode} onChange={(e) => p.onPrefs({ audio: { defaultMode: e.target.value as SessionMode } })} aria-label="Default mode">
              {SESSION_MODES.map((m) => (
                <option key={m} value={m}>{MODE_LABELS[m]}</option>
              ))}
            </select>
          </Row>
          <Row label="Default audio source">
            <select className="select" value={prefs.audio.defaultSource} onChange={(e) => p.onPrefs({ audio: { defaultSource: e.target.value as SourceKind } })} aria-label="Default audio source">
              {(['both', 'microphone', 'system', 'demo'] as const).map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </Row>
          <Row label="Keep compact window on top" hint="The expanded workspace behaves like a normal window.">
            <Toggle checked={prefs.layout.alwaysOnTop} onChange={p.onAlwaysOnTop} label="Keep compact window on top" />
          </Row>
          <Row label="Auto-answer" hint="Draft an answer when a question is heard during a session.">
            <Toggle checked={prefs.ai.autoAnswer} onChange={(v) => p.onPrefs({ ai: { autoAnswer: v } })} label="Auto-answer" />
          </Row>
          <Row label="Default answer format">
            <select className="select" value={prefs.ai.answerFormat} onChange={(e) => p.onPrefs({ ai: { answerFormat: e.target.value as AnswerFormat } })} aria-label="Default answer format">
              {ANSWER_FORMATS.map((f) => (
                <option key={f} value={f}>{ANSWER_FORMAT_LABELS[f]}</option>
              ))}
            </select>
          </Row>
          <Row label="Speaking practice length" hint="Sizes answers to a spoken duration (about 140 words per minute).">
            <select className="select" value={prefs.ai.speakingTargetSec} onChange={(e) => p.onPrefs({ ai: { speakingTargetSec: Number(e.target.value) } })} aria-label="Speaking practice length">
              {SPEAKING_TARGETS.map((s) => (
                <option key={s} value={s}>{s === 0 ? 'Off' : `${s} seconds`}</option>
              ))}
            </select>
          </Row>
        </>
      );
      break;
    case 'appearance':
      body = (
        <>
          <Row label="Theme">
            <div className="segmented" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={prefs.appearance.theme === t} className="segmented__item" onClick={() => p.onPrefs({ appearance: { theme: t } })}>
                  {THEME_LABELS[t]}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Accent colour" hint="Not used in High contrast.">
            <div className="swatches" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={prefs.appearance.accent === a} className="swatch" data-accent={a} onClick={() => p.onPrefs({ appearance: { accent: a } })} aria-label={a} title={a[0]!.toUpperCase() + a.slice(1)}>
                  {prefs.appearance.accent === a && <Icon name="check" size={13} />}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Text size" hint={`${Math.round(prefs.appearance.textScale * 100)}% — layouts reflow up to 200%.`}>
            <input type="range" className="range" min={TEXT_SCALE_MIN} max={TEXT_SCALE_MAX} step={0.05} value={prefs.appearance.textScale} onChange={(e) => p.onPrefs({ appearance: { textScale: Number(e.target.value) } })} aria-label="Text size" aria-valuetext={`${Math.round(prefs.appearance.textScale * 100)} percent`} />
          </Row>
          <Row label="Motion" hint="Reduce removes transitions and animated indicators.">
            <select className="select" value={prefs.appearance.reducedMotion} onChange={(e) => p.onPrefs({ appearance: { reducedMotion: e.target.value as 'system' | 'on' | 'off' } })} aria-label="Motion">
              <option value="system">Match system</option>
              <option value="on">Reduce motion</option>
              <option value="off">Allow motion</option>
            </select>
          </Row>
        </>
      );
      break;
    case 'ai':
      body = (
        <>
          <KeyField label="Gemini API key" masked={settings?.maskedGeminiKey} has={Boolean(settings?.hasGeminiKey)} placeholder="Paste your Gemini API key" onSave={(v) => p.onSave({ geminiApiKey: v })} />
          <div className="row row--wrap">
            <button type="button" className="btn" onClick={() => void runTest()} disabled={!settings?.hasGeminiKey || test.state === 'busy'}>
              {test.state === 'busy' ? <span className="spinner" aria-hidden="true" /> : <Icon name="activity" size={14} />}
              Test connection
            </button>
            <span className="muted">Sends one very small request using your key.</span>
          </div>
          {test.state !== 'idle' && test.state !== 'busy' && (
            <p className={`callout ${test.state === 'ok' ? 'callout--ok' : 'callout--warn'}`} role="status">
              <Icon name={test.state === 'ok' ? 'check' : 'alert'} size={14} />
              {test.text}
            </p>
          )}
          <Row label="Model" hint="Automatic tries the current Flash models in order and falls back if one is unavailable.">
            <select className="select" value={prefs.ai.model} onChange={(e) => p.onPrefs({ ai: { model: e.target.value } })} aria-label="Gemini model">
              <option value="">Automatic</option>
              <option value="gemini-flash-lite-latest">gemini-flash-lite-latest (fastest)</option>
              <option value="gemini-flash-latest">gemini-flash-latest</option>
              <option value="gemini-3.8-flash">gemini-3.8-flash</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
            </select>
          </Row>
          <label className="field">
            <span className="field__label">Custom instructions</span>
            <textarea className="textarea" rows={4} value={instructions} maxLength={2000} onChange={(e) => setInstructions(e.target.value)} onBlur={() => instructions !== prefs.ai.customInstructions && p.onPrefs({ ai: { customInstructions: instructions } })} placeholder="e.g. Use British spelling. Prefer Python for code. Keep answers practical." />
            <span className="setting__hint">Sent with every question as style preferences. {instructions.length}/2000</span>
          </label>
          <Row label="Attach screenshot to automatic answers" hint="Off: a confirmed screenshot is only sent with questions you ask yourself.">
            <Toggle checked={prefs.ai.attachScreenToAuto} onChange={(v) => p.onPrefs({ ai: { attachScreenToAuto: v } })} label="Attach screenshot to automatic answers" />
          </Row>
        </>
      );
      break;
    case 'audio':
      body = (
        <>
          <Row label="Speech-to-text" hint="Local test mode needs no key: it detects speech activity and inserts sample text.">
            <select className="select" value={settings?.sttProvider === 'mock' ? 'mock' : 'deepgram'} onChange={(e) => void p.onSave({ sttProvider: e.target.value as 'deepgram' | 'mock' })} disabled={p.sessionActive} aria-label="Speech-to-text provider">
              <option value="deepgram">Deepgram (cloud)</option>
              <option value="mock">Local test mode</option>
            </select>
          </Row>
          <KeyField label="Deepgram API key" masked={settings?.maskedSttKey} has={Boolean(settings?.hasSttKey)} placeholder="Paste your Deepgram API key" onSave={(v) => p.onSave({ sttApiKey: v })} />
          <Row label="Microphone" hint={p.sessionActive ? 'Applies to the next session.' : 'Device names appear after microphone access has been allowed once.'}>
            <select className="select" value={prefs.audio.micDeviceId ?? ''} onChange={(e) => p.onPrefs({ audio: { micDeviceId: e.target.value || null } })} aria-label="Microphone">
              <option value="">System default</option>
              {p.micDevices.filter((d) => d.deviceId !== 'default').map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
            <button type="button" className="icon-btn" onClick={p.onRefreshMics} aria-label="Refresh microphone list" title="Refresh">
              <Icon name="refresh" size={14} />
            </button>
          </Row>
          <h3 className="section-title">Audio diagnostics</h3>
          <dl className="facts">
            <div><dt>Microphone</dt><dd><LevelMeter source="mic" label="Microphone" active={p.sessionActive} /> {p.sessionActive ? audioAge('mic') : 'Idle'}</dd></div>
            <div><dt>System audio</dt><dd><LevelMeter source="system" label="System audio" active={p.sessionActive} /> {p.sessionActive ? audioAge('system') : 'Idle'}</dd></div>
            <div><dt>Microphone permission</dt><dd>{diag?.microphonePermission ?? '—'}</dd></div>
            <div><dt>Capture</dt><dd>{diag?.audioCaptureStatus ?? '—'}</dd></div>
          </dl>
        </>
      );
      break;
    case 'ghost':
      body = (
        <>
          <Row label="Ghost Mode" hint="Leaves this window out of screen captures made on this computer.">
            <span className={`chip chip--${ghostState === 'active' ? 'ok' : ghostState === 'error' ? 'warn' : 'quiet'}`}>{ghostState === 'active' ? 'On' : ghostState === 'off' ? 'Off' : ghostState === 'applying' ? 'Applying…' : ghostState === 'unsupported' ? 'Unavailable' : 'Error'}</span>
            <Toggle checked={ghostState === 'active'} disabled={!ghost || ghost.supported === false || ghostState === 'applying'} onChange={p.onGhost} label="Ghost Mode" />
          </Row>
          <Row label="Stealth Cursor (Hide on Screen Share)" hint="Suppresses the OS mouse cursor over GigaAgent so participants on Google Meet, Zoom, and Teams cannot see cursor movement. Renders a private in-app cursor visible only to you.">
            <Toggle
              checked={prefs.appearance.stealthCursor ?? true}
              onChange={(v) => p.onPrefs({ appearance: { stealthCursor: v } })}
              label="Stealth Cursor"
            />
          </Row>
          <Row label="Click-Through Mode" hint="Passes through clicks on non-interactive areas directly to background applications.">
            <Toggle
              checked={prefs.layout.clickThrough ?? false}
              onChange={(v) => p.onPrefs({ layout: { clickThrough: v } })}
              label="Click-Through Mode"
            />
          </Row>
          {ghost?.error && (
            <p className="callout callout--warn" role="alert">
              <Icon name="alert" size={14} />
              The operating system rejected the request: {ghost.error}
            </p>
          )}
          <h3 className="section-title">What it does — and does not do</h3>
          <p className="prose">{ghost?.detail ?? 'Status unavailable.'}</p>
          <ul className="prose">
            <li>You stay in control: one click turns it on or off, and the choice is remembered.</li>
            <li>The recording indicator and audio status are always shown to you, whatever this setting is.</li>
            <li>Use GigaAgent only where recording and AI assistance are permitted, and tell other participants.</li>
          </ul>
          <dl className="facts">
            <div><dt>Platform</dt><dd>{ghost?.platform ?? '—'}</dd></div>
            <div><dt>OS mechanism</dt><dd>{ghost?.affinityFlag ?? '—'}</dd></div>
            <div><dt>Last applied</dt><dd>{ghost?.lastAppliedAt ? new Date(ghost.lastAppliedAt).toLocaleString() : '—'}</dd></div>
          </dl>
        </>
      );
      break;
    case 'privacy':
      body = (
        <>
          <p className="prose">Sessions, transcripts, saved items and settings are stored only on this computer. GigaAgent sends no telemetry. Data leaves the computer only for the cloud services you enable below, using your own API keys.</p>
          <Row label="Cloud AI answers (Google Gemini)" hint="Off: no question, transcript or profile text is sent to Gemini.">
            <Toggle checked={prefs.privacy.allowCloudAi} onChange={(v) => p.onPrefs({ privacy: { allowCloudAi: v } })} label="Cloud AI answers" />
          </Row>
          <Row label="Send confirmed screenshots to Gemini" hint="Screenshots are only ever sent after you preview and confirm each one.">
            <Toggle checked={prefs.privacy.allowCloudScreenshots} onChange={(v) => p.onPrefs({ privacy: { allowCloudScreenshots: v } })} label="Send confirmed screenshots to Gemini" />
          </Row>
          <Row label="Cloud transcription (Deepgram)" hint="Off: audio is not sent for transcription; use Local test mode instead.">
            <Toggle checked={prefs.privacy.allowCloudTranscription} onChange={(v) => p.onPrefs({ privacy: { allowCloudTranscription: v } })} label="Cloud transcription" />
          </Row>
          <Row label="API key storage" hint={settings?.credentialStorage === 'os-encrypted' ? 'Encrypted with your Windows account (DPAPI). Keys never reach the interface.' : 'No OS encryption is available, so keys are kept for this run only and never written to disk.'}>
            <span className={`chip ${settings?.credentialStorage === 'os-encrypted' ? 'chip--ok' : 'chip--warn'}`}>{settings?.credentialStorage === 'os-encrypted' ? 'OS-encrypted' : 'Memory only'}</span>
          </Row>
          <h3 className="section-title">Your data</h3>
          <div className="row row--wrap">
            <button type="button" className="btn" onClick={p.onBackup}>
              <Icon name="download" size={14} />
              Back up database…
            </button>
            <button type="button" className="btn btn--danger" onClick={() => setWipe(true)} disabled={p.sessionActive}>
              <Icon name="trash" size={14} />
              Delete all data…
            </button>
          </div>
          <p className="muted">Single sessions can be exported or deleted from History. To restore a backup, close GigaAgent and replace <code>sessions.db</code> in the app data folder.</p>
          <ConfirmDialog open={wipe} title="Delete all data?" message="All sessions, transcripts, answers, notes, prompts and profiles will be permanently deleted from this computer. API keys and preferences are kept." confirmLabel="Delete everything" onConfirm={p.onWipe} onClose={() => setWipe(false)} />
        </>
      );
      break;
    case 'shortcuts':
      body = (
        <>
          <h3 className="section-title">Global (work from any app)</h3>
          <ShortcutField label="Show / hide GigaAgent" hint="Click, then press the keys." value={prefs.shortcuts.toggleWindow} onChange={(v) => p.onPrefs({ shortcuts: { toggleWindow: v } })} />
          <ShortcutField label="Quick ask" hint="Shows the window with the question box focused." value={prefs.shortcuts.quickAsk} onChange={(v) => p.onPrefs({ shortcuts: { quickAsk: v } })} />
          <ShortcutField label="Capture screen context" hint="Takes a screenshot for you to review." value={prefs.shortcuts.captureScreen} onChange={(v) => p.onPrefs({ shortcuts: { captureScreen: v } })} />
          <h3 className="section-title">In the window</h3>
          <dl className="facts facts--keys">
            <div><dt>Focus the question box</dt><dd><kbd>Ctrl</kbd> <kbd>K</kbd></dd></div>
            <div><dt>Start / stop session</dt><dd><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>R</kbd></dd></div>
            <div><dt>Compact ↔ workspace</dt><dd><kbd>Ctrl</kbd> <kbd>E</kbd></dd></div>
            <div><dt>Toggle Ghost Mode</dt><dd><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>H</kbd></dd></div>
            <div><dt>Settings</dt><dd><kbd>Ctrl</kbd> <kbd>,</kbd></dd></div>
            <div><dt>Stop generating / close dialog</dt><dd><kbd>Esc</kbd></dd></div>
            <div><dt>Save question text as a note</dt><dd><kbd>Ctrl</kbd> <kbd>S</kbd></dd></div>
          </dl>
        </>
      );
      break;
    case 'diagnostics':
      body = diag ? (
        <>
          <dl className="facts">
            <div><dt>Version</dt><dd>GigaAgent {diag.appVersion} · Electron {diag.electronVersion} · {diag.osPlatform} {diag.osRelease}</dd></div>
            <div><dt>Audio capture</dt><dd>{diag.audioCaptureStatus}</dd></div>
            <div><dt>AI provider</dt><dd>{diag.aiProviderStatus.replace('_', ' ')}</dd></div>
            <div><dt>Database</dt><dd>{diag.databaseHealth.replace('_', ' ')}</dd></div>
            <div><dt>Ghost Mode</dt><dd>{diag.ghost?.state ?? '—'}</dd></div>
            <div><dt>Microphone permission</dt><dd>{diag.microphonePermission ?? '—'}</dd></div>
            <div><dt>Main process memory</dt><dd>{diag.memory ? `${diag.memory.rssMb} MB (heap ${diag.memory.heapUsedMb} MB)` : '—'}</dd></div>
            {diag.processes?.map((proc, i) => (
              <div key={i}><dt>{proc.type} process</dt><dd>{proc.memoryMb} MB · {proc.cpuPercent}% CPU</dd></div>
            ))}
            <div><dt>AI requests this run</dt><dd>{diag.ai ? `${diag.ai.requests} sent · ${diag.ai.failures} failed · ${diag.ai.cancelled} cancelled` : 'None yet'}</dd></div>
            <div><dt>Last response</dt><dd>{diag.ai?.lastLatencyMs != null ? `${diag.ai.lastLatencyMs} ms · ${diag.ai.lastModel ?? ''}` : '—'}</dd></div>
            <div><dt>Tokens this run</dt><dd>{diag.ai ? `${diag.ai.promptTokens} in · ${diag.ai.outputTokens} out` : '—'}</dd></div>
            <div><dt>Uptime</dt><dd>{Math.floor(diag.uptimeSeconds / 60)} min</dd></div>
          </dl>
          <h3 className="section-title">Recent errors</h3>
          {diag.recentErrors && diag.recentErrors.length > 0 ? (
            <ul className="errors">
              {[...diag.recentErrors].reverse().map((e, i) => (
                <li key={i}>
                  <span className="chip chip--warn">{e.category}</span> {e.userMessage} <time className="muted">{new Date(e.timestamp).toLocaleTimeString()}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No errors recorded in this run.</p>
          )}
          <div className="row row--wrap">
            <button type="button" className="btn" onClick={() => void loadDiag()}>
              <Icon name="refresh" size={14} />
              Refresh
            </button>
            <button type="button" className="btn" onClick={() => void exportDiag()}>
              <Icon name="download" size={14} />
              Export report
            </button>
          </div>
          {test.state === 'ok' && test.text.startsWith('Diagnostics') && <p className="callout callout--ok" role="status">{test.text}</p>}
          <p className="muted">The report contains versions, statuses and error summaries. It never includes API keys, transcripts or screenshots, and is only saved locally.</p>
        </>
      ) : (
        <p className="muted">Diagnostics are available in the desktop app.</p>
      );
      break;
  }

  const current = SECTIONS.find((s) => s.id === p.section)!;
  return (
    <Dialog open={p.open} title="Settings" onClose={p.onClose} size="lg">
      <div className="settings">
        <nav className="settings__nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="settings__tab" aria-current={p.section === s.id ? 'page' : undefined} onClick={() => p.onSection(s.id)}>
              <Icon name={s.icon} size={15} />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <section className="settings__pane" aria-label={current.label}>
          <h3 className="settings__title">{current.label}</h3>
          {body}
        </section>
      </div>
    </Dialog>
  );
}
