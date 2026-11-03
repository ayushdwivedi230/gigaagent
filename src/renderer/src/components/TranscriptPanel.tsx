import { useEffect, useRef } from 'react';
import type { TranscriptSegment } from '@shared/types';
import { formatClock } from '@shared/format';

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  isRunning: boolean;
  onAskAboutSegment?: (text: string) => void;
  onClear?: () => void;
}

export function TranscriptPanel({
  segments,
  isRunning,
  onAskAboutSegment,
  onClear,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const isScrolledToBottom = useRef(true);

  const lastSegment = segments[segments.length - 1];

  // Auto-scroll to latest speech unless user scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isScrolledToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [segments.length, lastSegment?.text]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isScrolledToBottom.current = distanceToBottom < 40;
  };

  return (
    <div className="transcript-section">
      <div className="transcript-header">
        <div className="transcript-title-wrap">
          <span className="transcript-title">Live Transcript</span>
          {segments.length > 0 && (
            <span className="transcript-count">{segments.length}</span>
          )}
        </div>

        {segments.length > 0 && onClear && (
          <button
            type="button"
            className="transcript-clear-btn"
            onClick={onClear}
            title="Clear transcript"
            aria-label="Clear transcript"
          >
            Clear
          </button>
        )}
      </div>

      {segments.length === 0 ? (
        <div className="transcript-empty">
          <span className="transcript-empty-icon">{isRunning ? '🎙' : '⏳'}</span>
          <p className="transcript-empty-msg">
            {isRunning
              ? 'Listening… speech will appear here automatically.'
              : 'Start a session to capture live conversation speech.'}
          </p>
        </div>
      ) : (
        <ol
          ref={scrollRef}
          onScroll={handleScroll}
          className="transcript-list"
          role="log"
          aria-live="polite"
        >
          {segments.map((s) => {
            const isUser = s.speaker === 'user';
            return (
              <li
                key={s.id}
                className={`transcript-item${s.isFinal ? '' : ' transcript-item--interim'}`}
              >
                <div className="transcript-item-meta">
                  <span
                    className={`speaker-badge ${
                      isUser ? 'speaker-badge--you' : 'speaker-badge--meeting'
                    }`}
                  >
                    {isUser ? 'You' : 'Meeting'}
                  </span>
                  <time className="transcript-time">{formatClock(s.startMs)}</time>
                  {onAskAboutSegment && (
                    <button
                      type="button"
                      className="transcript-ask-btn"
                      onClick={() => onAskAboutSegment(s.text)}
                      title="Ask AI to answer or expand on this"
                      aria-label="Ask AI about this line"
                    >
                      ✦ Ask AI
                    </button>
                  )}
                </div>
                <p className="transcript-text">{s.text}</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
