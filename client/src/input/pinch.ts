// Pinch = thumb tip against the middle finger. Pinching with the middle finger leaves the index
// knuckle, which aims, almost still.

export interface Landmark { x: number; y: number; z: number }

export type PinchMetric = '2d' | '3d';
export interface PinchThresholds { metric: PinchMetric; on: number; off: number }
export const DEFAULT_PINCH: PinchThresholds = { metric: '2d', on: 0.45, off: 0.65 };

const THUMB_TIP = 4, SEG_A = 11, SEG_B = 12; // middle finger DIP → TIP

// Distance from p to the segment ab. The thumb meets the pad of the finger, not its tip landmark.
export function segDist(p: number[], a: number[], b: number[]): number {
  const ab = a.map((v, i) => b[i] - v), ap = a.map((v, i) => p[i] - v);
  const len2 = ab.reduce((s, v) => s + v * v, 0) || 1e-9;
  const t = Math.max(0, Math.min(1, ab.reduce((s, v, i) => s + v * ap[i], 0) / len2));
  return Math.hypot(...ap.map((v, i) => v - t * ab[i]));
}

// Image-space measure. Landmarks are 0..1 of the frame, so scale by its size to keep it square.
// A hand pointing at the camera foreshortens wrist → middle knuckle, so palm width also counts.
export function pinchMetric2d(lm: Landmark[], vw: number, vh: number): number {
  const P = (i: number) => [lm[i].x * vw, lm[i].y * vh];
  const d = (i: number, j: number) => Math.hypot(P(i)[0] - P(j)[0], P(i)[1] - P(j)[1]);
  const size = Math.max(d(0, 9), d(5, 17) / 0.8) || 1e-9;
  return segDist(P(THUMB_TIP), P(SEG_A), P(SEG_B)) / size;
}

// World-space measure (metres from MediaPipe's world landmarks), immune to foreshortening in x/y.
export function pinchMetric3d(wl: Landmark[]): number {
  const P = (i: number) => [wl[i].x, wl[i].y, wl[i].z];
  const size = Math.hypot(wl[0].x - wl[9].x, wl[0].y - wl[9].y, wl[0].z - wl[9].z) || 1e-9;
  return segDist(P(THUMB_TIP), P(SEG_A), P(SEG_B)) / size;
}

// Two thresholds so a value hovering near one line doesn't flicker the pinch on and off.
export class Hysteresis {
  on = false;
  constructor(public onBelow: number, public offAbove: number) {}
  update(v: number): boolean {
    if (!this.on && v < this.onBelow) this.on = true;
    else if (this.on && v > this.offAbove) this.on = false;
    return this.on;
  }
}

const quantile = (a: number[], p: number) => {
  const b = [...a].sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.floor(p * b.length))];
};

export interface PinchFit { on: number; off: number; score: number; openMed: number; closedMed: number }

// Thresholds from samples of an open hand and a held pinch. With a clean gap between the
// pinched 90th percentile and the open 10th, put on/off at 30 % / 60 % of it; otherwise split
// the medians. Score = gap relative to the spread, higher is a cleaner separation.
export function fitPinch(open: number[], closed: number[]): PinchFit | null {
  if (open.length < 10 || closed.length < 10) return null;
  const closedHi = quantile(closed, 0.9), openLo = quantile(open, 0.1);
  const openMed = quantile(open, 0.5), closedMed = quantile(closed, 0.5);
  const gap = openLo - closedHi;
  const score = gap / Math.max(openMed - closedMed, 1e-6);
  const [on, off] =
    gap > 0
      ? [closedHi + 0.3 * gap, closedHi + 0.6 * gap]
      : [closedMed + 0.4 * (openMed - closedMed), closedMed + 0.6 * (openMed - closedMed)];
  return { on: round2(on), off: round2(Math.max(off, on + 0.01)), score, openMed, closedMed };
}

// Pick the measure that separates open from pinched better.
export function choosePinch(
  open: Record<PinchMetric, number[]>,
  closed: Record<PinchMetric, number[]>
): (PinchThresholds & { score: number }) | null {
  const f2 = fitPinch(open['2d'], closed['2d']), f3 = fitPinch(open['3d'], closed['3d']);
  if (!f2 && !f3) return null;
  const use3 = !!f3 && (!f2 || f3.score > f2.score);
  const f = (use3 ? f3 : f2)!;
  return { metric: use3 ? '3d' : '2d', on: f.on, off: f.off, score: f.score };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
