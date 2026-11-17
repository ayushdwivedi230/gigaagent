import { forwardRef, memo, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from './Icon';

interface AskBarProps {
  value: string;
  onChange: (value: string) => void;
  onAsk: (question: string) => void;
  onCancel: () => void;
  isGenerating: boolean;
  autoAnswer: boolean;
  onToggleAutoAnswer: (value: boolean) => void;
  screenAttached: boolean;
  onRemoveScreen: () => void;
  transcriptLines: number;
  profileName: string | null;
  onQuickCapture: (text: string) => void;
}

/** Quick question input. Enter sends, Shift+Enter adds a line, Ctrl+S saves the text as a note. */
export const AskBar = memo(
  forwardRef<HTMLTextAreaElement, AskBarProps>(function AskBar(props, ref) {
    const { value, onChange, isGenerating } = props;
    const local = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
      const el = local.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    }, [value]);

    const submit = (): void => {
      const q = value.trim();
      if (!q) return;
      props.onAsk(q);
      onChange('');
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) {
        e.preventDefault();
        submit();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && value.trim()) {
        e.preventDefault();
        props.onQuickCapture(value.trim());
        onChange('');
      }
    };

    return (
      <section className="ask" aria-label="Ask GigaAgent">
        <div className="ask__meta">
          <ul className="chips ask__context" aria-label="Context that will be sent with your question">
            {props.screenAttached && (
              <li className="chip chip--accent">
                <Icon name="screen" size={12} />
                Screenshot
                <button type="button" className="chip__x" onClick={props.onRemoveScreen} aria-label="Remove screenshot context">
                  <Icon name="close" size={11} />
                </button>
              </li>
            )}
            {props.transcriptLines > 0 && (
              <li className="chip" title="The most recent transcript lines are sent as context">
                <Icon name="transcript" size={12} />
                Last {props.transcriptLines} line{props.transcriptLines === 1 ? '' : 's'}
              </li>
            )}
            {props.profileName && (
              <li className="chip chip--truncate" title={`Active preparation profile: ${props.profileName}`}>
                <Icon name="user" size={12} />
                <span>{props.profileName}</span>
              </li>
            )}
          </ul>
          <label className="switch" title="Draft answers automatically when a question is heard during a session">
            <input type="checkbox" role="switch" checked={props.autoAnswer} onChange={(e) => props.onToggleAutoAnswer(e.target.checked)} />
            <span className="switch__track" aria-hidden="true" />
            <span className="switch__label">Auto-answer</span>
          </label>
        </div>
        <div className="ask__row">
          <textarea
            ref={(el) => {
              local.current = el;
              if (typeof ref === 'function') ref(el);
              else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = el;
            }}
            className="ask__input"
            rows={1}
            value={value}
            placeholder="Ask a question…"
            aria-label="Question for GigaAgent"
            aria-keyshortcuts="Control+K"
            maxLength={4000}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {isGenerating ? (
            <button type="button" className="btn btn--icon" onClick={props.onCancel} aria-label="Stop generating" title="Stop (Esc)">
              <Icon name="stop" size={15} filled />
            </button>
          ) : (
            <button type="button" className="btn btn--icon btn--primary" onClick={submit} disabled={!value.trim()} aria-label="Send question" title="Send (Enter)">
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
        <p className="ask__hint" aria-hidden="true">
          Enter to send · Shift+Enter for a new line · Ctrl+S saves the text as a note
        </p>
      </section>
    );
  }),
);
