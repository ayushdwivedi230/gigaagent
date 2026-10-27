import { useState } from 'react';
import { formatStartedAt, formatClock, sessionDurationMs } from '@shared/format';
import { MODE_LABELS, SESSION_MODES } from '@shared/types';
import type { SessionMode } from '@shared/types';
import { useAssistant } from './state/useAssistant';
import { useElapsed } from './state/useElapsed';

// window.api is injected by the Electron preload script via contextBridge.
// Safely access it so the page doesn't crash when opened in a plain browser tab.
const winApi = (window as { api?: typeof window.api }).api ?? null;

type BannerKind = 'idle' | 'demo' | 'recording' | 'pending';

export default function App() {
  const assistant = useAssistant();
  const { snapshot } = assistant;
  const active = snapshot.activeSession;
  const inSession = snapshot.status !== 'idle';
  const elapsedMs = useElapsed(active?.startedAt ?? null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [mode, setMode] = useState<SessionMode>('mock-interview');
  const [title, setTitle] = useState('');

  const idle        = snapshot.status === 'idle';
  const running     = snapshot.status === 'active';
  const transitioning = snapshot.status === 'starting' || snapshot.status === 'stopping';

  const handleAction = () => {
    if (idle) {
      void assistant.start(mode, title);
      setTitle('');
    } else if (running) {
      void assistant.stop();
    }
  };

  // ── Banner state ──────────────────────────────────────
  const bannerKind: BannerKind =
    !active || snapshot.status === 'idle' ? 'idle'
    : transitioning ? 'pending'
    : active.source === 'microphone' ? 'recording'
    : 'demo';

  const bannerStatus =
    bannerKind === 'idle'      ? 'Idle'
    : bannerKind === 'pending' ? (snapshot.status === 'starting' ? 'Starting…' : 'Stopping…')
    : bannerKind === 'recording' ? '● Live'
    : '● Demo';

  // ── Segments to display ───────────────────────────────
  const segments = inSession
    ? assistant.liveSegments
    : (assistant.viewing?.segments ?? []);
  const finalCount = segments.filter((s) => s.isFinal).length;

  return (
    <div className="app">

      {/* ── Titlebar (drag region) ── */}
      <div className="titlebar">
        <span className="titlebar__dot" aria-hidden="true" />
        <span className="titlebar__name">AI Assistant</span>
        <span className="titlebar__badge">M1 · Demo</span>
        <div className="titlebar__controls">
          <button
            className="wbtn"
            onClick={() => winApi?.window.minimize()}
            title="Minimize"
            aria-label="Minimize window"
          >
            −
          </button>
          <button
            className="wbtn wbtn--close"
            onClick={() => winApi?.window.close()}
            title="Close"
            aria-label="Close window"
          >
            ×
          </button>
        </div>
      </div>

      {/* ── Status banner ── */}
      <div className={`banner banner--${bannerKind}`} role="status" aria-live="polite">
        <span className="banner__dot" aria-hidden="true" />
        <span className="banner__status">{bannerStatus}</span>
        {active && (
          <span className="banner__detail" title={active.title}>
            &nbsp;· {active.title}
          </span>
        )}
      </div>

      {/* ── Error alert ── */}
      {assistant.error && (
        <div className="alert" role="alert">
          <span className="alert__msg">{assistant.error}</span>
          <button
            className="btn-quiet"
            onClick={assistant.dismissError}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Session controls ── */}
      <div className="controls">
        {/* Elapsed clock */}
        <p className="clock" aria-label={`Elapsed time: ${formatClock(elapsedMs)}`}>
          {formatClock(elapsedMs)}
        </p>

        {/* Mode selector */}
        <div className="modes" role="radiogroup" aria-label="Session type">
          {SESSION_MODES.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              className={`mode-btn${mode === m ? ' mode-btn--active' : ''}`}
              disabled={!idle}
              onClick={() => setMode(m)}
            >
              {m === 'mock-interview' ? 'Interview' : m === 'meeting' ? 'Meeting' : 'Study'}
            </button>
          ))}
        </div>

        {/* Session name */}
        <div className="field">
          <input
            type="text"
            id="session-title"
            value={title}
            placeholder={MODE_LABELS[mode]}
            disabled={!idle}
            maxLength={80}
            aria-label="Session name (optional)"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && idle) handleAction(); }}
          />
        </div>

        {/* Start / Stop button */}
        <button
          id="session-action-btn"
          className={`btn-primary${running ? ' btn-primary--stop' : ''}`}
          disabled={transitioning}
          onClick={handleAction}
          aria-label={running ? 'Stop session' : 'Start session'}
        >
          {running ? (
            <>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden="true">
                <rect x="1.5" y="1.5" width="8" height="8" rx="1.5" />
              </svg>
              Stop Session
            </>
          ) : (
            <>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden="true">
                <path d="M2 1.5v8l7-4z" />
              </svg>
              {transitioning
                ? snapshot.status === 'starting' ? 'Starting…' : 'Stopping…'
                : 'Start Session'}
            </>
          )}
        </button>
      </div>

      {/* ── Transcript ── */}
      <div className="transcript-area">
        <div className="section-label">
          <span>Transcript</span>
          {finalCount > 0 && (
            <span className="section-label__count">
              {finalCount} {finalCount === 1 ? 'line' : 'lines'}
            </span>
          )}
        </div>

        {segments.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon" aria-hidden="true">
              {inSession ? '⏳' : '🎙'}
            </div>
            <p>
              {inSession
                ? 'Listening… first words will appear here.'
                : 'Press Start Session to begin capturing a live transcript.'}
            </p>
          </div>
        ) : (
          <ol
            className="transcript-scroll"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Live transcript"
          >
            {segments.map((seg) => (
              <li
                key={seg.id}
                className={seg.isFinal ? 'line' : 'line line--partial'}
              >
                <time dateTime={`PT${Math.floor(seg.startMs / 1000)}S`}>
                  {formatClock(seg.startMs)}
                </time>
                <p>{seg.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ── History ── */}
      <div className="history-section">
        <button
          className="history-toggle"
          onClick={() => setHistoryOpen((o) => !o)}
          aria-expanded={historyOpen}
          aria-controls="history-list-panel"
        >
          <span className="history-toggle__label">
            History&nbsp;
            <span className="history-toggle__count">({assistant.history.length})</span>
          </span>
          <span
            className={`history-toggle__chevron${historyOpen ? ' history-toggle__chevron--open' : ''}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>

        {historyOpen && (
          <div id="history-list-panel" className="history-list">
            {assistant.history.length === 0 ? (
              <p className="history-empty">No sessions yet.</p>
            ) : (
              assistant.history.map((session) => {
                const dur = sessionDurationMs(session.startedAt, session.endedAt);
                const isSelected = assistant.viewing?.summary.id === session.id;
                return (
                  <div
                    key={session.id}
                    className={`session-item${isSelected ? ' session-item--selected' : ''}`}
                    onClick={() => void assistant.view(session.id)}
                    role="button"
                    tabIndex={0}
                    aria-label={`View session: ${session.title}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') void assistant.view(session.id);
                    }}
                  >
                    <div className="session-info">
                      <div className="session-title">{session.title}</div>
                      <div className="session-meta">
                        {formatStartedAt(session.startedAt)}
                        {dur !== null ? ` · ${formatClock(dur)}` : ' · In progress'}
                        {' · '}
                        {session.segmentCount} {session.segmentCount === 1 ? 'line' : 'lines'}
                      </div>
                    </div>
                    <button
                      className="btn-icon"
                      title={`Delete ${session.title}`}
                      aria-label={`Delete session: ${session.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void assistant.remove(session.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
