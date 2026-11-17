import { memo, useEffect, useState } from 'react';
import { formatClock, formatStartedAt, sessionDurationMs } from '@shared/format';
import { MODE_LABELS } from '@shared/types';
import type { ExportFormat, SessionDetail, SessionSummary, SuggestionItem, TranscriptSearchHit } from '@shared/types';
import { ConfirmDialog } from './Dialog';
import { Icon } from './Icon';
import { TranscriptPanel } from './TranscriptPanel';

interface HistoryPanelProps {
  history: SessionSummary[];
  viewing: SessionDetail | null;
  activeSessionId: string | null;
  onView: (id: string) => void;
  onCloseView: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onExport: (id: string, format: ExportFormat) => void;
  onSearch: (query: string) => Promise<TranscriptSearchHit[]>;
  onSelectAnswer: (answer: SuggestionItem) => void;
}

/** Searchable session history with export and deletion. */
export const HistoryPanel = memo(function HistoryPanel(p: HistoryPanelProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<TranscriptSearchHit[] | null>(null);
  const [confirm, setConfirm] = useState<{ id?: string; title: string } | null>(null);
  const { onSearch } = p;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void onSearch(q).then((result) => {
        if (!cancelled) setHits(result);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, onSearch]);

  if (p.viewing) {
    const { summary, segments, suggestions = [] } = p.viewing;
    const duration = sessionDurationMs(summary.startedAt, summary.endedAt);
    return (
      <section className="panel history" aria-label={`Session: ${summary.title}`}>
        <header className="panel__head">
          <button type="button" className="icon-btn icon-btn--sm" onClick={p.onCloseView} aria-label="Back to history">
            <Icon name="chevronLeft" size={14} />
          </button>
          <div className="history__heading">
            <h2 className="panel__title">{summary.title}</h2>
            <p className="muted">
              {formatStartedAt(summary.startedAt)} · {MODE_LABELS[summary.mode]}
              {duration !== null ? ` · ${formatClock(duration)}` : ''}
            </p>
          </div>
        </header>
        <div className="row row--wrap history__actions">
          <label className="field field--inline">
            <span className="sr-only">Export format</span>
            <select
              className="select select--sm"
              value=""
              onChange={(e) => {
                if (e.target.value) p.onExport(summary.id, e.target.value as ExportFormat);
              }}
              aria-label="Export this session"
            >
              <option value="">Export…</option>
              <option value="markdown">Markdown (.md)</option>
              <option value="text">Plain text (.txt)</option>
              <option value="json">JSON (.json)</option>
            </select>
          </label>
          <button type="button" className="btn btn--sm" onClick={() => setConfirm({ id: summary.id, title: summary.title })} disabled={summary.id === p.activeSessionId}>
            <Icon name="trash" size={13} />
            Delete
          </button>
        </div>
        <TranscriptPanel segments={segments} live={false} title="Session transcript" />
        {suggestions.length > 0 && (
          <div className="history__answers">
            <h3 className="section-title">
              Answers <span className="panel__count">{suggestions.length}</span>
            </h3>
            <ul className="cards">
              {suggestions.map((a) => (
                <li key={a.id}>
                  <button type="button" className="card" onClick={() => p.onSelectAnswer(a)}>
                    <span className="card__title">{a.title}</span>
                    <span className="card__text">{a.content.replace(/[#*`>|]/g, '').slice(0, 100)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ConfirmDialog
          open={confirm !== null}
          title="Delete this session?"
          message={`"${confirm?.title ?? ''}" and its transcript and answers will be permanently deleted.`}
          confirmLabel="Delete session"
          onConfirm={() => confirm?.id && p.onDelete(confirm.id)}
          onClose={() => setConfirm(null)}
        />
      </section>
    );
  }

  return (
    <section className="panel history" aria-label="History">
      <header className="panel__head">
        <h2 className="panel__title">History</h2>
        <span className="panel__count">{p.history.length}</span>
        <div className="search">
          <Icon name="search" size={13} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all transcripts" aria-label="Search all transcripts" />
        </div>
      </header>
      <div className="panel__body">
        {hits !== null ? (
          hits.length === 0 ? (
            <p className="muted">No transcript lines match “{query.trim()}”.</p>
          ) : (
            <ul className="cards" aria-label="Search results">
              {hits.map((h) => (
                <li key={`${h.sessionId}-${h.segmentId}`}>
                  <button type="button" className="card" onClick={() => p.onView(h.sessionId)}>
                    <span className="card__kind">
                      {h.sessionTitle}
                      <time>{formatClock(h.startMs)}</time>
                    </span>
                    <span className="card__text">
                      <strong>{h.speaker === 'system' ? 'Other' : 'You'}:</strong> {h.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : p.history.length === 0 ? (
          <div className="empty empty--sm">
            <div className="empty__art" aria-hidden="true">
              <Icon name="history" size={18} />
            </div>
            <p className="empty__text">Finished sessions are saved here on this computer. You can search, export or delete them at any time.</p>
          </div>
        ) : (
          <>
            <ul className="cards">
              {p.history.map((s) => {
                const duration = sessionDurationMs(s.startedAt, s.endedAt);
                return (
                  <li key={s.id}>
                    <button type="button" className="card" onClick={() => p.onView(s.id)}>
                      <span className="card__kind">
                        {MODE_LABELS[s.mode]}
                        <time>{formatStartedAt(s.startedAt)}</time>
                      </span>
                      <span className="card__title">{s.title}</span>
                      <span className="card__text">
                        {s.id === p.activeSessionId ? 'In progress' : duration !== null ? formatClock(duration) : 'Not finished'} · {s.segmentCount} line{s.segmentCount === 1 ? '' : 's'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="btn btn--sm btn--ghost history__clear" onClick={() => setConfirm({ title: 'all' })} disabled={p.activeSessionId !== null}>
              <Icon name="trash" size={13} />
              Delete all history
            </button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title="Delete all history?"
        message="Every saved session, transcript and answer will be permanently deleted. Library items are kept."
        confirmLabel="Delete all"
        onConfirm={p.onClearAll}
        onClose={() => setConfirm(null)}
      />
    </section>
  );
});
