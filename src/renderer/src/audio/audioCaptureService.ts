import { AUDIO_WORKLET_CODE, AUDIO_WORKLET_NAME } from './audioWorkletCode';

export interface AudioCaptureCallbacks {
  onChunk: (buffer: ArrayBuffer) => void;
  onError?: (error: Error) => void;
  /** The device was unplugged or the OS ended the track. */
  onEnded?: () => void;
}

export interface AudioCaptureOptions {
  /** Preferred input device. Falls back to the system default if it is no longer available. */
  deviceId?: string | null;
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/** Lists microphones. Labels are only available after microphone permission has been granted once. */
export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  if (!navigator?.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || (d.deviceId === 'default' ? 'System default microphone' : `Microphone ${i + 1}`) }));
}

/** RMS level (0–1) of a 16-bit PCM chunk, for the live level meter. */
export function pcmLevel(buffer: ArrayBuffer): number {
  const samples = new Int16Array(buffer);
  if (samples.length === 0) return 0;
  let sum = 0;
  // Sampling every 4th value is plenty for a meter and keeps this off the profile.
  for (let i = 0; i < samples.length; i += 4) {
    const v = samples[i]! / 32768;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / Math.ceil(samples.length / 4)) * 3);
}

export class AudioCaptureService {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isCapturing = false;
  private starting: Promise<void> | null = null;
  private generation = 0;
  private deviceLabel: string | null = null;

  /** Human-readable name of the device currently being captured. */
  get activeDeviceLabel(): string | null {
    return this.deviceLabel;
  }

  /**
   * Starts capture. Concurrent calls share one start, and a stop() issued while the permission
   * prompt is open releases the microphone the moment it is granted (no stuck mic indicator).
   */
  async start(callbacks: AudioCaptureCallbacks, options: AudioCaptureOptions = {}): Promise<void> {
    if (this.isCapturing) return;
    if (this.starting) return this.starting;
    const gen = ++this.generation;
    this.starting = this.startInternal(callbacks, options, gen).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startInternal(callbacks: AudioCaptureCallbacks, options: AudioCaptureOptions, gen: number): Promise<void> {
    const stale = (): boolean => gen !== this.generation;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Microphone audio capture is not supported in this environment.');
      }

      const base = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: options.deviceId ? { ...base, deviceId: { exact: options.deviceId } } : base,
          video: false,
        });
      } catch (err) {
        // The remembered device was unplugged: fall back to the default microphone.
        if (options.deviceId && err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: base, video: false });
        } else {
          throw err;
        }
      }
      if (stale()) return;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      context = new AudioCtx({ sampleRate: 16000 });

      // Create a blob URL for the inlined worklet processor
      const blobUrl = URL.createObjectURL(new Blob([AUDIO_WORKLET_CODE], { type: 'application/javascript' }));
      try {
        await context.audioWorklet.addModule(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      if (stale()) return;
      if (context.state === 'suspended') await context.resume();
      if (stale()) return;

      const sourceNode = context.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(context, AUDIO_WORKLET_NAME);
      workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!this.isCapturing || gen !== this.generation) return;
        callbacks.onChunk(event.data);
      };
      sourceNode.connect(workletNode);

      // Connect to a zero-gain destination node so the Web Audio graph stays active
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      workletNode.connect(silentGain);
      silentGain.connect(context.destination);

      const track = stream.getAudioTracks()[0];
      this.deviceLabel = track?.label || null;
      if (track) {
        track.onended = () => {
          if (gen !== this.generation) return;
          this.stop();
          callbacks.onEnded?.();
        };
      }

      this.mediaStream = stream;
      this.audioContext = context;
      this.sourceNode = sourceNode;
      this.workletNode = workletNode;
      this.isCapturing = true;
      stream = null;
      context = null;
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        throw new Error('Microphone permission denied. Allow microphone access for desktop apps in Windows Settings → Privacy & security → Microphone, then try again.');
      }
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        throw new Error('No microphone was found. Connect one, or switch the audio source to System audio.');
      }
      if (err instanceof DOMException && err.name === 'NotReadableError') {
        throw new Error('The microphone is in use by another app or could not be opened. Close other apps using it and try again.');
      }
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      // Anything still held here was acquired by a start that failed or was superseded: release it.
      stream?.getTracks().forEach((t) => t.stop());
      if (context) void context.close().catch(() => {});
    }
  }

  /** Mutes/unmutes without closing the device (used by Pause). The OS mic indicator stays on. */
  setMuted(muted: boolean): void {
    this.mediaStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  stop(): void {
    this.generation++;
    this.isCapturing = false;
    this.deviceLabel = null;

    if (this.workletNode) {
      try {
        this.workletNode.port.onmessage = null;
        this.workletNode.disconnect();
      } catch {
        // Ignore cleanup errors
      }
      this.workletNode = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore cleanup errors
      }
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => {
          track.onended = null;
          track.stop();
        });
      } catch {
        // Ignore cleanup errors
      }
      this.mediaStream = null;
    }
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  get capturing(): boolean {
    return this.isCapturing;
  }
}

export const audioCapture = new AudioCaptureService();
