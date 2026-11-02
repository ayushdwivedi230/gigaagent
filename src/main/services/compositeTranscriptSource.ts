import type { AppError, RawSegment } from '@shared/types';
import type { TranscriptSource } from './transcriptSource';
import type { SettingsService } from './settingsService';
import { MicrophoneTranscriptSource } from './microphoneTranscriptSource';
import { SystemAudioTranscriptSource } from './systemAudioTranscriptSource';

export interface CompositeSourceOptions {
  settingsService: SettingsService;
  clock?: () => number;
}

/**
 * Composite transcript source that captures and transcribes both physical microphone audio
 * (speaker: 'user') and system loopback playback audio (speaker: 'system') simultaneously.
 *
 * Maintains independent Deepgram WebSocket connections and lifecycles for both streams.
 */
export class CompositeTranscriptSource implements TranscriptSource {
  readonly kind = 'both' as const;

  private readonly micSource: MicrophoneTranscriptSource;
  private readonly sysSource: SystemAudioTranscriptSource;
  private running = false;

  constructor(options: CompositeSourceOptions) {
    this.micSource = new MicrophoneTranscriptSource(options);
    this.sysSource = new SystemAudioTranscriptSource(options);
  }

  async start(
    onSegment: (segment: RawSegment) => void,
    onError: (error: AppError) => void,
  ): Promise<void> {
    this.running = true;
    await Promise.all([
      this.micSource.start(onSegment, onError),
      this.sysSource.start(onSegment, onError),
    ]);
  }

  pushAudioChunk(arg1: ArrayBuffer | 'mic' | 'system', arg2?: ArrayBuffer): void {
    if (!this.running) return;

    if (arg1 === 'system' && arg2 instanceof ArrayBuffer) {
      this.sysSource.pushAudioChunk(arg2);
    } else if (arg1 === 'mic' && arg2 instanceof ArrayBuffer) {
      this.micSource.pushAudioChunk(arg2);
    } else if (arg1 instanceof ArrayBuffer) {
      // Default un-tagged chunks route to mic source
      this.micSource.pushAudioChunk(arg1);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.allSettled([
      this.micSource.stop(),
      this.sysSource.stop(),
    ]);
  }
}
