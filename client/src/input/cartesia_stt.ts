// Cartesia streaming STT behind SpeechSource, with the browser recogniser as the fallback.
// The mic is resampled to 16 kHz pcm_s16le in an AudioWorklet and streamed in 100 ms chunks to
// an `ink-2` socket the whole time the mic is on. flush() sends `finalize`, waits for
// `flush_done`, and swaps in a spare socket that was opened earlier, so the next words never
// wait on a ~0.5 s connect. The socket opens straight to Cartesia with a token from api/.
import { cartesiaUrl, openSocket } from '../cartesia';
import { WebSpeechSource, type SpeechSource } from './speech';

const RATE = 16000;
const CHUNK = 1600; // 100 ms
const QUEUE_MAX = 20; // chunks held while no socket is open (2 s), oldest dropped first

// Runs on the audio thread: linear resample to 16 kHz, convert to int16, post 100 ms buffers.
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

interface Sock { ws: WebSocket; flushed: (() => void) | null }

export class CartesiaSpeechSource implements SpeechSource {
  onPartial = (_: string) => {};
  onFinal = (_: string) => {};
  onError = (_: string) => {};
  onUnavailable = (_: string) => {}; // gave up: no key, api down, or sockets keep failing
  private on = false;
  private failed = false;
  private ctx: AudioContext | null = null;
  private live: Sock | null = null; // gets the audio
  private spare: Promise<Sock | null> | null = null;
  private opening: Promise<Sock | null> | null = null;
  private queue: ArrayBuffer[] = [];
  private unsent = false; // audio sent since the last finalize
  private flushing: Promise<void> | null = null;
  private fails = 0;

  constructor(private stream: () => MediaStream | null) {}

  get available(): boolean {
    return !this.failed;
  }

  start(): void {
    if (this.on || this.failed) return;
    const stream = this.stream();
    if (!stream) return this.giveUp('no mic stream');
    this.on = true;
    this.capture(stream).catch(e => this.giveUp(`audio capture: ${(e as Error).message}`));
    this.warm();
  }

  stop(): void {
    this.on = false;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.queue = [];
    this.unsent = false;
    this.live?.flushed?.();
    this.live?.ws.close();
    this.live = null;
    this.spare?.then(s => s?.ws.close());
    this.spare = null;
  }

  // Have a live socket and a spare open, so the first words after the lock aren't held up.
  warm(): void {
    if (!this.on) return;
    if (!this.live && !this.opening) this.ensureLive();
    if (!this.spare) this.spare = this.open();
  }

  flush(timeoutMs: number): Promise<void> {
    if (this.flushing) return this.flushing;
    const old = this.live;
    if (!old || !this.unsent || old.ws.readyState !== WebSocket.OPEN) return Promise.resolve();
    this.unsent = false;
    // New audio goes to the spare straight away; the old socket only has to finish its words.
    this.live = null;
    this.ensureLive();
    old.ws.send('finalize');
    this.flushing = new Promise<void>(res => {
      const done = () => {
        clearTimeout(timer);
        old.flushed = null;
        this.flushing = null;
        res();
        setTimeout(() => old.ws.close(), 500);
      };
      const timer = setTimeout(done, timeoutMs);
      old.flushed = done;
    });
    return this.flushing;
  }

  private async capture(stream: MediaStream): Promise<void> {
    const ctx = (this.ctx = new AudioContext());
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    if (this.ctx !== ctx) return;
    const node = new AudioWorkletNode(ctx, 'pcm16k');
    node.port.onmessage = e => this.audio(e.data as ArrayBuffer);
    // A worklet only runs when it reaches the destination; a muted gain keeps it silent.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(node).connect(sink).connect(ctx.destination);
    await ctx.resume();
  }

