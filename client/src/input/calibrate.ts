// Pointer and pinch calibration runs, and where their results are kept between visits.
import { applyH, fitHomography, residualPx, type Homography, type Pt2 } from './homography';
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

// ---------- pointer: follow a dot around the screen ----------
// The dot traces a rectangle (corners inset 10 %), easing into each corner, then crosses to the
// middle. Every hand frame is a sample, so the fit uses hundreds of points instead of 4 pinches,
// and nothing depends on the pinch working yet. A hand trails a moving target; the fit finds by
// how much.

// Screen corners inset by 10 %, in 0..1 of the window.
export const CAL_TARGETS: Pt2[] = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
const PATH: Pt2[] = [...CAL_TARGETS, CAL_TARGETS[0], [0.5, 0.5]];
const SEGMENT_MS = [1800, 1300, 1800, 1300, 1000];
export const PURSUIT = { readyMs: 1500, holdMs: 500 };
export const PURSUIT_MS = PURSUIT.readyMs + SEGMENT_MS.reduce((a, b) => a + b) + PURSUIT.holdMs;

// Where the dot is dt ms into the run.
export function pursuitTarget(dt: number): Pt2 {
  let t = dt - PURSUIT.readyMs;
  if (t <= 0) return PATH[0];
  for (let i = 0; i < SEGMENT_MS.length; i++) {
    if (t < SEGMENT_MS[i]) {
      const s = t / SEGMENT_MS[i], e = s * s * (3 - 2 * s);
      const a = PATH[i], b = PATH[i + 1];
      return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
    }
    t -= SEGMENT_MS[i];
  }
  return PATH[PATH.length - 1];
}

export class PursuitCalibration {
  private samples: { dt: number; p: Pt2 }[] = [];

  constructor(readonly start: number) {}

  target(t: number): Pt2 {
    return pursuitTarget(t - this.start);
  }

  progress(t: number): number {
    return Math.min(1, (t - this.start) / PURSUIT_MS);
  }

  ready(t: number): boolean {
    return t - this.start < PURSUIT.readyMs;
  }

  done(t: number): boolean {
    return t - this.start >= PURSUIT_MS;
  }

  // Raw (mirrored, unfiltered) camera-space pointer, every hand frame. The ready phase is
  // skipped: the hand is still finding the first dot.
  push(t: number, raw: Pt2): void {
    const dt = t - this.start;
    if (dt >= PURSUIT.readyMs && dt <= PURSUIT_MS) this.samples.push({ dt, p: raw });
  }

  // Tries lags of 0–600 ms and keeps the best fit. Null if there's too little to fit, or the
  // hand barely moved.
  result(w: number, h: number): (PointerCal & { lagMs: number }) | null {
    const src = this.samples.map(s => s.p);
    if (src.length < 60) return null;
    const span = (k: 0 | 1) => Math.max(...src.map(p => p[k])) - Math.min(...src.map(p => p[k]));
    if (span(0) < 0.05 || span(1) < 0.04) return null;
    let best: (PointerCal & { lagMs: number }) | null = null;
    for (let lag = 0; lag <= 600; lag += 50) {
      const fit = trimmedFit(src, this.samples.map(s => pursuitTarget(s.dt - lag)), w, h);
      if (fit && (!best || fit.residual < best.residual)) best = { ...fit, lagMs: lag };
    }
    return best;
  }
}

// Fit, drop the worst 20 % (a glance away, overshooting a corner), fit again.
function trimmedFit(src: Pt2[], dst: Pt2[], w: number, h: number): PointerCal | null {
  const H0 = fitHomography(src, dst);
  if (!H0) return null;
  const err = src.map((p, i) => {
    const [u, v] = applyH(H0, p);
    return ((u - dst[i][0]) * w) ** 2 + ((v - dst[i][1]) * h) ** 2;
  });
  const cut = [...err].sort((a, b) => a - b)[Math.floor(err.length * 0.8)];
  const keep = err.flatMap((e, i) => (e <= cut ? [i] : []));
  const s = keep.map(i => src[i]), d = keep.map(i => dst[i]);
  const H = fitHomography(s, d);
  return H && { H, residual: residualPx(H, s, d, w, h) };
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
