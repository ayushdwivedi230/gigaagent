// Inlined AudioWorkletProcessor code string.
// Embedding this string directly ensures seamless loading in both development
// and production without ASAR archive path resolution issues or CORS blocks.

export const AUDIO_WORKLET_NAME = 'audio-chunk-processor';

export const AUDIO_WORKLET_CODE = `
class AudioChunkProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    // 16kHz mono: 1600 samples = 100ms
    this.bufferSize = 1600;
    this.buffer = new Int16Array(this.bufferSize);
    this.offset = 0;
    // sampleRate is a global float in AudioWorkletGlobalScope
    this.sourceRate = typeof sampleRate === 'number' ? sampleRate : 16000;
    this.resampleRatio = this.sourceRate / this.targetRate;
    this.phase = 0;
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const inLength = channelData.length;

    if (Math.abs(this.resampleRatio - 1.0) < 0.01) {
      // 1:1 direct sampling when context is already 16kHz
      for (let i = 0; i < inLength; i++) {
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        this.buffer[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;

        if (this.offset >= this.bufferSize) {
          const out = new Int16Array(this.buffer);
          this.port.postMessage(out.buffer, [out.buffer]);
          this.offset = 0;
        }
      }
    } else {
      // Linear interpolation downsampling for 44.1kHz / 48kHz audio contexts
      while (this.phase < inLength) {
        const index = Math.floor(this.phase);
        const nextIndex = Math.min(index + 1, inLength - 1);
        const frac = this.phase - index;
        const sample = channelData[index] * (1 - frac) + channelData[nextIndex] * frac;
        const clamped = Math.max(-1, Math.min(1, sample));

        this.buffer[this.offset++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;

        if (this.offset >= this.bufferSize) {
          const out = new Int16Array(this.buffer);
          this.port.postMessage(out.buffer, [out.buffer]);
          this.offset = 0;
        }

        this.phase += this.resampleRatio;
      }
      this.phase -= inLength;
    }

    return true;
  }
}

registerProcessor('${AUDIO_WORKLET_NAME}', AudioChunkProcessor);
`;
