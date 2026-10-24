// Transcript source. The lock logic only sees this interface: Cartesia streaming STT
// (cartesia_stt.ts) is the main one, and the browser recogniser below is its fallback.

export interface SpeechSource {
  readonly available: boolean;
  // Every transcript carries the epoch of the audio it came from. cut() ends an epoch at the
  // moment it's called, so a fire can tell the words said before it from the words said after.
  onPartial: (text: string, epoch: number) => void; // words of the utterance in progress, may still change
  onFinal: (text: string, epoch: number) => void; // a finished segment
  onError: (msg: string) => void;
  start(): void;
  stop(): void;
  // Resolve once the words heard so far have been finalised, or after timeoutMs. A streaming
  // STT would send its finalize message here and wait for the flush.
  flush(timeoutMs: number): Promise<void>;
  // End the current epoch now: audio from here on is the next epoch. done resolves once the
  // ended epoch's words are final (or after timeoutMs).
  cut(timeoutMs: number): Cut;
}

export interface Cut { epoch: number; done: Promise<void> }

// Keyless fallback: the browser's Web Speech API (Chrome sends audio to Google, needs no key).
interface SRResult { isFinal: boolean; 0: { transcript: string } }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SR {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SRCtor = new () => SR;

export class WebSpeechSource implements SpeechSource {
  onPartial = (_: string, _epoch: number) => {};
  onFinal = (_: string, _epoch: number) => {};
  onError = (_: string) => {};
  private Ctor: SRCtor | undefined;
  private rec: SR | null = null;
  private pending = new Map<number, string>(); // interim words not yet final, by epoch
  private waiters: (() => void)[] = [];
  private epoch = 0;
  private epochOf: number[] = []; // epoch of each result index in this recognition session

  constructor() {
    const w = globalThis as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
    this.Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  }

  get available(): boolean {
    return !!this.Ctor;
  }

  start(): void {
    if (!this.Ctor || this.rec) return;
    const rec = new this.Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    // The recogniser can't be split mid-result, so a result belongs to the epoch it started in:
    // the one in progress at a fire is the troop's, the next one starts the next troop.
    rec.onresult = e => {
      const interim = new Map<number, string>();
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], text = r[0].transcript.trim();
        const ep = (this.epochOf[i] ??= this.epoch);
        // Each result is whole words, so it carries a leading space like Cartesia's segments.
        if (r.isFinal) {
          if (text) this.onFinal(` ${text}`, ep);
        } else if (text) interim.set(ep, `${interim.get(ep) ?? ''} ${text}`);
      }
      for (const ep of new Set([...this.pending.keys(), ...interim.keys()])) this.onPartial(interim.get(ep) ?? '', ep);
      this.pending = interim;
      this.wake();
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.Ctor = undefined;
      this.onError(`speech recognition: ${e.error}`);
    };
    // Chrome ends a continuous session after a stretch of silence; keep it alive.
    rec.onend = () => {
      this.pending.clear();
      this.epochOf = [];
      this.wake();
      if (this.rec === rec && this.Ctor) {
        try {
          rec.start();
        } catch {
          this.rec = null;
        }
      } else if (this.rec === rec) this.rec = null;
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (e) {
      this.rec = null;
      this.onError(`speech recognition: ${(e as Error).message}`);
    }
  }

  stop(): void {
    const rec = this.rec;
    this.rec = null;
    this.pending.clear();
    this.epochOf = [];
    this.wake();
    if (rec) {
      rec.onend = null;
      try {
        rec.stop();
      } catch {}
    }
  }

  flush(timeoutMs: number): Promise<void> {
    return this.until(() => !this.pending.size || !this.rec, timeoutMs);
  }

  cut(timeoutMs: number): Cut {
    const epoch = this.epoch++;
    return { epoch, done: this.until(() => !this.pending.has(epoch) || !this.rec, timeoutMs) };
  }

  // Resolve once settled() holds, checked after each result, or after timeoutMs.
  private until(settled: () => boolean, timeoutMs: number): Promise<void> {
    if (settled()) return Promise.resolve();
    return new Promise(res => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== check);
        res();
      }, timeoutMs);
      const check = () => {
        if (!settled()) return void this.waiters.push(check);
        clearTimeout(timer);
        res();
      };
      this.waiters.push(check);
    });
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach(f => f());
  }
}

