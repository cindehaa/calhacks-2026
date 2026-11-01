// Cartesia streaming STT behind SpeechSource, with the browser recogniser as the fallback.
// The mic is resampled to 16 kHz pcm_s16le in an AudioWorklet and streamed in 50 ms chunks to
// an `ink-2` socket. With voice click on it streams the whole time the mic is on; gated (push to
// talk, the default with the camera on) it only streams while a pinch or mouse press is held,
// starting with the last 300 ms before it. flush() sends `finalize`, waits for
// `flush_done`, and swaps in a spare socket that was opened earlier, so the next words never
// wait on a ~0.5 s connect. The socket opens straight to Cartesia with a token from api/.
// Each socket is one epoch of audio, so cut() (a fire) splits the words exactly where it happened:
// everything sent before it is finalised on the old socket, everything after goes to the new one.
import { cartesiaTokenProblem, cartesiaUrl, openSocket } from '../cartesia';
import { diag } from '../diag';
import { capture16k, RATE } from './pcm';
import { PreRoll } from './ptt';
import { LOCAL_WAIT_MS, LocalSpeechSource } from './localstt';
import { FIRE_WAIT_MS, WebSpeechSource, type Cut, type SpeechSource } from './speech';

const QUEUE_MAX = 40; // chunks held while no socket is open (2 s), oldest dropped first
const PREROLL = 6; // 300 ms kept from before a push-to-talk hold
const TAIL_MS = 80; // after a release, wait for the chunk still filling before finalising

interface Sock { ws: WebSocket; flushed: (() => void) | null; epoch: number }

