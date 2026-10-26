class JarvisMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 1024;
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;

    let sourceOffset = 0;
    while (sourceOffset < channel.length) {
      const copyLength = Math.min(this.chunkSize - this.offset, channel.length - sourceOffset);
      this.buffer.set(channel.subarray(sourceOffset, sourceOffset + copyLength), this.offset);
      sourceOffset += copyLength;
      this.offset += copyLength;

      if (this.offset === this.chunkSize) {
        const completedChunk = this.buffer;
        this.port.postMessage(completedChunk, [completedChunk.buffer]);
        this.buffer = new Float32Array(this.chunkSize);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("jarvis-mic-processor", JarvisMicProcessor);
