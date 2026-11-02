import { AUDIO_WORKLET_CODE, AUDIO_WORKLET_NAME } from './audioWorkletCode';

export interface AudioCaptureCallbacks {
  onChunk: (buffer: ArrayBuffer) => void;
  onError?: (error: Error) => void;
}

export class AudioCaptureService {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isCapturing = false;

  async start(callbacks: AudioCaptureCallbacks): Promise<void> {
    if (this.isCapturing) return;

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Microphone audio capture is not supported in this environment.');
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: 16000 });

      // Create a blob URL for the inlined worklet processor
      const blob = new Blob([AUDIO_WORKLET_CODE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);

      try {
        await this.audioContext.audioWorklet.addModule(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, AUDIO_WORKLET_NAME);

      this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!this.isCapturing) return;
        callbacks.onChunk(event.data);
      };

      this.sourceNode.connect(this.workletNode);

      // Connect to a zero-gain destination node so the Web Audio graph stays active
      const silentGain = this.audioContext.createGain();
      silentGain.gain.value = 0;
      this.workletNode.connect(silentGain);
      silentGain.connect(this.audioContext.destination);

      this.isCapturing = true;
    } catch (err) {
      this.stop();
      if (
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      ) {
        throw new Error(
          'Microphone permission denied. Please allow microphone access in Windows Settings.',
        );
      }
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        throw new Error('No microphone device found on your system.');
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  stop(): void {
    this.isCapturing = false;

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
        this.mediaStream.getTracks().forEach((track) => track.stop());
      } catch {
        // Ignore cleanup errors
      }
      this.mediaStream = null;
    }

    if (this.audioContext) {
      try {
        void this.audioContext.close();
      } catch {
        // Ignore cleanup errors
      }
      this.audioContext = null;
    }
  }

  get capturing(): boolean {
    return this.isCapturing;
  }
}

export const audioCapture = new AudioCaptureService();

