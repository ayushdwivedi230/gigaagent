import { memo } from 'react';
import { formatClock } from '@shared/format';
import { MODE_LABELS, SESSION_MODES } from '@shared/types';
import type { SessionMode, SessionSnapshot, SourceKind } from '@shared/types';
import { useElapsed } from '../state/useElapsed';
import { Icon } from './Icon';
import { LevelMeter } from './LevelMeter';

export const SOURCE_LABELS: Record<SourceKind, string> = {
  both: 'Mic + system audio',
  microphone: 'Microphone',
  system: 'System audio',
  demo: 'Demo (no audio)',
};

interface SessionBarProps {
  snapshot: SessionSnapshot;
  mode: SessionMode;
  source: SourceKind;
  micLabel: string | null;
  onMode: (mode: SessionMode) => void;
  onSource: (source: SourceKind) => void;
  onStart: () => void;
  onStop: () => void;
  onPause: (paused: boolean) => void;
}

/** Session control + the always-visible recording indicator (text + icon, never colour alone). */
export const SessionBar = memo(function SessionBar({ snapshot, mode, source, micLabel, onMode, onSource, onStart, onStop, onPause }: SessionBarProps) {
  const { status, activeSession, paused } = snapshot;
  const elapsedMs = useElapsed(activeSession?.startedAt ?? null);
  const live = status === 'active' && activeSession;

  if (live) {
    const src = activeSession.source;
    const capturing = src !== 'demo';
    const label = paused ? 'Paused' : capturing ? 'Recording' : 'Demo session';
    return (
      <section className={`sessionbar sessionbar--live${paused ? ' sessionbar--paused' : ''}`} aria-label="Session">
        <div className="rec" role="status">
          <span className={`rec__dot${paused ? ' rec__dot--paused' : ''}`} aria-hidden="true" />
          <span className="rec__label">{label}</span>
          <span className="rec__time" aria-label={`Elapsed ${formatClock(elapsedMs)}`}>
            {formatClock(elapsedMs)}
          </span>
        </div>
        <div className="sessionbar__meters">
          {(src === 'microphone' || src === 'both') && <LevelMeter source="mic" label={micLabel ? `Microphone: ${micLabel}` : 'Microphone'} active={!paused} />}
          {(src === 'system' || src === 'both') && <LevelMeter source="system" label="System audio" active={!paused} />}
          <span className="sessionbar__mode">{MODE_LABELS[activeSession.mode]}</span>
        </div>
        <div className="sessionbar__buttons">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => onPause(!paused)}
            aria-pressed={Boolean(paused)}
            title={paused ? 'Resume listening' : 'Pause: audio is discarded while paused (the device stays open)'}
          >
            <Icon name={paused ? 'play' : 'pause'} size={14} />
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="btn btn--sm btn--stop" onClick={onStop} title="Stop and save session (Ctrl+Shift+R)">
            <Icon name="stop" size={14} filled />
            Stop
          </button>
        </div>
      </section>
    );
  }

  const busy = status === 'starting' || status === 'stopping';
  return (
    <section className="sessionbar" aria-label="Session">
      <label className="field field--inline">
        <span className="sr-only">Mode</span>
        <select className="select" value={mode} onChange={(e) => onMode(e.target.value as SessionMode)} disabled={busy} title="Assistant mode">
          {SESSION_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="field field--inline">
        <span className="sr-only">Audio source</span>
        <select className="select" value={source} onChange={(e) => onSource(e.target.value as SourceKind)} disabled={busy} title="What to listen to">
          {(['both', 'microphone', 'system', 'demo'] as const).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn--primary" onClick={onStart} disabled={busy} title="Start session (Ctrl+Shift+R)">
        {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="play" size={14} filled />}
        {status === 'starting' ? 'Starting…' : status === 'stopping' ? 'Saving…' : 'Start'}
      </button>
    </section>
  );
});
