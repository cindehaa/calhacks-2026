// Pinch = thumb tip against a finger's last segment. Pinching with the middle finger leaves the
// index knuckle, which aims, almost still; the index finger is the pinch people already know.

export interface Landmark { x: number; y: number; z: number }

export const DEFAULT_PINCH = { on: 0.45, off: 0.65 };

export type PinchFinger = 'middle' | 'index';
const THUMB_TIP = 4;
const SEGMENT: Record<PinchFinger, [number, number]> = { middle: [11, 12], index: [7, 8] }; // DIP → TIP

// Distance from p to the segment ab. The thumb meets the pad of the finger, not its tip landmark.
export function segDist(p: number[], a: number[], b: number[]): number {
  const ab = a.map((v, i) => b[i] - v), ap = a.map((v, i) => p[i] - v);
  const len2 = ab.reduce((s, v) => s + v * v, 0) || 1e-9;
  const t = Math.max(0, Math.min(1, ab.reduce((s, v, i) => s + v * ap[i], 0) / len2));
  return Math.hypot(...ap.map((v, i) => v - t * ab[i]));
}

// Hand size in pixels. A hand pointing at the camera foreshortens wrist → middle knuckle, so palm
// width also counts.
export function handSize(lm: Landmark[], vw: number, vh: number): number {
  const d = (i: number, j: number) => Math.hypot((lm[i].x - lm[j].x) * vw, (lm[i].y - lm[j].y) * vh);
  return Math.max(d(0, 9), d(5, 17) / 0.8) || 1e-9;
}

// Image-space measure. Landmarks are 0..1 of the frame, so scale by its size to keep it square.
export function pinchMetric2d(lm: Landmark[], vw: number, vh: number, finger: PinchFinger = 'middle'): number {
  const P = (i: number) => [lm[i].x * vw, lm[i].y * vh];
  const [a, b] = SEGMENT[finger];
  return segDist(P(THUMB_TIP), P(a), P(b)) / handSize(lm, vw, vh);
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
  reset(): void {
    this.on = false;
  }
}

// When the fingers started closing: the most open moment in the last windowMs. The pointer is
// judged from there, before the pinch itself dragged it.
export class PinchOnset {
  private pts: { t: number; v: number }[] = [];
  constructor(private windowMs = 400) {}
  push(t: number, v: number): void {
    this.pts.push({ t, v });
    while (this.pts.length && this.pts[0].t < t - this.windowMs) this.pts.shift();
  }
  onset(): number | null {
    let best: { t: number; v: number } | null = null;
    for (const p of this.pts) if (!best || p.v >= best.v) best = p;
    return best?.t ?? null;
  }
  clear(): void {
    this.pts = [];
  }
}
