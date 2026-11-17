import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { formatClock } from '@shared/format';
import type { TranscriptSegment } from '@shared/types';
import { Icon } from './Icon';

interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  live: boolean;
  onAsk?: (text: string) => void;
  onClear?: () => void;
  title?: string;
}

const Row = memo(function Row({ segment, onAsk }: { segment: TranscriptSegment; onAsk?: ((text: string) => void) | undefined }) {
  const other = segment.speaker === 'system';
  return (
    <li className={`tline${other ? ' tline--other' : ''}${segment.isFinal ? '' : ' tline--interim'}`}>
      <span className="tline__meta">
        <span className="tline__speaker" title={other ? 'Heard through system audio' : 'Heard through your microphone'}>
          {other ? 'Other' : 'You'}
        </span>
        <time className="tline__time">{formatClock(segment.startMs)}</time>
      </span>
      <span className="tline__text">{segment.text}</span>
      {onAsk && segment.isFinal && (
        <button type="button" className="icon-btn icon-btn--sm tline__ask" onClick={() => onAsk(segment.text)} aria-label={`Ask about: ${segment.text.slice(0, 60)}`} title="Ask about this">
          <Icon name="sparkles" size={13} />
        </button>
      )}
    </li>
  );
});

/**
 * Transcript with search. Rows use CSS content-visibility so thousands of lines stay cheap to
 * lay out; the list sticks to the newest line unless the reader has scrolled up.
 */
export const TranscriptPanel = memo(function TranscriptPanel({ segments, live, onAsk, onClear, title = 'Transcript' }: TranscriptPanelProps) {
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? segments.filter((s) => s.text.toLowerCase().includes(q)) : segments;
  }, [segments, query]);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned && !query) el.scrollTop = el.scrollHeight;
  }, [visible, pinned, query]);

  const onScroll = (): void => {
    const el = scroller.current;
    if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  return (
    <section className="panel transcript" aria-label={title}>
      <header className="panel__head">
        <h2 className="panel__title">{title}</h2>
        <span className="panel__count">{segments.filter((s) => s.isFinal).length}</span>
        <div className="search">
          <Icon name="search" size={13} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label={`Search ${title.toLowerCase()}`} />
        </div>
        {onClear && segments.length > 0 && (
          <button type="button" className="icon-btn icon-btn--sm" onClick={onClear} aria-label="Clear transcript view" title="Clear view (saved history is kept)">
            <Icon name="trash" size={13} />
          </button>
        )}
      </header>
      <div className="panel__body" ref={scroller} onScroll={onScroll} tabIndex={0}>
        {visible.length === 0 ? (
          <div className="empty empty--sm">
            <div className="empty__art" aria-hidden="true">
              <Icon name="transcript" size={18} />
            </div>
            <p className="empty__text">
              {query ? 'No lines match your search.' : live ? 'Listening… speech will appear here.' : 'Start a session to see the live transcript.'}
            </p>
          </div>
        ) : (
          <ol className="tlines">
            {visible.map((s) => (
              <Row key={s.id} segment={s} onAsk={onAsk} />
            ))}
          </ol>
        )}
      </div>
      {!pinned && !query && live && (
        <button type="button" className="btn btn--sm jump" onClick={() => setPinned(true)}>
          <Icon name="chevronDown" size={13} />
          Jump to latest
        </button>
      )}
    </section>
  );
});
