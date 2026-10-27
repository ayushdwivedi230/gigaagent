import type { SessionStatus, SessionSummary } from '@shared/types';

interface Props {
  status: SessionStatus;
  session: SessionSummary | null;
}

type Kind = 'idle' | 'pending' | 'recording' | 'demo';

function describe(status: SessionStatus, session: SessionSummary | null): { kind: Kind; label: string; detail: string } {
  if (status === 'idle' || !session) {
    return { kind: 'idle', label: 'Not recording', detail: 'Nothing is being captured.' };
  }
  if (status === 'starting') {
    return { kind: 'pending', label: 'Starting…', detail: 'Waiting for the transcript source.' };
  }
  if (status === 'stopping') {
    return { kind: 'pending', label: 'Stopping…', detail: 'Finishing the last words.' };
  }
  if (session.source === 'microphone') {
    return {
      kind: 'recording',
      label: 'Recording',
      detail: 'Your microphone is on. Tell other participants you are using an assistant.',
    };
  }
  return { kind: 'demo', label: 'Demo session', detail: 'A scripted transcript is playing. No audio is captured.' };
}

/**
 * Always visible. Red = microphone live, teal = scripted demo, dark = transitioning,
 * neutral = idle. The dot is filled only when real audio is being captured.
 */
export function RecordingBanner({ status, session }: Props) {
  const { kind, label, detail } = describe(status, session);
  return (
    <div className={`banner banner--${kind}`} role="status" aria-live="polite">
      <span className="banner__dot" aria-hidden="true" />
      <strong>{label}</strong>
      <span className="banner__detail">{detail}</span>
    </div>
  );
}
