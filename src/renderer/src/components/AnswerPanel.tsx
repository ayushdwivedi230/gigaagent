import { memo, useEffect, useRef, useState } from 'react';
import { estimateSpeakingSeconds, formatSpeakingTime } from '@shared/speaking';
import { ANSWER_FORMAT_LABELS, ANSWER_FORMATS, SPEAKING_TARGETS } from '@shared/types';
import type { AnswerAction, AnswerFormat, SuggestionItem } from '@shared/types';
import type { StreamingAnswer } from '../state/useAssistant';
import { Icon } from './Icon';
import { Markdown } from './Markdown';

interface AnswerPanelProps {
  answer: SuggestionItem | null;
  streaming: StreamingAnswer | null;
  format: AnswerFormat;
  speakingTargetSec: number;
  saved: boolean;
  hasKey: boolean;
  onFormat: (format: AnswerFormat) => void;
  onSpeakingTarget: (seconds: number) => void;
  onAction: (answer: SuggestionItem, action: AnswerAction) => void;
  onSave: (answer: SuggestionItem) => void;
  onFollowUp: (question: string) => void;
  onCancel: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
}

const REFINE: Array<{ action: AnswerAction; label: string; hint: string }> = [
  { action: 'simplify', label: 'Simplify', hint: 'Rewrite in simpler language' },
  { action: 'expand', label: 'Expand', hint: 'Add more depth' },
  { action: 'example', label: 'Example', hint: 'Give a concrete example' },
  { action: 'rephrase', label: 'Rephrase', hint: 'Explain it a different way' },
];

function FormatControl({ format, onFormat, disabled }: { format: AnswerFormat; onFormat: (f: AnswerFormat) => void; disabled: boolean }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Answer format">
      {ANSWER_FORMATS.map((f) => (
        <button key={f} type="button" role="radio" aria-checked={format === f} className="segmented__item" disabled={disabled} onClick={() => format !== f && onFormat(f)}>
          {ANSWER_FORMAT_LABELS[f]}
        </button>
      ))}
    </div>
  );
}

