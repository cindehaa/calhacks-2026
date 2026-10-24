// Hand pose from the landmarks: how big the hand is, how straight the fingers are, a thumbs down
// and a pinch.

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

// ---------- thumbs down ----------
// The cancel gesture: thumb out and pointing down, the four fingers curled. Chosen because it is
// the pose least like a pinch (thumb tip up against a finger) and the open hand after one. Scored
// 0..1 from the landmarks, since MediaPipe's gesture model isn't loaded: every part has to hold,
// so the score is the weakest of them.
export function thumbDownScore(lm: Landmark[], world: Landmark[], vw: number, vh: number): number {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const s = handSize(lm, vw, vh);
  const dx = (lm[4].x - lm[2].x) * vw, dy = (lm[4].y - lm[2].y) * vh; // thumb base → tip, image y grows down
  const down = clamp01((dy / s - 0.15) / 0.25); // tip well below the base
  const vertical = clamp01((dy / (Math.hypot(dx, dy) || 1e-9) - 0.6) / 0.25); // pointing down, not sideways
  const knuckles = Math.max(lm[5].y, lm[9].y, lm[13].y, lm[17].y) * vh;
  const below = clamp01(((lm[4].y * vh - knuckles) / s) / 0.15); // and below every knuckle
  const curled = clamp01((1.5 - extension(world)) / 0.35); // the other four folded in
  return Math.min(down, vertical, below, curled);
}

// ---------- pinch ----------
// Thumb tip against a finger's last segment, in hand sizes (the measure and thresholds from the
// earlier pinch controls). Either the index or the middle finger counts, whichever closes first:
// thumb to middle alone was hard for some hands.
export const PINCH_DEFAULTS = { on: 0.45, off: 0.65 };
const THUMB_TIP = 4;
const INDEX: [number, number] = [7, 8], MIDDLE: [number, number] = [11, 12]; // DIP → TIP

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
  const d = ([a, b]: [number, number]) => segDist(P(THUMB_TIP), P(a), P(b)) / s;
  return Math.min(d(INDEX), d(MIDDLE));
}

// A pinch closing this soon after the last one fired doesn't fire: in prod, a pointing hand's
// thumb resting on the curled middle finger re-closed every 300-500 ms and fired empty deploys.
export const PINCH_COOLDOWN_MS = 500;

// What the last pinch looked like as it closed, for the logs.
export interface PinchShot { ratio: number; openMs: number; sinceLastMs: number; held: number }

// True once per pinch, on the frame it closes; it has to open past `off` before the next, and
// not within cooldownMs of the last one that fired.
export class PinchDetector {
  ratio = 1;
  last: PinchShot | null = null;
  private hyst: Hysteresis;
  private firedAt = -Infinity;
  private openedAt = -Infinity;
  private held = 0; // closes swallowed by the cooldown since the last fire
  constructor(readonly o = { ...PINCH_DEFAULTS, cooldownMs: PINCH_COOLDOWN_MS }) {
    this.hyst = new Hysteresis(o.on, o.off);
  }
  get closed(): boolean {
    return this.hyst.on;
  }
  update(lm: Landmark[], vw: number, vh: number, t: number): boolean {
    return this.push(pinchMetric(lm, vw, vh), t);
  }
  push(ratio: number, t: number): boolean {
    this.ratio = ratio;
    const was = this.hyst.on;
    const now = this.hyst.update(ratio);
    if (was && !now) this.openedAt = t;
    if (!now || was) return false;
    if (t - this.firedAt < this.o.cooldownMs) {
      this.held++;
      return false;
    }
    this.last = { ratio, openMs: t - this.openedAt, sinceLastMs: t - this.firedAt, held: this.held };
    this.firedAt = t;
    this.held = 0;
    return true;
  }
  // A different hand took control: its first pinch counts only after it has been seen open, so a
  // hand that arrives already closed (one wrapped round the mic) doesn't fire on the switch.
  rearm(): void {
    this.hyst.on = true;
  }
  reset(): void {
    this.hyst.reset();
  }
}
