// Pinches that almost happen: the thumb comes most of the way to the finger and opens again
// without the pinch measure ever closing (pose.ts, PINCH_DEFAULTS.on). A few of those close
// together, with no real pinch between them, mean the player is trying to pinch and it isn't
// registering, so the game shows how (pinchhint.ts). Pure: feed it the pinch ratio every frame.
//
// An attempt has to start from an open hand and end on one, quickly, so a hand resting half
// closed (the thumb lying on a curled middle finger while pointing) never counts.
import { PINCH_DEFAULTS, type PinchThresholds } from './pose';

export const NEAR_MISS = {
  open: 0.75, // an attempt starts and ends with the ratio above this
  near: 0.62, // and in between gets below this, but never below PINCH_DEFAULTS.on
  maxMs: 1500, // from leaving open to open again
  count: 3, // this many attempts
  windowMs: 8000, // within this long
  cooldownMs: 60_000, // after a hint, none for this long
  maxShows: 3, // hints per page load
};

export type NearMissOpts = typeof NEAR_MISS & { on: number };

export class NearMiss {
  private start: number | null = null; // the attempt in progress: when the ratio left open
  private min = Infinity;
  private armed = false; // seen an open hand since the last reset, so the next dip can count
  private misses: number[] = [];
  private shownAt = -Infinity;
  shows = 0;
  readonly o: NearMissOpts;

  constructor(o: Partial<NearMissOpts> = {}) {
    this.o = { ...NEAR_MISS, on: PINCH_DEFAULTS.on, ...o };
  }

  // Follow a player's own pinch thresholds: "near" and "open" keep where they sat around the
  // defaults (0.62 and 0.75 for 0.45 and 0.65).
  fit(t: PinchThresholds): void {
    const span = t.off - t.on;
    this.o.on = t.on;
    this.o.near = t.on + 0.85 * span;
    this.o.open = t.off + 0.5 * span;
  }

  // ratio: the pinch measure, null with no hand. active: the hand is somewhere a pinch would do
  // something (over your half in a match). True on the frame the hint should show.
  push(t: number, ratio: number | null, active: boolean): boolean {
    const o = this.o;
    if (ratio === null || !active) {
      this.start = null;
      this.armed = false;
      return false;
    }
    if (ratio < o.on) {
      // A real pinch: whatever came before it wasn't a failure.
      this.misses = [];
      this.start = null;
      this.armed = false;
      return false;
    }
    if (ratio > o.open) {
      if (this.start !== null && this.min < o.near && t - this.start <= o.maxMs) this.misses.push(t);
      this.start = null;
      this.armed = true;
    } else if (this.armed) {
      if (this.start === null) {
        this.start = t;
        this.min = ratio;
      } else this.min = Math.min(this.min, ratio);
      if (t - this.start > o.maxMs) {
        this.start = null; // held half closed: not an attempt; wait for an open hand
        this.armed = false;
      }
    }
    this.misses = this.misses.filter(m => t - m <= o.windowMs);
    if (this.misses.length < o.count || t - this.shownAt < o.cooldownMs || this.shows >= o.maxShows) return false;
    this.misses = [];
    this.shownAt = t;
    this.shows++;
    return true;
  }

  // Near misses so far in the window, for the practice screen.
  get recent(): number {
    return this.misses.length;
  }

  reset(): void {
    this.start = null;
    this.armed = false;
    this.misses = [];
  }
}
