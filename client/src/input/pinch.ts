// Pinch = thumb tip against the middle finger. Pinching with the middle finger leaves the index
// knuckle, which aims, almost still.

export interface Landmark { x: number; y: number; z: number }

export const DEFAULT_PINCH = { on: 0.45, off: 0.65 };

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
