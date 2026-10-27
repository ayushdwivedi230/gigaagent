import { useEffect, useRef } from 'react';
import { formatClock } from '@shared/format';
import type { TranscriptSegment } from '@shared/types';

interface Props {
  heading: string;
  meta: string | null;
  segments: TranscriptSegment[];
  live: boolean;
  onClose?: (() => void) | undefined;
}

const STICK_THRESHOLD_PX = 48;

export function TranscriptPanel({ heading, meta, segments, live, onClose }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  const stuckToBottom = useRef(true);
  const last = segments[segments.length - 1];

  // Follow the live edge unless the reader has scrolled up to re-read something.
  useEffect(() => {
    const el = listRef.current;
    if (el && live && stuckToBottom.current) el.scrollTop = el.scrollHeight;
  }, [segments.length, last?.text, live]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };

  return (
    <section className="stage__panel" aria-label="Transcript">
      <header className="stage__head">
        <div>
          <h1>{heading}</h1>
          {meta && <p className="stage__meta">{meta}</p>}
        </div>
        {onClose && (
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Close transcript
          </button>
        )}
      </header>

      {segments.length === 0 ? (
        <div className="empty">
          <p>
            {live
              ? 'Waiting for the first words…'
              : 'Start a session to see the transcript here. Every line is timestamped from the moment you press Start.'}
          </p>
        </div>
      ) : (
        <ol className="transcript" ref={listRef} onScroll={onScroll} role="log" aria-relevant="additions">
          {segments.map((segment) => (
            <li key={segment.id} className={segment.isFinal ? 'line' : 'line line--partial'}>
              <time>{formatClock(segment.startMs)}</time>
              <p>{segment.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
