import { AUDIO_WORKLET_CODE, AUDIO_WORKLET_NAME } from './audioWorkletCode';

export interface AudioCaptureCallbacks {
  onChunk: (buffer: ArrayBuffer) => void;
  onError?: (error: Error) => void;
}

/**
 * Captures Windows playback / system audio independently of the microphone
 * via Chromium WASAPI loopback (`getDisplayMedia` with system audio sharing).
 *
 * Mandatory constraints enforced:
 * - Pre-arms main process gate before invocation.
 * - Does not specify minWidth/minHeight (forbidden by Screen Capture API).
 * - Immediately stops and discards video tracks upon acquisition.
 * - Never renders, records, or transmits pixel buffers.
 * - Resamples and converts audio to 16 kHz mono Int16 PCM via AudioWorklet.
 */
export class SystemAudioCaptureService {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private isCapturing = false;

  async start(callbacks: AudioCaptureCallbacks): Promise<void> {
    if (this.isCapturing) return;

    try {
      if (!navigator?.mediaDevices?.getDisplayMedia) {
        throw new Error('Display media / system audio capture is not supported in this environment.');
      }

      // 1. Arm the main process gate right before user gesture prompts the capture
      if (window.api?.systemAudio) {
        const armResult = await window.api.systemAudio.arm();
        if (!armResult.ok) {
          throw new Error('Failed to authorize system audio capture with main process.');
        }
      }

      // 2. Request display media with loopback audio.
      // Screen Capture API strictly prohibits minWidth/minHeight constraints.
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // 3. Immediately stop all video tracks to discard screen pixels without rendering or recording
      const videoTracks = this.mediaStream.getVideoTracks();
      for (const track of videoTracks) {
        track.stop();
      }

      // 4. Verify system audio track was provided
      const audioTracks = this.mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        this.mediaStream.getTracks().forEach((t) => t.stop());
        throw new Error(
          'No system audio track provided. When prompted, ensure "Share audio" is selected.',
        );
      }

      // Handle external termination (e.g. user clicks "Stop sharing" in OS bar)
      const primaryAudioTrack = audioTracks[0];
      if (primaryAudioTrack) {
        primaryAudioTrack.onended = () => {
          if (this.isCapturing) {
            this.stop();
            callbacks.onError?.(
              new Error('System playback audio capture was stopped by the system or user.'),
            );
          }
        };
      }

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
          'System audio capture was canceled or denied.',
        );
      }
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        throw new Error('No system audio playback device was found.');
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  stop(): void {
    this.isCapturing = false;

    // Disarm gate if still active
    if (window.api?.systemAudio) {
      void window.api.systemAudio.disarm().catch(() => {});
    }

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

export const systemAudioCapture = new SystemAudioCaptureService();
