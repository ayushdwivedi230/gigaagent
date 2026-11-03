import type { SourceKind } from '@shared/types';
import { formatClock } from '@shared/format';

interface AudioBarProps {
  source: SourceKind;
  onSelectSource: (src: SourceKind) => void;
  isRunning: boolean;
  isTransitioning: boolean;
  onToggleSession: () => void;
  elapsedMs: number;
}

export function AudioBar({
  source,
  onSelectSource,
  isRunning,
  isTransitioning,
  onToggleSession,
  elapsedMs,
}: AudioBarProps) {
  return (
    <div className="audio-bar">
      {/* ── Audio Source Segmented Control ── */}
      <div className="audio-sources" role="radiogroup" aria-label="Audio capture source">
        <button
          type="button"
          role="radio"
          aria-checked={source === 'microphone'}
          className={`audio-source-btn${source === 'microphone' ? ' audio-source-btn--active' : ''}`}
          disabled={isRunning}
          onClick={() => onSelectSource('microphone')}
          title="Capture Microphone audio (You)"
        >
          <span className="source-icon">🎙</span>
          <span className="source-label">Mic</span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={source === 'system'}
          className={`audio-source-btn${source === 'system' ? ' audio-source-btn--active' : ''}`}
          disabled={isRunning}
          onClick={() => onSelectSource('system')}
          title="Capture Windows System playback audio (Meeting)"
        >
          <span className="source-icon">🔊</span>
          <span className="source-label">System</span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={source === 'both'}
          className={`audio-source-btn${source === 'both' ? ' audio-source-btn--active' : ''}`}
          disabled={isRunning}
          onClick={() => onSelectSource('both')}
          title="Capture both Microphone & System playback audio"
        >
          <span className="source-icon">🎙+🔊</span>
          <span className="source-label">Both</span>
        </button>
      </div>

      {/* ── Clock indicator ── */}
      {isRunning && (
        <div className="session-clock" aria-label={`Elapsed time: ${formatClock(elapsedMs)}`}>
          <span className="recording-indicator-dot" />
          <span>{formatClock(elapsedMs)}</span>
        </div>
      )}

      {/* ── Session Start / Stop Action Button ── */}
      <button
        type="button"
        className={`session-cta-btn${isRunning ? ' session-cta-btn--stop' : ''}`}
        disabled={isTransitioning}
        onClick={onToggleSession}
        aria-label={isRunning ? 'Stop session' : 'Start session'}
      >
        {isTransitioning ? (
          <span className="spinner-icon" />
        ) : isRunning ? (
          <>
            <span className="cta-icon-stop" />
            <span>Stop</span>
          </>
        ) : (
          <>
            <span className="cta-icon-start">▶</span>
            <span>Start</span>
          </>
        )}
      </button>
    </div>
  );
}

