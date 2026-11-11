import type { AppError, RawSegment } from '@shared/types';
import type { TranscriptSource } from './transcriptSource';
import type { SettingsService } from './settingsService';
import { createDeepgramSocket, type ISocket } from './deepgramSocket';
import { logDiag } from './diagnosticsLogger';

export interface SystemAudioSourceOptions {
  settingsService: SettingsService;
  clock?: () => number;
}

export class SystemAudioTranscriptSource implements TranscriptSource {
  readonly kind = 'system' as const;

  private running = false;
  private emitSegment: ((segment: RawSegment) => void) | undefined;
  private emitError: ((error: AppError) => void) | undefined;
  private ws: ISocket | null = null;
  private readonly settingsService: SettingsService;
  private readonly clock: () => number;

  private startedAt = 0;
  private currentSegmentId = '';
  private segmentCount = 0;

  // Bounded buffer for chunks waiting for WebSocket connection (max 5 seconds @ 32KB/s = ~160KB)
  private readonly MAX_BUFFER_BYTES = 160 * 1024;
  private pendingBytes = 0;
  private pendingChunks: ArrayBuffer[] = [];

  // Bounded exponential backoff reconnection
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnecting = false;

  // Mock recognition state for offline / key-less mode
  private mockVoiceActive = false;
  private mockWordIndex = 0;
  private mockTimer: ReturnType<typeof setInterval> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SystemAudioSourceOptions) {
    this.settingsService = options.settingsService;
    this.clock = options.clock ?? Date.now;
  }

  private chunkCount = 0;

  async start(
    onSegment: (segment: RawSegment) => void,
    onError: (error: AppError) => void,
  ): Promise<void> {
    this.running = true;
    this.chunkCount = 0;
    this.emitSegment = onSegment;
    this.emitError = onError;
    this.startedAt = this.clock();
    this.segmentCount = 0;
    this.currentSegmentId = `sys_${this.startedAt}_${++this.segmentCount}`;

    const settings = this.settingsService.getSettings();
    const apiKey = this.settingsService.getEffectiveSttKey();

    logDiag('SysAudioDiag:11-MainSource', 'SystemAudioTranscriptSource starting', {
      provider: settings.sttProvider,
      hasApiKey: Boolean(apiKey),
    });

    if (settings.sttProvider === 'mock' || !apiKey) {
      if (!apiKey && settings.sttProvider !== 'mock') {
        onError({
          code: 'SOURCE_FAILED',
          message:
            'No STT API key configured for system playback audio. Running in audio energy detection mode. Enter your Deepgram API Key in Settings for live cloud transcription.',
        });
      }
      this.initMockRecognizer();
      return;
    }

    this.connectDeepgram(apiKey);
  }

  pushAudioChunk(arg1: ArrayBuffer | 'mic' | 'system', arg2?: ArrayBuffer): void {
    if (!this.running) return;

    let chunk: ArrayBuffer;
    if (arg1 instanceof ArrayBuffer) {
      chunk = arg1;
    } else if (arg2 instanceof ArrayBuffer) {
      chunk = arg2;
    } else {
      return;
    }

    this.chunkCount++;
    if (this.chunkCount % 50 === 1) {
      logDiag('SysAudioDiag:11-MainSource', `Received audio chunk #${this.chunkCount}`, {
        bytes: chunk.byteLength,
        wsReadyState: this.ws ? this.ws.readyState : 'no-ws',
      });
    }

    // If using real WebSocket connection
    if (this.ws) {
      if (this.ws.readyState === 1) { // 1 = OPEN
        try {
          this.ws.send(chunk);
        } catch (err) {
          console.warn('[SystemAudioTranscriptSource] Failed to send audio chunk', err);
        }
      } else if (this.ws.readyState === 0) { // 0 = CONNECTING
        if (this.pendingBytes + chunk.byteLength <= this.MAX_BUFFER_BYTES) {
          this.pendingChunks.push(chunk);
          this.pendingBytes += chunk.byteLength;
        } else {
          const oldest = this.pendingChunks.shift();
          if (oldest) this.pendingBytes -= oldest.byteLength;
          this.pendingChunks.push(chunk);
          this.pendingBytes += chunk.byteLength;
        }
      }
      return;
    }

    // If running in energy detection / mock mode:
    this.processAudioEnergy(chunk);
  }

  private connectDeepgram(apiKey: string): void {
    if (!this.running) return;

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    try {
      const cleanKey = apiKey.trim();
      const url =
        'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&model=nova-2';

      const ws = createDeepgramSocket(url, cleanKey);
      this.ws = ws;

      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === 1) {
          try {
            this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
          } catch {}
        }
      }, 8000);

      ws.onopen = () => {
        logDiag('SysAudioDiag:11-MainSource', 'System audio Deepgram WebSocket connected (OPEN)');
        if (!this.running || this.ws !== ws) {
          try {
            ws.close();
          } catch {}
          return;
        }

        this.reconnectAttempts = 0;
        this.isReconnecting = false;

        // Flush queued buffer
        while (this.pendingChunks.length > 0) {
          const chunk = this.pendingChunks.shift();
          if (chunk && ws.readyState === 1) {
            ws.send(chunk);
          }
        }
        this.pendingBytes = 0;
      };

      ws.onmessage = (event: { data: string }) => {
        if (!this.running || this.ws !== ws) return;
        try {
          const data = JSON.parse(event.data);
          this.handleDeepgramResponse(data);
        } catch (err) {
          console.error('[SystemAudioTranscriptSource] Failed to parse Deepgram response', err);
        }
      };

      ws.onerror = (err) => {
        console.error('[SystemAudioTranscriptSource] WebSocket error', err);
      };

      ws.onclose = (event) => {
        if (this.keepAliveTimer) {
          clearInterval(this.keepAliveTimer);
          this.keepAliveTimer = null;
        }
        if (!this.running || this.ws !== ws) return;

        if (event.code !== 1000 && event.code !== 1005) {
          if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS && !this.isReconnecting) {
            this.reconnectAttempts++;
            this.isReconnecting = true;
            const delay = Math.min(4000, 1000 * Math.pow(2, this.reconnectAttempts - 1));
            console.warn(`[SystemAudioTranscriptSource] Connection closed (${event.code}). Retrying reconnect (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}) in ${delay}ms...`);
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = null;
              this.isReconnecting = false;
              if (this.running) {
                this.connectDeepgram(apiKey);
              }
            }, delay);
            return;
          }

          console.warn('[SystemAudioTranscriptSource] WebSocket closed unexpectedly after retries', event.code, event.reason);
          this.emitError?.({
            code: 'SOURCE_FAILED',
            message: `System audio transcription closed (code ${event.code}): ${event.reason || 'Network error'}.`,
          });
        }
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[SystemAudioTranscriptSource] Failed to initialize WebSocket', err);
      this.emitError?.({
        code: 'SOURCE_FAILED',
        message: `Could not connect system audio to Speech-to-Text service: ${errMsg}`,
      });
    }
  }

  private handleDeepgramResponse(data: {
    channel?: {
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
      }>;
    };
    is_final?: boolean;
    speech_final?: boolean;
    start?: number;
    duration?: number;
  }): void {
    const alternative = data.channel?.alternatives?.[0];
    const text = alternative?.transcript?.trim();
    if (!text) return;

    const isFinal = Boolean(data.is_final || data.speech_final);
    const startSec = typeof data.start === 'number' ? data.start : 0;
    const durationSec = typeof data.duration === 'number' ? data.duration : 0.5;

    const startMs = Math.round(startSec * 1000);
    const endMs = isFinal ? Math.round((startSec + durationSec) * 1000) : null;

    logDiag('SysAudioDiag:12-DeepgramSTT', 'System transcript segment produced', {
      segmentId: this.currentSegmentId,
      speaker: 'system',
      isFinal,
      textPreview: text.length > 50 ? `${text.slice(0, 50)}…` : text,
    });

    this.emitSegment?.({
      id: this.currentSegmentId,
      speaker: 'system',
      text,
      isFinal,
      startMs,
      endMs,
    });

    if (isFinal) {
      this.currentSegmentId = `sys_${this.startedAt}_${++this.segmentCount}`;
    }
  }

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

    const SPEECH_THRESHOLD = 0.015;
    if (rms > SPEECH_THRESHOLD) {
      this.mockVoiceActive = true;
    }
  }

  private initMockRecognizer(): void {
    const samplePhrases = [
      'Welcome everyone, thanks for joining this technical architecture review',
      'Could you explain how the system handles backpressure and network disconnections?',
      'Can you clarify the consistency guarantees for the distributed database?',
      'Let us review the deliverables and action items before wrapping up',
      'What are the latency tradeoffs between the streaming approaches we discussed?',
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
          speaker: 'system',
          text: `[Meeting Audio] ${partial}`,
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
          this.currentSegmentId = `sys_${this.startedAt}_${++this.segmentCount}`;
        }
      }
    }, 450);
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;

    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
        this.ws.close(1000, 'Session stopped normally');
      } catch {
        // Ignore close error
      }
      this.ws = null;
    }

    this.pendingChunks = [];
    this.pendingBytes = 0;
    this.emitSegment = undefined;
    this.emitError = undefined;
  }
}

