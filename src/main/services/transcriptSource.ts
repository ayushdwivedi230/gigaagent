import type { AppError, RawSegment, SourceKind } from '@shared/types';

/**
 * Anything that produces transcript text for a session.
 * Milestone 1: DemoTranscriptSource. Milestone 2: a microphone + streaming-STT source.
 */
export interface TranscriptSource {
  readonly kind: SourceKind;
  /** Resolve once the source is running; reject (with a user-readable Error) if it cannot start. */
  start(onSegment: (segment: RawSegment) => void, onError: (error: AppError) => void): Promise<void>;
  /** Must release every underlying resource (e.g. the microphone). Safe to call twice. */
  stop(): Promise<void>;
}
