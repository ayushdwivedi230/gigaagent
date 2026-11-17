import { memo, useEffect, useState } from 'react';
import type { DesktopSourceInfo, ScreenshotData } from '@shared/types';
import { Icon } from './Icon';

interface ScreenContextProps {
  sources: DesktopSourceInfo[];
  selectedSourceId: string | undefined;
  onSelectSource: (id: string | undefined) => void;
  onRefreshSources: () => void;
  pending: ScreenshotData | null;
  active: ScreenshotData | null;
  capturing: boolean;
  cloudAllowed: boolean;
  onCapture: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onClear: () => void;
  onAnalyze: (question: string) => void;
}

const QUICK = ['Explain what is on screen', 'What is the likely cause of this error?', 'Summarise the key information'];

/** Capture → preview → confirm. Nothing leaves this computer until the user confirms. */
export const ScreenContext = memo(function ScreenContext(p: ScreenContextProps) {
  const [question, setQuestion] = useState('');
  useEffect(() => {
    if (p.sources.length === 0) p.onRefreshSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = (q: string): void => {
    const text = q.trim();
    if (!text) return;
    p.onAnalyze(text);
    setQuestion('');
  };

  return (
    <section className="panel screenctx" aria-label="Screen context">
      <header className="panel__head">
        <h2 className="panel__title">Screen context</h2>
      </header>
      <div className="panel__body">
        {!p.cloudAllowed && (
          <p className="callout callout--warn" role="note">
            <Icon name="shield" size={14} />
            Sending screenshots to Gemini is turned off in Settings → Privacy. You can still capture and preview.
          </p>
        )}

        {p.pending ? (
          <div className="shot">
            <h3 className="shot__title">Review before using</h3>
            <img className="shot__img" src={p.pending.dataUrl} alt={`Screenshot of ${p.pending.sourceName}, awaiting your confirmation`} />
            <p className="shot__note">
              {p.pending.sourceName} · {p.pending.width}×{p.pending.height}. If you confirm, this image is sent to Google Gemini with the questions you ask about it. Check it shows nothing private.
            </p>
            <div className="row">
              <button type="button" className="btn btn--primary" onClick={p.onConfirm} disabled={!p.cloudAllowed}>
                <Icon name="check" size={14} />
                Use as context
              </button>
              <button type="button" className="btn" onClick={p.onDiscard}>
                <Icon name="trash" size={14} />
                Discard
              </button>
            </div>
          </div>
        ) : p.active ? (
          <div className="shot">
            <h3 className="shot__title">Attached to your questions</h3>
            <img className="shot__img" src={p.active.dataUrl} alt={`Attached screenshot of ${p.active.sourceName}`} />
            <p className="shot__note">
              {p.active.sourceName} · captured {new Date(p.active.capturedAt).toLocaleTimeString()}
            </p>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                ask(question);
              }}
            >
              <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about this screen…" aria-label="Question about the screenshot" maxLength={4000} />
              <button type="submit" className="btn btn--primary btn--icon" disabled={!question.trim()} aria-label="Ask about the screenshot">
                <Icon name="send" size={15} />
              </button>
            </form>
            <div className="stack">
              {QUICK.map((q) => (
                <button key={q} type="button" className="followup" onClick={() => ask(q)}>
                  <Icon name="chevronRight" size={13} />
                  {q}
                </button>
              ))}
            </div>
            <div className="row">
              <button type="button" className="btn btn--sm" onClick={p.onCapture} disabled={p.capturing}>
                <Icon name="refresh" size={13} />
                Recapture
              </button>
              <button type="button" className="btn btn--sm" onClick={p.onClear}>
                <Icon name="trash" size={13} />
                Remove context
              </button>
            </div>
          </div>
        ) : (
          <div className="empty empty--sm">
            <div className="empty__art" aria-hidden="true">
              <Icon name="screen" size={18} />
            </div>
            <p className="empty__text">Capture a screen or window to ask about code, errors, diagrams, documents or charts. You always preview it first.</p>
          </div>
        )}

        {!p.pending && (
          <div className="capture">
            <label className="field">
              <span className="field__label">Source</span>
              <div className="row">
                <select className="select" value={p.selectedSourceId ?? ''} onChange={(e) => p.onSelectSource(e.target.value || undefined)}>
                  <option value="">Primary screen</option>
                  {p.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.isScreen ? 'Screen: ' : 'Window: '}
                      {s.name.slice(0, 48)}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn" onClick={p.onRefreshSources} aria-label="Refresh list of screens and windows" title="Refresh sources">
                  <Icon name="refresh" size={14} />
                </button>
              </div>
            </label>
            {!p.active && (
              <button type="button" className="btn btn--primary" onClick={p.onCapture} disabled={p.capturing}>
                {p.capturing ? <span className="spinner" aria-hidden="true" /> : <Icon name="screen" size={14} />}
                {p.capturing ? 'Capturing…' : 'Capture'}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
});
