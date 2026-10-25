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
// earlier pinch controls). Any of the four fingers counts, whichever closes first: thumb to middle
// alone was hard for some hands, and the aim no longer needs the index held still (pointerOf).
export interface PinchThresholds { on: number; off: number }
export const PINCH_DEFAULTS: PinchThresholds = { on: 0.45, off: 0.65 };
const THUMB_TIP = 4;
const PADS: [number, number][] = [[7, 8], [11, 12], [15, 16], [19, 20]]; // DIP → TIP, index to pinky

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
  return Math.min(...PADS.map(d));
}

// Fitting the thresholds to one player's hand (practice.ts): the measure with the hand pointing
// as it would to aim, and with it pinched and held. Hands differ in how far thumb and pad sit
// apart when touching, and some rest the thumb on the curled middle finger while pointing, so
// the pinch closes 40% of the way from pinched to pointing and opens again at 65%. Null when the
// two are too alike to tell apart.
export const PINCH_RANGE = { minGap: 0.2, closeAt: 0.4, openAt: 0.65, onMin: 0.15, onMax: 0.7, offMax: 0.9, minSpread: 0.08 };
export function fitPinch(pointing: number, pinched: number): PinchThresholds | null {
  const r = PINCH_RANGE, gap = pointing - pinched;
  if (!(gap >= r.minGap)) return null;
  const on = Math.min(r.onMax, Math.max(r.onMin, pinched + r.closeAt * gap));
  const off = Math.min(r.offMax, Math.max(on + r.minSpread, pinched + r.openAt * gap));
  return { on: round2(on), off: round2(off) };
}
const round2 = (v: number) => Math.round(v * 100) / 100;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Where the hand aims: halfway between the index and thumb tips, in the camera's 0..1 frame,
// mirrored so moving your hand right moves the cursor right. Steadier than the index tip alone,
// whichever finger the thumb goes to.
export const pointerOf = (lm: Landmark[]): [number, number] => [1 - (lm[4].x + lm[8].x) / 2, (lm[4].y + lm[8].y) / 2];

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
  setThresholds(t: PinchThresholds): void {
    this.o.on = this.hyst.onBelow = t.on;
    this.o.off = this.hyst.offAbove = t.off;
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
