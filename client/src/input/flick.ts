// Flick = the fingertips snap down while the wrist stays put: a flick of the wrist, not a swing of
// the arm, so the aim (taken from before the flick) isn't thrown off. Speeds are in hand sizes per
// second, so distance from the camera doesn't matter.
import { handSize, type Landmark } from './pinch';

export interface FlickOptions {
  speed: number; // fingertips moving down relative to the wrist, hand sizes / s
  wristRatio: number; // the wrist may move at most speed / wristRatio: an arm swing isn't a flick
  windowMs: number; // speed is measured over this span, which smooths landmark jitter
  cooldownMs: number;
}
export const FLICK_DEFAULTS: FlickOptions = { speed: 5, wristRatio: 2, windowMs: 90, cooldownMs: 600 };

interface Sample { t: number; tip: [number, number]; wrist: [number, number] }

export class FlickDetector {
  private pts: Sample[] = [];
  private last = -Infinity;
  constructor(readonly o: FlickOptions = FLICK_DEFAULTS) {}

  // Returns the time the flick began (the aim should come from then), or null.
  update(t: number, lm: Landmark[], vw: number, vh: number): number | null {
    const s = handSize(lm, vw, vh);
    const P = (i: number): [number, number] => [(lm[i].x * vw) / s, (lm[i].y * vh) / s];
    const tip: [number, number] = [(P(8)[0] + P(12)[0]) / 2, (P(8)[1] + P(12)[1]) / 2];
    this.pts.push({ t, tip, wrist: P(0) });
    while (this.pts.length > 1 && this.pts[0].t < t - this.o.windowMs) this.pts.shift();
    const a = this.pts[0], b = this.pts[this.pts.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt < (this.o.windowMs * 0.4) / 1000 || t - this.last < this.o.cooldownMs) return null;
    const down = (b.tip[1] - a.tip[1] - (b.wrist[1] - a.wrist[1])) / dt;
    const wrist = Math.hypot(b.wrist[0] - a.wrist[0], b.wrist[1] - a.wrist[1]) / dt;
    if (down < this.o.speed || wrist > down / this.o.wristRatio) return null;
    this.last = t;
    this.pts = [];
    return a.t - this.o.windowMs / 2; // it was already under way when the window opened
  }

  reset(): void {
    this.pts = [];
  }
}
