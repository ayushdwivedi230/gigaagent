import { memo, useState } from 'react';
import { formatClock } from '@shared/format';
import { toolsForMode } from '@shared/modeTools';
import { MODE_LABELS } from '@shared/types';
import type { ModeToolId, SessionMode, SessionSnapshot, SuggestionItem } from '@shared/types';
import { useElapsed } from '../state/useElapsed';
import { Icon } from './Icon';
import { SOURCE_LABELS } from './SessionBar';

interface InsightsPanelProps {
  mode: SessionMode;
  snapshot: SessionSnapshot;
  answers: SuggestionItem[];
  activeId: string | null;
  busy: boolean;
  finalLines: number;
  onRunTool: (tool: ModeToolId, input?: string) => void;
  onSelect: (answer: SuggestionItem) => void;
}

const TYPE_LABEL: Record<SuggestionItem['type'], string> = { answer_tip: 'Answer', action_item: 'Actions', key_point: 'Insight', follow_up: 'Follow-up' };

/** Mode tools, session facts and the running list of answers and insights. */
export const InsightsPanel = memo(function InsightsPanel({ mode, snapshot, answers, activeId, busy, finalLines, onRunTool, onSelect }: InsightsPanelProps) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const tools = toolsForMode(mode);
  const session = snapshot.activeSession;
  const elapsed = useElapsed(session?.startedAt ?? null);
  const material = text.trim();

  return (
    <section className="panel insights" aria-label="Insights">
      <header className="panel__head">
        <h2 className="panel__title">{MODE_LABELS[mode]} tools</h2>
      </header>
      <div className="panel__body">
        <div className="toolgrid">
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tool"
              disabled={busy}
              onClick={() => onRunTool(t.id, material || undefined)}
              title={`${t.description}${material ? ' (uses your pasted text)' : t.input === 'transcript' ? ' (uses the transcript)' : ' (uses the transcript, or pasted text)'}`}
            >
              <span className="tool__label">{t.label}</span>
              <span className="tool__desc">{t.description}</span>
            </button>
          ))}
        </div>
        <button type="button" className="disclosure" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
          Work on pasted text instead of the transcript
        </button>
        {open && (
          <textarea className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste notes, an answer you want feedback on, or study material…" aria-label="Text for the tools to work on" maxLength={24000} />
        )}

        <h3 className="section-title">Session</h3>
        {session ? (
          <dl className="facts">
            <div><dt>Mode</dt><dd>{MODE_LABELS[session.mode]}</dd></div>
            <div><dt>Listening to</dt><dd>{SOURCE_LABELS[session.source]}</dd></div>
            <div><dt>Elapsed</dt><dd>{formatClock(elapsed)}</dd></div>
            <div><dt>Transcript lines</dt><dd>{finalLines}</dd></div>
            <div><dt>Status</dt><dd>{snapshot.paused ? 'Paused' : 'Active'}</dd></div>
          </dl>
        ) : (
          <p className="muted">No session is running. Tools can still work on pasted text or a session opened from History.</p>
        )}

        <h3 className="section-title">
          Answers &amp; insights <span className="panel__count">{answers.length}</span>
        </h3>
        {answers.length === 0 ? (
          <p className="muted">Answers, tips and tool results from this run collect here.</p>
        ) : (
          <ul className="cards">
            {answers.map((a) => (
              <li key={a.id}>
                <button type="button" className={`card${a.id === activeId ? ' card--active' : ''}`} onClick={() => onSelect(a)} aria-current={a.id === activeId ? 'true' : undefined}>
                  <span className="card__kind">
                    {a.source === 'heuristic' ? 'Local tip' : TYPE_LABEL[a.type]}
                    <time>{new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </span>
                  <span className="card__title">{a.title}</span>
                  <span className="card__text">{a.content.replace(/[#*`>|]/g, '').slice(0, 110)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
});
