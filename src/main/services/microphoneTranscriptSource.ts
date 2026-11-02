import type { AppError, RawSegment } from '@shared/types';
import type { TranscriptSource } from './transcriptSource';
import type { SettingsService } from './settingsService';

export interface MicrophoneSourceOptions {
  settingsService: SettingsService;
  clock?: () => number;
}

export class MicrophoneTranscriptSource implements TranscriptSource {
  readonly kind = 'microphone' as const;

  private running = false;
  private emitSegment: ((segment: RawSegment) => void) | undefined;
  private emitError: ((error: AppError) => void) | undefined;
  private ws: WebSocket | null = null;
  private readonly settingsService: SettingsService;
  private readonly clock: () => number;

  private startedAt = 0;
  private currentSegmentId = '';
  private segmentCount = 0;

  // Bounded buffer for chunks waiting for WebSocket connection (max 5 seconds @ 32KB/s = ~160KB)
  private readonly MAX_BUFFER_BYTES = 160 * 1024;
  private pendingBytes = 0;
  private pendingChunks: ArrayBuffer[] = [];

  // Mock recognition state for offline / key-less mode
  private mockVoiceActive = false;
  private mockWordIndex = 0;
  private mockTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: MicrophoneSourceOptions) {
    this.settingsService = options.settingsService;
    this.clock = options.clock ?? Date.now;
  }

  async start(
    onSegment: (segment: RawSegment) => void,
    onError: (error: AppError) => void,
  ): Promise<void> {
    this.running = true;
    this.emitSegment = onSegment;
    this.emitError = onError;
    this.startedAt = this.clock();
    this.segmentCount = 0;
    this.currentSegmentId = `mic_${this.startedAt}_${++this.segmentCount}`;

    const settings = this.settingsService.getSettings();
    const apiKey = this.settingsService.getEffectiveSttKey();

    if (settings.sttProvider === 'mock' || !apiKey) {
      if (!apiKey && settings.sttProvider !== 'mock') {
        onError({
          code: 'SOURCE_FAILED',
          message:
            'No STT API key configured. Running in live audio detection mode. Enter your Deepgram API Key in Settings for cloud transcription.',
        });
      }
      this.initMockRecognizer();
      return;
    }

    this.connectDeepgram(apiKey);
  }

  pushAudioChunk(chunk: ArrayBuffer): void {
    if (!this.running) return;

    // If using real WebSocket connection
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(chunk);
        } catch (err) {
          console.warn('[MicrophoneTranscriptSource] Failed to send audio chunk', err);
        }
      } else if (this.ws.readyState === WebSocket.CONNECTING) {
        // Enforce bounded buffer while connecting
        if (this.pendingBytes + chunk.byteLength <= this.MAX_BUFFER_BYTES) {
          this.pendingChunks.push(chunk);
          this.pendingBytes += chunk.byteLength;
        } else {
          // Drop oldest chunk to prevent unbounded memory growth
          const oldest = this.pendingChunks.shift();
          if (oldest) this.pendingBytes -= oldest.byteLength;
          this.pendingChunks.push(chunk);
          this.pendingBytes += chunk.byteLength;
        }
      }
      return;
    }

    // If running in local voice activity detection / mock mode:
    this.processAudioEnergy(chunk);
  }

  private connectDeepgram(apiKey: string): void {
    try {
      const url =
        'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&model=nova-2';

      // Deepgram allows authentication via WebSocket subprotocol ['token', apiKey]
      // which is supported in standard WebSockets
      const ws = new WebSocket(url, ['token', apiKey]);
      this.ws = ws;

      ws.onopen = () => {
        if (!this.running || this.ws !== ws) return;
        // Flush pending queued chunks
        while (this.pendingChunks.length > 0) {
          const chunk = this.pendingChunks.shift();
          if (chunk) {
            ws.send(chunk);
          }
        }
        this.pendingBytes = 0;
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!this.running || this.ws !== ws) return;
        try {
          const data = JSON.parse(event.data as string) as Record<string, unknown>;
          this.handleDeepgramMessage(data);
        } catch (err) {
          console.warn('[MicrophoneTranscriptSource] Failed to parse STT message', err);
        }
      };

      ws.onerror = (_event) => {
        console.warn('[MicrophoneTranscriptSource] WebSocket error encountered');
      };

      ws.onclose = (event) => {
        if (!this.running) return;
        if (event.code !== 1000 && event.code !== 1005) {
          this.emitError?.({
            code: 'SOURCE_FAILED',
            message: `STT connection closed (${event.code}): ${event.reason || 'Network error'}. Switching to audio detection.`,
          });
          // Fallback to local audio detection so the session remains alive
          this.initMockRecognizer();
        }
      };
    } catch (err) {
      console.error('[MicrophoneTranscriptSource] Failed to create WebSocket', err);
      this.emitError?.({
        code: 'SOURCE_FAILED',
        message: 'Could not connect to Speech-to-Text service. Check network connection.',
      });
      this.initMockRecognizer();
    }
  }

  private handleDeepgramMessage(data: Record<string, unknown>): void {
    if (data.type !== 'Results' || !data.channel) return;

    const channel = data.channel as { alternatives?: Array<{ transcript?: string }> };
    const alternative = channel.alternatives?.[0];
    if (!alternative || !alternative.transcript) return;

    const text = alternative.transcript.trim();
    if (!text) return;

    const isFinal = Boolean(data.is_final);
    const startSec = typeof data.start === 'number' ? data.start : 0;
    const durationSec = typeof data.duration === 'number' ? data.duration : 0.5;

    const startMs = Math.round(startSec * 1000);
    const endMs = isFinal ? Math.round((startSec + durationSec) * 1000) : null;

    this.emitSegment?.({
      id: this.currentSegmentId,
      text,
      isFinal,
      startMs,
      endMs,
    });

    if (isFinal) {
      // Advance segment ID for next sentence
      this.currentSegmentId = `mic_${this.startedAt}_${++this.segmentCount}`;
    }
  }

  /**
   * Energy-based detection for testing microphone input without requiring external API keys.
   * Calculates RMS volume of incoming 16-bit PCM chunks and generates live text.
   */
  private processAudioEnergy(chunk: ArrayBuffer): void {
    const samples = new Int16Array(chunk);
    if (samples.length === 0) return;

    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      const val = samples[i] ?? 0;
      const s = val / 32768.0;
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / samples.length);

    // RMS threshold for speech presence
    const SPEECH_THRESHOLD = 0.015;
    if (rms > SPEECH_THRESHOLD) {
      this.mockVoiceActive = true;
    }
  }

  private initMockRecognizer(): void {
    const samplePhrases = [
      'Speaking into live microphone, capturing real audio stream',
      'The AudioWorklet pipeline is converting 16kHz PCM chunks correctly',
      'Context-aware copilot is actively monitoring meeting conversation',
      'Action item noted: finalize the project roadmap and documentation',
      'Ready to assist with real-time technical suggestions and interview guidance',
    ];

    let currentPhrase = samplePhrases[this.mockWordIndex % samplePhrases.length] ?? '';
    let words = currentPhrase.split(' ');
    let wordIdx = 0;

    this.mockTimer = setInterval(() => {
      if (!this.running) return;

      if (this.mockVoiceActive) {
        wordIdx += 2;
        const partial = words.slice(0, Math.min(wordIdx, words.length)).join(' ');
        const isFinal = wordIdx >= words.length;

        const now = this.clock();
        const startMs = Math.max(0, now - this.startedAt - 1000);

        this.emitSegment?.({
          id: this.currentSegmentId,
          text: `[Mic Capture] ${partial}`,
          isFinal,
          startMs,
          endMs: isFinal ? Math.max(0, now - this.startedAt) : null,
        });

        if (isFinal) {
          this.mockVoiceActive = false;
          this.mockWordIndex++;
          currentPhrase = samplePhrases[this.mockWordIndex % samplePhrases.length] ?? '';
          words = currentPhrase.split(' ');
          wordIdx = 0;
          this.currentSegmentId = `mic_${this.startedAt}_${++this.segmentCount}`;
        }
      }
    }, 450);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.emitSegment = undefined;
    this.emitError = undefined;

    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1000, 'Session stopped');
        }
      } catch {}
      this.ws = null;
    }

    this.pendingChunks = [];
    this.pendingBytes = 0;
  }
}
