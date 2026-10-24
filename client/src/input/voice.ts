// Voice click: mic loudness, not the transcript, marks when speech starts. A recogniser reports
// words several hundred ms late, and the spot should lock where you pointed as you began to talk.

export function rmsDb(buf: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return 10 * Math.log10(s / Math.max(1, buf.length) + 1e-12);
}

export interface VadOptions {
  thresholdDb: number;
  startMs: number; // sound must last this long, so a click or a desk bump doesn't lock
  endMs: number; // this much quiet ends speech; long enough for "cancel" to beat the deploy
}
export const VAD_DEFAULTS: VadOptions = { thresholdDb: -45, startMs: 60, endMs: 700 };

export type VadEvent = { kind: 'start'; t: number } | { kind: 'end'; t: number } | null;

export class Vad {
  speaking = false;
  level = -120;
  private loudSince: number | null = null;
  private lastLoud = 0;

  constructor(public o: VadOptions = { ...VAD_DEFAULTS }) {}

  // Feed one level reading (dB) at time t (ms). A start event carries when the sound began.
  push(t: number, db: number): VadEvent {
    this.level = db;
    if (db > this.o.thresholdDb) {
      this.lastLoud = t;
      this.loudSince ??= t;
      if (!this.speaking && t - this.loudSince >= this.o.startMs) {
        this.speaking = true;
        return { kind: 'start', t: this.loudSince };
      }
      return null;
    }
    this.loudSince = null;
    if (this.speaking && t - this.lastLoud >= this.o.endMs) {
      this.speaking = false;
      return { kind: 'end', t };
    }
    return null;
  }

  reset(): void {
    this.speaking = false;
    this.loudSince = null;
  }
}

// Microphone level via an AnalyserNode. Browser only.
export class Mic {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private an: AnalyserNode | null = null;
  private buf = new Float32Array(1024);

  get on(): boolean {
    return !!this.an;
  }

  async start(): Promise<void> {
    if (this.an) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true } });
    this.ctx = new AudioContext();
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = this.buf.length;
    this.ctx.createMediaStreamSource(this.stream).connect(this.an);
    await this.ctx.resume();
  }

  stop(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = this.ctx = this.an = null;
  }

  levelDb(): number {
    if (!this.an) return -120;
    this.an.getFloatTimeDomainData(this.buf);
    return rmsDb(this.buf);
  }
}