// Words heard since the last fire: finished segments plus the ones in progress, in epoch order.
// Each epoch has at most one utterance in progress (a streaming socket, or a recogniser result).
// Segments carry their own spacing (Cartesia's finals can split a word: "necrom" + "ancer"), so
// within an epoch they're concatenated as-is; epochs are separate utterances and get a space.
export class Transcript {
  private segments: { epoch: number; text: string }[] = [];
  private partials = new Map<number, string>();
  reset(): void {
    this.segments = [];
    this.partials.clear();
  }
  final(text: string, epoch = 0): void {
    this.segments.push({ epoch, text });
    this.partials.delete(epoch);
  }
  interim(text: string, epoch = 0): void {
    if (text.trim()) this.partials.set(epoch, text);
    else this.partials.delete(epoch);
  }
  get pending(): boolean {
    return this.partials.size > 0;
  }
  partialEntries(): [number, string][] {
    return [...this.partials];
  }
  get text(): string {
    const epochs = [...new Set([...this.segments.map(s => s.epoch), ...this.partials.keys()])].sort((a, b) => a - b);
    return epochs
      .map(e => [...this.segments.filter(s => s.epoch === e).map(s => s.text), this.partials.get(e) ?? ''].join(''))
      .join(' ').replace(/\s+/g, ' ').trim();
  }
}

// Where a transcript goes. A fire cuts the audio at the moment it happens: words from before the
// cut belong to that troop (while it waits for them, then they're stale), words from after it
// start the next troop. dropped is the newest epoch already spent (fired, landed or cleared).
export type Route = 'firing' | 'prompt' | 'drop';
export function routeWords(epoch: number, firingCut: number | null, dropped: number): Route {
  if (firingCut !== null && epoch <= firingCut) return 'firing';
  return epoch <= dropped ? 'drop' : 'prompt';
}

// Whether a fire should start a deploy and wait for its words. With words already heard or typed,
// always. With none yet, only if the mic is listening, heard speech in the last moment, and that
// speech started after the last fire: the recogniser runs most of a second behind the voice, so
// the words are still on their way. Loudness alone isn't enough: in a noisy room the mic is always
// loud, and every stray pinch became a deploy cancelled with nothing heard.
export const RECENT_SPEECH_MS = 1500;
export function fireWaits(o: { said: string; typed: string; listening: boolean; msSinceSpeech: number; spokeSinceFire: boolean }): boolean {
  if (o.said.trim() || o.typed.trim()) return true;
  return o.listening && o.spokeSinceFire && o.msSinceSpeech <= RECENT_SPEECH_MS;
}

// How long a fire waits for its words to be finalised. The 2.5 s deploy delay hides this.
export const FIRE_WAIT_MS = 700;

// "cancel", "cancel that", "never mind": the whole utterance, so "cancel culture" still deploys.
export function isCancel(text: string): boolean {
  return /^(cancel( (that|it))?|never ?mind|nevermind)$/i.test(text.trim().replace(/[.,!?]/g, ''));
}

// "that's wrong", "not what I said": the player flagging their last troop as a bad match for
// their words. The whole utterance, like cancel, so "wrong way giant" still deploys.
export function isMismatch(text: string): boolean {
  return /^(that'?s|that is|thats) (wrong|not it|not right|not what i (said|asked for|wanted))$|^(wrong( troop| one)?|not what i (said|asked for|wanted))$/i
    .test(text.trim().replace(/[.,!?]/g, ''));
}

export type Description = { ok: true; text: string; from: 'typed' | 'voice' } | { ok: false; reason: 'cancel' | 'empty' };

// What a fire sends: a spoken cancel wins, then typed text (so typing keeps working with the
// hand), then the transcript.
export function chooseDescription(typed: string, transcript: string): Description {
  if (isCancel(transcript)) return { ok: false, reason: 'cancel' };
  if (typed.trim()) return { ok: true, text: typed.trim(), from: 'typed' };
  if (transcript.trim()) return { ok: true, text: transcript.trim(), from: 'voice' };
  return { ok: false, reason: 'empty' };
}
