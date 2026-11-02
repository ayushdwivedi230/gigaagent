// Inlined AudioWorkletProcessor code string.
// Embedding this string directly ensures seamless loading in both development
// and production without ASAR archive path resolution issues or CORS blocks.

export const AUDIO_WORKLET_NAME = 'audio-chunk-processor';

export const AUDIO_WORKLET_CODE = `
class AudioChunkProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 16kHz mono: 1600 samples = 100ms
    this.bufferSize = 1600;
    this.buffer = new Int16Array(this.bufferSize);
    this.offset = 0;
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const length = channelData.length;

    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      this.buffer[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;

      if (this.offset >= this.bufferSize) {
        // Transfer buffer copy to main thread
        const out = new Int16Array(this.buffer);
        this.port.postMessage(out.buffer, [out.buffer]);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('${AUDIO_WORKLET_NAME}', AudioChunkProcessor);
`;