export class CartesiaSpeechSource implements SpeechSource {
  onPartial = (_: string, _epoch: number) => {};
  onFinal = (_: string, _epoch: number) => {};
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
  private flushing = new Set<Promise<void>>(); // finalizes still waiting on flush_done
  private epoch = 0; // the live socket's, or the next live socket's
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
    this.capture(stream).catch(e => {
      diag.error('MIC', `audio capture failed: ${(e as Error).message}`);
      this.giveUp(`audio capture: ${(e as Error).message}`);
    });
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
    // Audio queued while the socket was (re)opening, e.g. Cartesia closed an idle one between
    // holds: give the open a moment rather than dropping those words.
    if (!this.live && this.opening && this.queue.length) {
      await Promise.race([this.opening, new Promise(r => setTimeout(r, timeoutMs))]);
      this.drain();
    }
    this.finalize(timeoutMs);
    await Promise.all(this.flushing);
  }

  // A fire: end this epoch here. The audio sent so far is finalised on its socket and the next
  // chunk goes to the spare, whose words are the next epoch's.
  cut(timeoutMs: number): Cut {
    const epoch = this.epoch;
    const done = this.finalize(timeoutMs);
    if (this.epoch === epoch) {
      // Nothing to finalise (no audio since the last one): the live socket just moves on.
      this.epoch++;
      if (this.live) this.live.epoch = this.epoch;
    }
    return { epoch, done: done ?? Promise.all(this.flushing).then(() => {}) };
  }

  // Send finalize on the live socket and swap in the spare. Resolves on flush_done or timeoutMs.
  private finalize(timeoutMs: number): Promise<void> | null {
    const old = this.live;
    if (!old || !this.unsent || old.ws.readyState !== WebSocket.OPEN) return null;
    this.unsent = false;
    // New audio goes to the spare straight away; the old socket only has to finish its words.
    this.live = null;
    this.epoch++;
    this.ensureLive();
    old.ws.send('finalize');
    const p = new Promise<void>(res => {
      const done = () => {
        clearTimeout(timer);
        old.flushed = null;
        this.flushing.delete(p);
        res();
        setTimeout(() => old.ws.close(), 500);
      };
      const timer = setTimeout(done, timeoutMs);
      old.flushed = done;
    });
    this.flushing.add(p);
    return p;
  }

  private async capture(stream: MediaStream): Promise<void> {
    const ctx = (this.ctx = new AudioContext());
    await capture16k(ctx, stream, c => this.audio(c), () => this.ctx === ctx);
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
      s.epoch = this.epoch;
      this.live = s;
      if (!this.spare) this.spare = this.open();
    });
  }

  private async open(): Promise<Sock | null> {
    const url = await cartesiaUrl('/stt/websocket', { model: 'ink-2', encoding: 'pcm_s16le', sample_rate: String(RATE) });
    if (!url) {
      this.giveUp(cartesiaTokenProblem() || 'no Cartesia token');
      return null;
    }
    const ws = await openSocket(url);
    if (!ws) {
      diag.warn('STT', `Cartesia STT socket failed to open (attempt ${this.fails + 1} of 2)`);
      if (++this.fails >= 2) this.giveUp('couldn’t connect to Cartesia (key refused or out of credit?)');
      return null;
    }
    this.fails = 0;
    const s: Sock = { ws, flushed: null, epoch: -1 };
    ws.onmessage = e => this.message(s, e.data);
    ws.onerror = () => diag.warn('STT', 'Cartesia STT socket error');
    ws.onclose = (ev: CloseEvent) => {
      if (ev.code !== 1000 && ev.code !== 1005) diag.warn('STT', `Cartesia STT socket closed ${ev.code}${ev.reason ? `: ${ev.reason}` : ''}`);
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
      diag.warn('STT', `Cartesia sent non-JSON: ${data.slice(0, 80)}`);
      return;
    }
    if (m.type === 'transcript') {
      // Final chunks are deltas to append; a partial is the words since the last final. A socket
      // being finalised still reports partials: they're the fallback if its final runs late.
      // The text keeps its own spacing: a final can start mid-word ("necrom" + "ancer"), and the
      // space before a new word is part of the segment, so the Transcript joins them as-is.
      const text = m.text ?? '';
      if (s.epoch < 0) return;
      if (m.is_final) {
        if (text.trim()) this.onFinal(text, s.epoch);
      } else this.onPartial(text, s.epoch);
      if (text.trim()) this.fails = 0;
    } else if (m.type === 'flush_done') {
      s.flushed?.();
    } else if (m.type === 'error') {
      // Cartesia ends a socket it won't serve (out of credit, a bad token) with an error: twice
      // running and it's given up on, so the browser's recogniser takes over instead of silence.
      diag.error('STT', `Cartesia STT error message: ${m.message ?? 'error'}`, m);
      this.onError(`Cartesia STT: ${m.message ?? 'error'}`);
      s.ws.close();
      if (++this.fails >= 2) this.giveUp(`Cartesia: ${m.message ?? 'error'}`);
    }
  }

  private giveUp(why: string): void {
    if (this.failed) return;
    this.failed = true;
    this.stop();
    this.onUnavailable(why);
  }
}

// Cartesia when the api has a key and the sockets connect; else the browser's own recogniser
// (Chrome, Edge, Safari); else the speech model running on this machine (localstt.ts: Arc, Brave,
// Firefox, offline). Brave's recogniser is known not to work, so Brave goes straight to the model.
// The controller only sees one SpeechSource either way.
type Engine = 'cartesia' | 'web' | 'local';
const ENGINE_NAME: Record<Engine, string> = { cartesia: 'Cartesia', web: 'browser speech', local: 'the speech model on this device' };
const isBrave = () => !!(navigator as unknown as { brave?: unknown }).brave;

export class AutoSpeech implements SpeechSource {
  onPartial = (_: string, _epoch: number) => {};
  onFinal = (_: string, _epoch: number) => {};
  onError = (_: string) => {};
  onFallback = () => {}; // Cartesia gave up and another engine took over
  onDead = (_why: string) => {}; // and nothing else works either: no speech at all
  onProgress = (_pct: number) => {}; // the on-device model downloading
  private cartesia: CartesiaSpeechSource;
  private web = new WebSpeechSource();
  private local: LocalSpeechSource;
  private engines: Record<Engine, SpeechSource>;
  private engineNow: Engine = 'cartesia';
  private on = false;
  private why: string[] = []; // why each engine before this one gave up

