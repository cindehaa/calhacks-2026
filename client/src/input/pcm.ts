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

// Where the speech is in a clip, as a range of its chunks [start, end): from a little before the
// first chunk loud enough to be speech to a little after the last. Loud enough is relative to the
// clip's loudest chunk, so a quiet voice still counts and room noise doesn't. Null if nothing in
// it is louder than minRms. A speech model handed a short phrase inside seconds of silence (a
// pinch held a while, or listening all the time) hears nothing at all, so clips are cut to this.
export function speechSpan(rms: number[], minRms: number, lead = 3, tail = 5): [number, number] | null {
  const peak = Math.max(0, ...rms);
  if (peak < minRms) return null;
  const loud = Math.max(minRms * 2, peak * 0.12);
  const first = rms.findIndex(r => r >= loud);
  let last = rms.length - 1;
  while (rms[last] < loud) last--;
  return [Math.max(0, first - lead), Math.min(rms.length, last + 1 + tail)];
}
