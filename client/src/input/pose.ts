// Hand pose from the landmarks: how big the hand is, how straight the fingers are, and a fist.

export interface Landmark { x: number; y: number; z: number }

// Hand size in pixels. A hand pointing at the camera foreshortens wrist → middle knuckle, so palm
// width also counts.
export function handSize(lm: Landmark[], vw: number, vh: number): number {
  const d = (i: number, j: number) => Math.hypot((lm[i].x - lm[j].x) * vw, (lm[i].y - lm[j].y) * vh);
  return Math.max(d(0, 9), d(5, 17) / 0.8) || 1e-9;
}

const FINGERS: [number, number][] = [[5, 8], [9, 12], [13, 16], [17, 20]]; // knuckle, tip; no thumb

// How straight the four fingers are: wrist → tip over wrist → knuckle, averaged. About 1.9 for an
// open hand, under 1 for a fist. Uses the 3D world landmarks, so a finger pointing at the camera
// still reads straight.
export function extension(world: Landmark[]): number {
  const d = (i: number, j: number) => Math.hypot(world[i].x - world[j].x, world[i].y - world[j].y, world[i].z - world[j].z);
  return FINGERS.reduce((s, [k, t]) => s + d(0, t) / (d(0, k) || 1e-9), 0) / FINGERS.length;
}

// Two thresholds so a value hovering near one line doesn't flicker on and off.
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

export interface FistOptions {
  on: number; // extension below this closes the fist
  off: number; // and above this opens it again
  holdMs: number; // closed this long before it counts, so a hand passing through doesn't
  straight: number; // a flick only counts with fingers straighter than this
  afterMs: number; // nor this soon after a fist (opening the hand again)
}
export const FIST_DEFAULTS: FistOptions = { on: 1.15, off: 1.4, holdMs: 120, straight: 1.5, afterMs: 400 };

export class FistDetector {
  ext = 2; // the last extension seen
  private hyst: Hysteresis;
  private closedAt: number | null = null;
  private fired = false;
  private lastFist = -Infinity;
  constructor(readonly o: FistOptions = FIST_DEFAULTS) {
    this.hyst = new Hysteresis(o.on, o.off);
  }

  get closed(): boolean {
    return this.hyst.on;
  }

  // True once per fist, when it has been held for holdMs.
  update(t: number, world: Landmark[]): boolean {
    this.ext = extension(world);
    if (!this.hyst.update(this.ext)) {
      this.closedAt = null;
      this.fired = false;
      return false;
    }
    this.closedAt ??= t;
    this.lastFist = t;
    if (this.fired || t - this.closedAt < this.o.holdMs) return false;
    this.fired = true;
    return true;
  }

  // Whether a flick now can be trusted: fingers straight, and not just out of a fist. Curling the
  // fingers into a fist snaps the tips down just like a flick.
  allowsFlick(t: number): boolean {
    return this.ext > this.o.straight && !this.hyst.on && t - this.lastFist > this.o.afterMs;
  }

  reset(): void {
    this.hyst.reset();
    this.closedAt = null;
    this.fired = false;
  }
}

// ---------- pinch ----------
// Thumb tip against a finger's last segment, in hand sizes (the measure and thresholds from the
// earlier pinch controls). Either the index or the middle finger counts, whichever is closer, so
// a pinch that drifts between them still reads.
export const PINCH_DEFAULTS = { on: 0.45, off: 0.65 };
const THUMB_TIP = 4;
const PINCH_SEGMENTS: [number, number][] = [[7, 8], [11, 12]]; // index, middle: DIP → TIP

// Distance from p to the segment ab. The thumb meets the pad of the finger, not its tip landmark.
export function segDist(p: number[], a: number[], b: number[]): number {
  const ab = a.map((v, i) => b[i] - v), ap = a.map((v, i) => p[i] - v);
  const len2 = ab.reduce((s, v) => s + v * v, 0) || 1e-9;
  const t = Math.max(0, Math.min(1, ab.reduce((s, v, i) => s + v * ap[i], 0) / len2));
  return Math.hypot(...ap.map((v, i) => v - t * ab[i]));
}

export function pinchMetric(lm: Landmark[], vw: number, vh: number): number {
  const P = (i: number) => [lm[i].x * vw, lm[i].y * vh];
  const s = handSize(lm, vw, vh);
  return Math.min(...PINCH_SEGMENTS.map(([a, b]) => segDist(P(THUMB_TIP), P(a), P(b)))) / s;
}

// True once per pinch, on the frame it closes; it has to open past `off` before the next.
export class PinchDetector {
  ratio = 1;
  private hyst: Hysteresis;
  constructor(readonly o = PINCH_DEFAULTS) {
    this.hyst = new Hysteresis(o.on, o.off);
  }
  get closed(): boolean {
    return this.hyst.on;
  }
  update(lm: Landmark[], vw: number, vh: number): boolean {
    return this.push(pinchMetric(lm, vw, vh));
  }
  push(ratio: number): boolean {
    this.ratio = ratio;
    const was = this.hyst.on;
    return this.hyst.update(ratio) && !was;
  }
  reset(): void {
    this.hyst.reset();
  }
}