  private audio(chunk: ArrayBuffer): void {
    const ws = this.live?.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      for (const q of this.queue.splice(0)) ws.send(q);
      ws.send(chunk);
      this.unsent = true;
      return;
    }
    this.queue.push(chunk);
    if (this.queue.length > QUEUE_MAX) this.queue.shift();
    this.ensureLive();
  }

  // Promote the spare, or open a socket if there isn't one, then open the next spare.
  private ensureLive(): void {
    if (!this.on || this.live || this.opening) return;
    const next = this.spare ?? this.open();
    this.spare = null;
    this.opening = next;
    next.then(s => {
      this.opening = null;
      if (!this.on) return void s?.ws.close();
      if (!s) return;
      this.live = s;
      if (!this.spare) this.spare = this.open();
    });
  }

  private async open(): Promise<Sock | null> {
    const url = await cartesiaUrl('/stt/websocket', { model: 'ink-2', encoding: 'pcm_s16le', sample_rate: String(RATE) });
    if (!url) {
      this.giveUp('no Cartesia token');
      return null;
    }
    const ws = await openSocket(url);
    if (!ws) {
      if (++this.fails >= 2) this.giveUp('could not connect');
      return null;
    }
    this.fails = 0;
    const s: Sock = { ws, flushed: null };
    ws.onmessage = e => this.message(s, e.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      s.flushed?.();
      if (this.live === s) this.live = null;
      // An idle spare that Cartesia closed: forget it, a fresh one opens when it's needed.
      this.spare?.then(sp => {
        if (sp === s) this.spare = null;
      });
    };
    return s;
  }

  private message(s: Sock, data: unknown): void {
    if (typeof data !== 'string') return;
    let m: { type?: string; text?: string; is_final?: boolean; message?: string };
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m.type === 'transcript') {
      // Final chunks are deltas to append; a partial is the words since the last final.
      const text = (m.text ?? '').trim();
      if (m.is_final) {
        if (text) this.onFinal(text);
      } else if (s === this.live) this.onPartial(text);
    } else if (m.type === 'flush_done') {
      s.flushed?.();
    } else if (m.type === 'error') {
      this.onError(`Cartesia STT: ${m.message ?? 'error'}`);
    }
  }

  private giveUp(why: string): void {
    if (this.failed) return;
    this.failed = true;
    this.stop();
    this.onUnavailable(why);
  }
}

// Cartesia when the api has a key and the sockets connect, otherwise the browser recogniser.
// The controller only sees one SpeechSource either way.
export class AutoSpeech implements SpeechSource {
  onPartial = (_: string) => {};
  onFinal = (_: string) => {};
  onError = (_: string) => {};
  private cartesia: CartesiaSpeechSource;
  private web = new WebSpeechSource();
  private cur: SpeechSource;
  private on = false;

  constructor(stream: () => MediaStream | null) {
    this.cartesia = new CartesiaSpeechSource(stream);
    this.cur = this.cartesia;
    for (const s of [this.cartesia, this.web]) {
      s.onPartial = t => s === this.cur && this.onPartial(t);
      s.onFinal = t => s === this.cur && this.onFinal(t);
      s.onError = msg => s === this.cur && this.onError(msg);
    }
    this.cartesia.onUnavailable = why => {
      if (this.cur !== this.cartesia) return;
      this.cur = this.web;
      console.warn(`Cartesia STT unavailable (${why}), using the browser's speech recognition`);
      if (this.on) {
        this.web.start();
        this.onError(this.web.available ? 'listening (browser speech; Cartesia unavailable)' : 'no speech recognition: voice locks, typed text describes');
      }
    };
  }

  get engine(): string {
    return this.cur === this.cartesia ? 'Cartesia' : 'browser speech';
  }

  get available(): boolean {
    return this.cur.available;
  }

  start(): void {
    this.on = true;
    this.cur.start();
  }

  stop(): void {
    this.on = false;
    this.cur.stop();
  }

  warm(): void {
    if (this.cur === this.cartesia) this.cartesia.warm();
  }

  flush(timeoutMs: number): Promise<void> {
    return this.cur.flush(timeoutMs);
  }
}
