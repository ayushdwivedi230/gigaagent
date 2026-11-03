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

  private chunkCounter = 0;

  async start(callbacks: AudioCaptureCallbacks): Promise<void> {
    if (this.isCapturing) return;
    this.chunkCounter = 0;

    try {
      if (!navigator?.mediaDevices?.getDisplayMedia) {
        throw new Error('Display media / system audio capture is not supported in this environment.');
      }

      // 1. Arm the main process gate right before user gesture prompts the capture
      window.api?.diag?.log('SysAudioDiag:01-Gate', 'Renderer requesting main process to arm gate...');
      if (window.api?.systemAudio) {
        const armResult = await window.api.systemAudio.arm();
        if (!armResult.ok) {
          throw new Error('Failed to authorize system audio capture with main process.');
        }
        window.api?.diag?.log('SysAudioDiag:01-Gate', 'Main process gate confirmed armed by renderer');
      }

      // 2. Request display media with loopback audio.
      window.api?.diag?.log('SysAudioDiag:02-DisplayMedia', 'Renderer calling navigator.mediaDevices.getDisplayMedia...');
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      window.api?.diag?.log('SysAudioDiag:05-StreamAcquisition', 'getDisplayMedia resolved', {
        streamId: this.mediaStream.id,
        videoTracks: this.mediaStream.getVideoTracks().length,
        audioTracks: this.mediaStream.getAudioTracks().length,
      });

      // 3. Disable video tracks to discard screen pixels without rendering or recording.
      // CRITICAL: DO NOT call track.stop()! In Chromium on Windows, stopping the video track
      // terminates the underlying DesktopCaptureDevice, killing the WASAPI loopback audio stream!
      const videoTracks = this.mediaStream.getVideoTracks();
      for (const track of videoTracks) {
        track.enabled = false;
        console.log('[SysAudioDiag:06-TrackInspection] Video track disabled (enabled=false, not stopped)', {
          id: track.id,
          readyState: track.readyState,
          muted: track.muted,
        });
      }

      // 4. Verify system audio track was provided
      const audioTracks = this.mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        this.stop();
        throw new Error(
          'No system audio track provided. When prompted, ensure "Share audio" is selected.',
        );
      }

      const primaryAudioTrack = audioTracks[0]!;
      console.log('[SysAudioDiag:06-TrackInspection] System audio track verified live', {
        id: primaryAudioTrack.id,
        readyState: primaryAudioTrack.readyState,
        muted: primaryAudioTrack.muted,
        enabled: primaryAudioTrack.enabled,
      });

      // Handle external termination (e.g. user clicks "Stop sharing" in OS bar)
      primaryAudioTrack.onended = () => {
        console.log('[SysAudioDiag:06-TrackInspection] System audio track ended by OS/user');
        if (this.isCapturing) {
          this.stop();
          callbacks.onError?.(
            new Error('System playback audio capture was stopped by the system or user.'),
          );
        }
      };

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: 16000 });

      // Ensure AudioContext is actively running
      if (this.audioContext.state === 'suspended') {
        console.log('[SysAudioDiag:07-AudioContext] AudioContext was suspended, resuming...');
        await this.audioContext.resume();
      }
      console.log('[SysAudioDiag:07-AudioContext] AudioContext active', {
        sampleRate: this.audioContext.sampleRate,
        state: this.audioContext.state,
      });

      // Create a blob URL for the inlined worklet processor
      const blob = new Blob([AUDIO_WORKLET_CODE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);

      try {
        await this.audioContext.audioWorklet.addModule(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      // Connect ONLY the audio track to AudioContext to prevent multi-track or video overhead
      const audioOnlyStream = new MediaStream([primaryAudioTrack]);
      this.sourceNode = this.audioContext.createMediaStreamSource(audioOnlyStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, AUDIO_WORKLET_NAME);

      this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!this.isCapturing) return;
        const chunk = event.data;
        this.chunkCounter++;

        // Calculate RMS of incoming Int16 samples periodically for non-silent diagnostics
        if (this.chunkCounter % 50 === 1) {
          const samples = new Int16Array(chunk);
          let sumSquares = 0;
          for (let i = 0; i < samples.length; i++) {
            const v = (samples[i] ?? 0) / 32768.0;
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / (samples.length || 1));
          console.log(`[SysAudioDiag:09-PCMStreaming] Audio chunk #${this.chunkCounter}`, {
            bytes: chunk.byteLength,
            samples: samples.length,
            rms: rms.toFixed(4),
            nonSilent: rms > 0.001,
          });
        }

        callbacks.onChunk(chunk);
      };

      this.sourceNode.connect(this.workletNode);

      // Connect to a zero-gain destination node so the Web Audio graph stays active
      const silentGain = this.audioContext.createGain();
      silentGain.gain.value = 0;
      this.workletNode.connect(silentGain);
      silentGain.connect(this.audioContext.destination);

      this.isCapturing = true;
      console.log('[SysAudioDiag:08-Worklet] AudioWorklet pipeline fully wired and capturing PCM chunks');
    } catch (err) {
      this.stop();
      const errName = err instanceof DOMException ? err.name : (err instanceof Error ? err.name : 'UnknownError');
      const errMsg = err instanceof Error ? err.message : String(err);
      window.api?.diag?.log('SysAudioDiag:RendererError', 'System audio capture startup failed', {
        name: errName,
        message: errMsg,
      });

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
