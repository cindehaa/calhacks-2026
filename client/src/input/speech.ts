// Transcript source. The lock logic only sees this interface: Cartesia streaming STT
// (cartesia_stt.ts) is the main one, and the browser recogniser below is its fallback.

export interface SpeechSource {
  readonly available: boolean;
  onPartial: (text: string) => void; // words of the utterance in progress, may still change
  onFinal: (text: string) => void; // a finished segment
  onError: (msg: string) => void;
  start(): void;
  stop(): void;
  // Resolve once the words heard so far have been finalised, or after timeoutMs. A streaming
  // STT would send its finalize message here and wait for the flush.
  flush(timeoutMs: number): Promise<void>;
}

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
  onPartial = (_: string) => {};
  onFinal = (_: string) => {};
  onError = (_: string) => {};
  private Ctor: SRCtor | undefined;
  private rec: SR | null = null;
  private pending = ''; // interim words not yet final
  private waiters: (() => void)[] = [];

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
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], text = r[0].transcript.trim();
        if (r.isFinal) {
          if (text) this.onFinal(text);
        } else interim += (interim ? ' ' : '') + text;
      }
      this.pending = interim;
      this.onPartial(interim);
      if (!interim) this.wake();
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.Ctor = undefined;
      this.onError(`speech recognition: ${e.error}`);
    };
    // Chrome ends a continuous session after a stretch of silence; keep it alive.
    rec.onend = () => {
      this.pending = '';
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
    this.pending = '';
    this.wake();
    if (rec) {
      rec.onend = null;
      try {
        rec.stop();
      } catch {}
    }
  }

  flush(timeoutMs: number): Promise<void> {
    if (!this.pending || !this.rec) return Promise.resolve();
    return new Promise(res => {
      const done = () => {
        clearTimeout(timer);
        res();
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== done);
        res();
      }, timeoutMs);
      this.waiters.push(done);
    });
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach(f => f());
  }
}

// Words heard since the last fire: finished segments plus the one in progress.
export class Transcript {
  private segments: string[] = [];
  private partial = '';
  reset(): void {
    this.segments = [];
    this.partial = '';
  }
  final(text: string): void {
    this.segments.push(text);
    this.partial = '';
  }
  interim(text: string): void {
    this.partial = text;
  }
  get pending(): boolean {
    return !!this.partial;
  }
  get partialText(): string {
    return this.partial;
  }
  get text(): string {
    return [...this.segments, this.partial].filter(Boolean).join(' ').trim();
  }
}

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
