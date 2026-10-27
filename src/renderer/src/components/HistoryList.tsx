import { useState } from 'react';
import { formatClock, formatStartedAt, sessionDurationMs } from '@shared/format';
import { MODE_LABELS } from '@shared/types';
import type { SessionSummary } from '@shared/types';

interface Props {
  sessions: SessionSummary[];
  selectedId: string | null;
  activeId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

function details(session: SessionSummary): string {
  const duration = sessionDurationMs(session.startedAt, session.endedAt);
  // The stored line count only updates when a session's status changes, so don't show it mid-session.
  if (duration === null) return `${MODE_LABELS[session.mode]}, in progress`;
  const lines = `${session.segmentCount} ${session.segmentCount === 1 ? 'line' : 'lines'}`;
  return `${MODE_LABELS[session.mode]}, ${formatClock(duration)}, ${lines}`;
}

export function HistoryList({ sessions, selectedId, activeId, busy, onOpen, onDelete, onClear }: Props) {
  // Deletion is always a two-step action so one stray click cannot remove a session.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);

  return (
    <section className="history" aria-label="Session history">
      <div className="history__head">
        <h2>History</h2>
        {sessions.length > 0 &&
          (confirmingAll ? (
            <span className="confirm">
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  setConfirmingAll(false);
                  onClear();
                }}
              >
                Delete all {sessions.length}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setConfirmingAll(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn--quiet"
              disabled={activeId !== null}
              title={activeId ? 'Stop the current session first' : undefined}
              onClick={() => setConfirmingAll(true)}
            >
              Delete all
            </button>
          ))}
      </div>

      {sessions.length === 0 ? (
        <p className="history__empty">Finished sessions are saved here, on this computer only.</p>
      ) : (
        <ul className="sessions">
          {sessions.map((session) => {
            const isActive = session.id === activeId;
            const confirming = confirmingId === session.id;
            return (
              <li key={session.id} className={session.id === selectedId ? 'session session--selected' : 'session'}>
                <button
                  type="button"
                  className="session__open"
                  disabled={busy || isActive}
                  aria-current={session.id === selectedId ? 'true' : undefined}
                  onClick={() => onOpen(session.id)}
                >
                  <span className="session__title">{session.title}</span>
                  <span className="session__meta">{formatStartedAt(session.startedAt)}</span>
                  <span className="session__meta">{details(session)}</span>
                </button>
                {!isActive &&
                  (confirming ? (
                    <span className="confirm">
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => {
                          setConfirmingId(null);
                          onDelete(session.id);
                        }}
                      >
                        Delete session
                      </button>
                      <button type="button" className="btn btn--quiet" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--quiet session__delete"
                      aria-label={`Delete ${session.title}`}
                      onClick={() => setConfirmingId(session.id)}
                    >
                      Delete
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