export const AnswerPanel = memo(function AnswerPanel(props: AnswerPanelProps) {
  const { answer, streaming, format, speakingTargetSec, saved, hasKey } = props;
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  // Keep the newest streamed text in view unless the reader scrolled up.
  useEffect(() => {
    const el = body.current;
    if (!el || !streaming) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [streaming?.text, streaming]);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    setCopied(false);
  }, [answer?.id]);

  const copy = async (): Promise<void> => {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const controls = (
    <div className="answer__controls">
      <FormatControl format={format} onFormat={props.onFormat} disabled={Boolean(streaming)} />
      <label className="field field--inline answer__speak" title="Speaking practice: size answers to a spoken duration">
        <Icon name="clock" size={14} />
        <span className="sr-only">Speaking practice duration</span>
        <select className="select select--sm" value={speakingTargetSec} onChange={(e) => props.onSpeakingTarget(Number(e.target.value))}>
          {SPEAKING_TARGETS.map((s) => (
            <option key={s} value={s}>
              {s === 0 ? 'No limit' : `${s} sec`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  if (streaming) {
    return (
      <section className="answer answer--streaming" aria-label="AI answer" aria-busy="true">
        <header className="answer__head">
          <div className="answer__eyebrow">
            <span className="spinner" aria-hidden="true" />
            Generating
          </div>
          <p className="answer__question">{streaming.question}</p>
        </header>
        {/* Streamed text is intentionally not a live region: screen readers get one "Answer ready" announcement instead. */}
        <div className="answer__body" ref={body} aria-live="off">
          {streaming.text ? <Markdown source={streaming.text} /> : <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>}
        </div>
        <footer className="answer__foot">
          {controls}
          <button type="button" className="btn btn--sm" onClick={props.onCancel} title="Stop generating (Esc)">
            <Icon name="stop" size={13} filled />
            Stop
          </button>
        </footer>
      </section>
    );
  }

  if (!answer) {
    return (
      <section className="answer answer--empty" aria-label="AI answer">
        <div className="empty">
          <div className="empty__art" aria-hidden="true">
            <Icon name="sparkles" size={22} />
          </div>
          <h2 className="empty__title">{hasKey ? 'Ask anything, or start a session' : 'Connect Gemini to get answers'}</h2>
          <p className="empty__text">
            {hasKey
              ? 'Answers appear here. During a session GigaAgent listens for questions and drafts a response you can refine.'
              : 'Add your Gemini API key to generate answers. Without it, sessions still transcribe and show local tips.'}
          </p>
          {!hasKey && (
            <button type="button" className="btn btn--primary" onClick={props.onOpenSettings}>
              Open AI settings
            </button>
          )}
        </div>
        <footer className="answer__foot">{controls}</footer>
      </section>
    );
  }

  const speakSeconds = estimateSpeakingSeconds(answer.content);
  const isLocalTip = answer.source === 'heuristic';
  return (
    <section className="answer" aria-label="AI answer">
      <header className="answer__head">
        <div className="answer__titlerow">
          <h2 className="answer__title">{answer.title}</h2>
          <button type="button" className="icon-btn icon-btn--sm" onClick={props.onDismiss} aria-label="Clear this answer" title="Clear">
            <Icon name="close" size={14} />
          </button>
        </div>
        {answer.question && answer.question !== answer.title && <p className="answer__question">{answer.question}</p>}
        <ul className="chips" aria-label="Answer details">
          {isLocalTip && <li className="chip chip--warn">Local tip · not AI-generated</li>}
          {answer.answerFormat && <li className="chip">{ANSWER_FORMAT_LABELS[answer.answerFormat]}</li>}
          {speakSeconds > 0 && (
            <li className="chip" title="Estimated at about 140 words per minute; code is excluded">
              <Icon name="clock" size={12} />
              {formatSpeakingTime(speakSeconds)} to say
            </li>
          )}
          {answer.hasVisualContext && (
            <li className="chip chip--accent" title="A screenshot you confirmed was sent with this question">
              <Icon name="screen" size={12} />
              Used screen context
            </li>
          )}
          {answer.modelUsed && <li className="chip chip--quiet">{answer.modelUsed}</li>}
        </ul>
      </header>
      <div className="answer__body" ref={body} tabIndex={0}>
        <Markdown source={answer.content} />
        {answer.followUpSuggestions && answer.followUpSuggestions.length > 0 && (
          <div className="followups">
            <h3 className="followups__title">Follow up</h3>
            {answer.followUpSuggestions.map((q) => (
              <button key={q} type="button" className="followup" onClick={() => props.onFollowUp(q)}>
                <Icon name="chevronRight" size={13} />
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
      <footer className="answer__foot">
        <div className="answer__actions" role="toolbar" aria-label="Answer actions">
          <button type="button" className="btn btn--sm" onClick={() => void copy()}>
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => props.onSave(answer)} aria-pressed={saved} disabled={saved} title={saved ? 'Already in your library' : 'Save to library'}>
            <Icon name="bookmark" size={13} filled={saved} />
            {saved ? 'Saved' : 'Save'}
          </button>
          {!isLocalTip && (
            <>
              <button type="button" className="btn btn--sm" onClick={() => props.onAction(answer, 'regenerate')} title="Generate a fresh answer">
                <Icon name="refresh" size={13} />
                Regenerate
              </button>
              <label className="field field--inline answer__refine">
                <span className="sr-only">Refine this answer</span>
                <select
                  className="select select--sm"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) props.onAction(answer, e.target.value as AnswerAction);
                  }}
                  title="Refine this answer"
                >
                  <option value="">Refine…</option>
                  {REFINE.map((r) => (
                    <option key={r.action} value={r.action}>
                      {r.label} — {r.hint.toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        {controls}
      </footer>
    </section>
  );
});