  constructor(stream: () => MediaStream | null) {
    this.cartesia = new CartesiaSpeechSource(stream);
    this.local = new LocalSpeechSource(stream);
    this.engines = { cartesia: this.cartesia, web: this.web, local: this.local };
    // Epochs are per engine; each later one starts a million on, so its words still sort after.
    const base: Record<Engine, number> = { cartesia: 0, web: 1e6, local: 2e6 };
    for (const k of Object.keys(this.engines) as Engine[]) {
      const s = this.engines[k];
      s.onPartial = (t, e) => k === this.engineNow && this.onPartial(t, e + base[k]);
      s.onFinal = (t, e) => k === this.engineNow && this.onFinal(t, e + base[k]);
      s.onError = msg => k === this.engineNow && this.onError(msg);
    }
    this.cartesia.onUnavailable = why => this.next('cartesia', why);
    this.web.onUnavailable = why => this.next('web', why);
    this.local.onUnavailable = why => this.next('local', why);
    this.local.onProgress = pct => this.onProgress(pct);
  }

  private get cur(): SpeechSource {
    return this.engines[this.engineNow];
  }

  // `from` gave up: on to the next engine that can run here, or no speech at all.
  private next(from: Engine, why: string): void {
    if (from !== this.engineNow) return;
    this.why.push(why);
    const order: Engine[] = from === 'cartesia' ? ['web', 'local'] : from === 'web' ? ['local'] : [];
    const to = order.find(k => this.engines[k].available && !(k === 'web' && isBrave()));
    if (from === 'cartesia') this.onFallback();
    if (!to) return this.onDead(this.why.join(', and '));
    diag.warn('STT', `${ENGINE_NAME[from]} unavailable (${why}), using ${ENGINE_NAME[to]}`);
    this.engines[from].stop();
    this.engineNow = to;
    if (to === 'local') this.local.load();
    if (this.on) {
      this.cur.start();
      this.onError(`listening (${ENGINE_NAME[to]})`);
    }
  }

  get engine(): string {
    return ENGINE_NAME[this.engineNow];
  }

  get available(): boolean {
    return this.cur.available;
  }

  // Words while you talk (Cartesia, the browser), or only once an utterance ends (the model).
  get live(): boolean {
    return this.engineNow !== 'local';
  }

  // Able to turn speech into words now: false while the model is still downloading.
  get ready(): boolean {
    return this.engineNow !== 'local' || this.local.ready;
  }

  // How long a fire waits for its last words to be final.
  get finalWaitMs(): number {
    return this.engineNow === 'local' ? LOCAL_WAIT_MS : FIRE_WAIT_MS;
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
    if (this.engineNow === 'cartesia') this.cartesia.warm();
    if (this.engineNow === 'local') this.local.load();
  }

  // Push to talk. The browser recogniser can't be gated, so it keeps listening and the lock's
  // transcript only takes words heard after the lock, as before.
  setGated(on: boolean): void {
    this.cartesia.setGated(on);
    this.local.setGated(on);
  }

  hold(on: boolean): Promise<void> {
    return this.engineNow === 'cartesia' ? this.cartesia.hold(on) : this.engineNow === 'local' ? this.local.hold(on) : Promise.resolve();
  }

  flush(timeoutMs: number): Promise<void> {
    return this.cur.flush(timeoutMs);
  }

  cut(timeoutMs: number): Cut {
    const c = this.cur.cut(timeoutMs);
    return { ...c, epoch: c.epoch + (this.engineNow === 'web' ? 1e6 : this.engineNow === 'local' ? 2e6 : 0) };
  }
}
