// Pointer and pinch calibration runs, and where their results are kept between visits.
import { fitHomography, residualPx, type Homography, type Pt2 } from './homography';
import { choosePinch, type PinchMetric, type PinchThresholds } from './pinch';

// ---------- persistence ----------
// localStorage can throw (private windows, blocked site data); calibration is a convenience.

export function load<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, v: unknown): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export const KEYS = { pointer: 'arena.input.pointer', pinch: 'arena.input.pinch', prefs: 'arena.input.prefs' };

export interface PointerCal { H: Homography; residual: number }

// ---------- pointer: 4 targets, point and pinch at each ----------

// Screen corners inset by 10 %, in 0..1 of the window.
export const CAL_TARGETS: Pt2[] = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];

export class PointerCalibration {
  readonly samples: Pt2[] = [];
  private raw: { t: number; p: Pt2 }[] = [];

  constructor(private lagMs = 100) {}

  get index(): number {
    return this.samples.length;
  }

  get done(): boolean {
    return this.samples.length >= CAL_TARGETS.length;
  }

  // Raw (mirrored, unfiltered) camera-space pointer, every hand frame.
  pushRaw(t: number, p: Pt2): void {
    this.raw.push({ t, p });
    while (this.raw.length && this.raw[0].t < t - 1500) this.raw.shift();
  }

  // A pinch at t takes the median pointer over the 120 ms before the pinch began to move it.
  click(t: number): boolean {
    const end = t - this.lagMs;
    let pts = this.raw.filter(s => s.t <= end && s.t >= end - 120);
    if (!pts.length) pts = this.raw.slice(-3);
    if (!pts.length || this.done) return false;
    const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
    this.samples.push([med(pts.map(s => s.p[0])), med(pts.map(s => s.p[1]))]);
    return true;
  }

  result(w: number, h: number): PointerCal | null {
    const H = fitHomography(this.samples, CAL_TARGETS);
    return H ? { H, residual: residualPx(H, this.samples, CAL_TARGETS, w, h) } : null;
  }
}

// ---------- pinch: open hand, then a held pinch ----------

export const PINCH_PHASES = { openFrom: 1000, openTo: 3000, closedFrom: 4200, closedTo: 6700 };

export class PinchCalibration {
  private open: Record<PinchMetric, number[]> = { '2d': [], '3d': [] };
  private closed: Record<PinchMetric, number[]> = { '2d': [], '3d': [] };

  constructor(readonly start: number) {}

  // What to ask for at time t, and how far through the run we are (0..1).
  phase(t: number): { ask: 'open' | 'pinch'; recording: boolean; progress: number } {
    const P = PINCH_PHASES, dt = t - this.start;
    const ask = dt < P.openTo ? 'open' : 'pinch';
    const recording = (dt >= P.openFrom && dt < P.openTo) || (dt >= P.closedFrom && dt < P.closedTo);
    return { ask, recording, progress: Math.min(1, dt / P.closedTo) };
  }

  push(t: number, m2: number, m3: number): void {
    const P = PINCH_PHASES, dt = t - this.start;
    const b = dt >= P.openFrom && dt < P.openTo ? this.open : dt >= P.closedFrom && dt < P.closedTo ? this.closed : null;
    if (!b) return;
    b['2d'].push(m2);
    b['3d'].push(m3);
  }

  done(t: number): boolean {
    return t - this.start >= PINCH_PHASES.closedTo;
  }

  result(): (PinchThresholds & { score: number }) | null {
    return choosePinch(this.open, this.closed);
  }
}
