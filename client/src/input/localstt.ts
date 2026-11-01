// Speech to text on the player's own machine, the last resort before typing: for browsers whose own
// recogniser doesn't work (Arc, Brave, Firefox) when Cartesia isn't there either. The model
// (localstt.worker.ts) hears whole clips, not a stream, so it gives no words while you talk, only
// when an utterance ends: with pinch to talk that's the hold, from just before the pinch to the
// release; listening all the time it's each stretch of speech, ended by the controller's quiet
// timer (flush). A clip is transcribed in about 0.2 s, inside the deploy delay. The model is
// ~60 MB, fetched once when this engine is first needed and cached by the browser.
import { diag } from '../diag';
import { capture16k, CHUNK, RATE } from './pcm';
import { PreRoll } from './ptt';
import type { Cut, SpeechSource } from './speech';
import type { FromWorker, ToWorker } from './localstt.worker';

const PREROLL = 6; // 300 ms kept from before a push-to-talk hold
const TAIL_MS = 80; // after a release, wait for the chunk still filling
const MAX_CHUNKS = (12 * RATE) / CHUNK; // a clip keeps at most its last 12 s
const PAD_BEFORE = 0.3, PAD_AFTER = 0.5; // s of silence round a clip: without them it clips words at the edges
const MIN_SECS = 0.25; // shorter is a click, not words
const MIN_RMS = 0.004; // quieter is the room, not someone talking
export const LOCAL_WAIT_MS = 2500; // how long a fire waits for its words (the first may wait on the model)

export class LocalSpeechSource implements SpeechSource {
  onPartial = (_: string, _epoch: number) => {};
  onFinal = (_: string, _epoch: number) => {};
  onError = (_: string) => {};
  onUnavailable = (_: string) => {};
  onProgress = (_pct: number) => {}; // the model downloading
  readonly live = false; // words only at the end of an utterance
  ready = false; // the model is loaded
  private failed = !('Worker' in globalThis);
  private worker: Worker | null = null;
  private on = false;
  private ctx: AudioContext | null = null;
  private clip: ArrayBuffer[] = []; // the current epoch's audio not yet transcribed
  private epoch = 0;
  private gate = false;
  private held = false;
  private preroll = new PreRoll<ArrayBuffer>(PREROLL);
  private tail: (() => void) | null = null;
  private runs = new Map<number, (text: string) => void>();
  private busy = new Map<number, Set<Promise<void>>>(); // transcriptions still running, by epoch
  private nextId = 0;

  constructor(private stream: () => MediaStream | null) {}

  get available(): boolean {
    return !this.failed;
  }

  // Start fetching the model, ahead of the first words.
  load(): void {
    if (this.worker || this.failed) return;
    try {
      this.worker = new Worker(new URL('./localstt.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      return this.giveUp(`the speech model can’t run here (${(e as Error).message})`);
    }
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'progress') this.onProgress(m.pct);
      else if (m.type === 'ready') {
        this.ready = true;
        diag.info('STT', `speech model ready on ${m.device} in ${m.ms} ms`);
      } else if (m.type === 'failed') this.giveUp(`the speech model failed to load (${m.why})`);
      else if (m.type === 'text') {
        this.runs.get(m.id)?.(m.text);
        this.runs.delete(m.id);
        if (m.text) diag.info('STT', `speech model: "${m.text}" in ${m.ms} ms`);
      }
    };
    this.worker.onerror = e => this.giveUp(`the speech model crashed (${e.message})`);
    this.post({ type: 'load' });
  }

  start(): void {
    if (this.on || this.failed) return;
    const stream = this.stream();
    if (!stream) return;
    this.on = true;
    this.load();
    const ctx = (this.ctx = new AudioContext());
    capture16k(ctx, stream, c => this.audio(c), () => this.ctx === ctx).catch(e => this.giveUp(`audio capture: ${(e as Error).message}`));
  }

  stop(): void {
    this.on = false;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.clip = [];
    this.preroll.clear();
    this.tail?.();
    this.held = false;
  }

  setGated(on: boolean): void {
    if (on === this.gate) return;
    this.gate = on;
    this.preroll.clear();
  }

  // A pinch: its clip starts with the 300 ms before it. Letting go waits for the last chunk.
  hold(on: boolean): Promise<void> {
    if (on === this.held) return Promise.resolve();
    if (on) {
      this.held = true;
      if (this.gate) this.clip.push(...this.preroll.take());
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

  // The talking stopped: what was said so far in this epoch becomes words.
  flush(timeoutMs: number): Promise<void> {
    return within(this.track(this.epoch), timeoutMs);
  }

  // A fire: this epoch's clip is the troop's words; what comes next is the next epoch. Done once
  // every clip of the epoch is words, including one a flush already took (the talking stopped
  // before the release).
  cut(timeoutMs: number): Cut {
    const epoch = this.epoch++;
    this.track(epoch);
    return { epoch, done: within(Promise.all(this.busy.get(epoch) ?? []).then(() => {}), timeoutMs) };
  }

  private track(epoch: number): Promise<void> {
    const p = this.transcribe(epoch);
    const set = this.busy.get(epoch) ?? new Set();
    set.add(p);
    this.busy.set(epoch, set);
    void p.finally(() => {
      set.delete(p);
      if (!set.size) this.busy.delete(epoch);
    });
    return p;
  }

  private audio(chunk: ArrayBuffer): void {
    if (this.gate && !this.held) return this.preroll.push(chunk);
    this.clip.push(chunk);
    if (this.clip.length > MAX_CHUNKS) this.clip.shift();
    this.tail?.();
  }

  // Take the clip so far and turn it into words for `epoch`. Quiet or very short clips are skipped.
  private async transcribe(epoch: number): Promise<void> {
    const chunks = this.clip.splice(0);
    const n = chunks.length * CHUNK;
    if (!this.worker || n < MIN_SECS * RATE) return;
    const audio = new Float32Array(Math.round((PAD_BEFORE + PAD_AFTER) * RATE) + n);
    let at = Math.round(PAD_BEFORE * RATE), sum = 0;
    for (const c of chunks) {
      const s = new Int16Array(c);
      for (let i = 0; i < s.length; i++) {
        const v = s[i] / 0x8000;
        audio[at++] = v;
        sum += v * v;
      }
    }
    if (Math.sqrt(sum / n) < MIN_RMS) return;
    const id = ++this.nextId;
    const text = await new Promise<string>(res => {
      this.runs.set(id, res);
      this.post({ type: 'run', id, audio }, [audio.buffer]);
    });
    if (text) this.onFinal(` ${text}`, epoch);
  }

  private post(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(m, transfer);
  }

  private giveUp(why: string): void {
    if (this.failed) return;
    this.failed = true;
    diag.error('STT', why);
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    for (const r of this.runs.values()) r('');
    this.runs.clear();
    this.onUnavailable(why);
  }
}

const within = (p: Promise<void>, ms: number) => Promise.race([p, new Promise<void>(r => setTimeout(r, ms))]);
