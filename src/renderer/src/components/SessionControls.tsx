import { useState } from 'react';
import type { FormEvent } from 'react';
import { formatClock } from '@shared/format';
import { MAX_TITLE_LENGTH } from '@shared/validation';
import { MODE_LABELS, SESSION_MODES } from '@shared/types';
import type { SessionMode, SessionStatus } from '@shared/types';

interface Props {
  status: SessionStatus;
  elapsedMs: number;
  onStart: (mode: SessionMode, title: string) => void;
  onStop: () => void;
}

const BUTTON_LABEL: Record<SessionStatus, string> = {
  idle: 'Start session',
  starting: 'Starting…',
  active: 'Stop session',
  stopping: 'Stopping…',
};

export function SessionControls({ status, elapsedMs, onStart, onStop }: Props) {
  const [mode, setMode] = useState<SessionMode>('mock-interview');
  const [title, setTitle] = useState('');
  const idle = status === 'idle';
  const running = status === 'active';
  const transitioning = status === 'starting' || status === 'stopping';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (idle) {
      onStart(mode, title);
      setTitle(''); // a new session should not silently inherit the last name
    } else if (running) {
      onStop();
    }
  };

  return (
    <form className="controls" onSubmit={submit}>
      <p className="clock" aria-label="Elapsed time" aria-live="off">
        {formatClock(elapsedMs)}
      </p>

      <fieldset className="modes" disabled={!idle}>
        <legend className="visually-hidden">Session type</legend>
        {SESSION_MODES.map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            <span>{MODE_LABELS[value]}</span>
          </label>
        ))}
      </fieldset>

      <label className="field">
        <span className="field__label">Session name</span>
        <input
          type="text"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          placeholder={MODE_LABELS[mode]}
          disabled={!idle}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <button
        type="submit"
        className={running ? 'btn btn--stop' : 'btn btn--primary'}
        disabled={transitioning}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          {running ? <rect x="2" y="2" width="10" height="10" rx="1.5" /> : <path d="M3 1.5v11l9-5.5z" />}
        </svg>
        {BUTTON_LABEL[status]}
      </button>

      <p className="note">
        This version plays a scripted demo transcript. Microphone capture arrives in the next milestone.
      </p>
    </form>
  );
}
