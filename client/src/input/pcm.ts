// The mic as 16 kHz 16-bit PCM in 50 ms chunks, for speech engines that take raw audio: Cartesia's
// socket (cartesia_stt.ts) and the model in the browser (localstt.ts).
export const RATE = 16000;
export const CHUNK = 800; // 50 ms, so a release waits at most this long for its last chunk

// Runs on the audio thread: linear resample to 16 kHz, convert to int16, post CHUNK-sized buffers.
const WORKLET = `
class Pcm16k extends AudioWorkletProcessor {
  constructor() { super(); this.step = sampleRate / ${RATE}; this.pos = 0; this.buf = new Int16Array(${CHUNK}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.step) {
      const i = Math.floor(this.pos), f = this.pos - i, a = ch[i], b = i + 1 < ch.length ? ch[i + 1] : a;
      const v = Math.max(-1, Math.min(1, a + (b - a) * f));
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === ${CHUNK}) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Int16Array(${CHUNK}); this.n = 0; }
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor('pcm16k', Pcm16k);`;

// Start feeding `onChunk` from the stream through ctx. still(): false once the caller has moved on
// (stopped while the worklet loaded), and nothing is connected.
export async function capture16k(ctx: AudioContext, stream: MediaStream, onChunk: (c: ArrayBuffer) => void, still = () => true): Promise<void> {
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  if (!still()) return;
  const node = new AudioWorkletNode(ctx, 'pcm16k');
  node.port.onmessage = e => onChunk(e.data as ArrayBuffer);
  // A worklet only runs when it reaches the destination; a muted gain keeps it silent.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  ctx.createMediaStreamSource(stream).connect(node).connect(sink).connect(ctx.destination);
  // Started with no click or key yet (the mic comes on as the game opens, or a fallback engine
  // took over later): the context waits for the first one, like the Mic's level meter does.
  if (ctx.state !== 'running') {
    const resume = () => void ctx.resume();
    addEventListener('pointerdown', resume, { once: true });
    addEventListener('keydown', resume, { once: true });
  }
  void ctx.resume();
}
