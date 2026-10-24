// Cartesia streaming STT behind SpeechSource, with the browser recogniser as the fallback.
// The mic is resampled to 16 kHz pcm_s16le in an AudioWorklet and streamed in 50 ms chunks to
// an `ink-2` socket. With voice click on it streams the whole time the mic is on; gated (push to
// talk, the default with the camera on) it only streams while a pinch or mouse press is held,
// starting with the last 300 ms before it. flush() sends `finalize`, waits for
// `flush_done`, and swaps in a spare socket that was opened earlier, so the next words never
// wait on a ~0.5 s connect. The socket opens straight to Cartesia with a token from api/.
import { cartesiaUrl, openSocket } from '../cartesia';
import { PreRoll } from './ptt';
import { WebSpeechSource, type SpeechSource } from './speech';

const RATE = 16000;
const CHUNK = 800; // 50 ms, so a release waits at most this long for its last chunk
const QUEUE_MAX = 40; // chunks held while no socket is open (2 s), oldest dropped first
const PREROLL = 6; // 300 ms kept from before a push-to-talk hold
const TAIL_MS = 80; // after a release, wait for the chunk still filling before finalising

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
  private gate = false; // push to talk: audio only goes out while held
  private held = false;
  private preroll = new PreRoll<ArrayBuffer>(PREROLL);
  private tail: (() => void) | null = null; // waiting for the chunk that straddles a release

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
    this.preroll.clear();
    this.tail?.();
    this.held = false;
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

  // Push to talk on or off. Off streams everything, as voice click needs.
  setGated(on: boolean): void {
    if (on === this.gate) return;
    this.gate = on;
    this.preroll.clear();
  }

  // Start or stop a push-to-talk hold. Starting sends the pre-roll first; stopping lets the chunk
  // that was still filling go out (≤ 80 ms) and then closes the gate. Await it before flush().
  hold(on: boolean): Promise<void> {
    if (on === this.held) return Promise.resolve();
    if (on) {
      this.held = true;
      if (this.gate) for (const c of this.preroll.take()) this.send(c);
      return Promise.resolve();
    }
    if (!this.gate || !this.on) {
      this.held = false;
      return Promise.resolve();
    }
    return new Promise(res => {
      const done = () => {
        clearTimeout(timer);
        this.tail = null;
        this.held = false;
        res();
      };
      const timer = setTimeout(done, TAIL_MS);
      this.tail = done;
    });
  }

  async flush(timeoutMs: number): Promise<void> {
    if (this.flushing) return this.flushing;
    // Audio queued while the socket was (re)opening, e.g. Cartesia closed an idle one between
    // holds: give the open a moment rather than dropping those words.
    if (!this.live && this.opening && this.queue.length) {
      await Promise.race([this.opening, new Promise(r => setTimeout(r, timeoutMs))]);
      this.drain();
    }
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
    if (this.gate && !this.held) return this.preroll.push(chunk);
    this.send(chunk);
    this.tail?.();
  }

  private drain(): void {
    const ws = this.live?.ws;
    if (ws?.readyState !== WebSocket.OPEN || !this.queue.length) return;
    for (const q of this.queue.splice(0)) ws.send(q);
    this.unsent = true;
  }

  private send(chunk: ArrayBuffer): void {
    const ws = this.live?.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      this.drain();
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
  onFallback = () => {}; // Cartesia gave up and the browser's recogniser took over
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
      this.onFallback();
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

  // Push to talk. The browser recogniser can't be gated, so it keeps listening and the lock's
  // transcript only takes words heard after the lock, as before.
  setGated(on: boolean): void {
    this.cartesia.setGated(on);
  }

  hold(on: boolean): Promise<void> {
    return this.cur === this.cartesia ? this.cartesia.hold(on) : Promise.resolve();
  }

  flush(timeoutMs: number): Promise<void> {
    return this.cur.flush(timeoutMs);
  }
}
