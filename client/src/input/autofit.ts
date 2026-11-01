// Fitting the pinch to a player's hand while they play, instead of a setup step. It watches the
// pinch measure for dips: the thumb coming toward a finger and going back. Real pinches and pinches
// that never quite closed both count, so a hand the default thresholds don't register still gets
// fitted. The open level is where the measure sits between dips (the hand pointing as it aims);
// the pinched level is the median of the dips' lowest points. Those two go through the same fit
// as the manual one (pose.ts fitPinch). Pure: feed it the measure every frame.
import { fitPinch, median, type PinchThresholds } from './pose';

export const AUTOFIT = {
  windowMs: 10_000, // the open level is read from this much recent history
  dip: 0.18, // a dip starts this far below the open level
  minDipMs: 120, // shorter is noise
  maxDipMs: 8000, // longer is a hand resting half closed (a pinch held while talking fits in this)
  dips: 4, // this many before a fit
  keep: 8, // the pinched level is the median of the last this many dips
  minChange: 0.05, // propose a fit only if it moves a threshold at least this far
  cooldownMs: 20_000, // and not again for this long
};

export class AutoFit {
  private samples: { t: number; r: number }[] = [];
  private mins: number[] = []; // lowest point of each finished dip, newest last
  private dipFrom: number | null = null;
  private dipMin = Infinity;
  private fittedAt = -Infinity;
  constructor(readonly o = AUTOFIT) {}

  // The open hand's level: the upper part of recent history, so dips don't pull it down.
  private openLevel(): number | null {
    if (this.samples.length < 15) return null;
    const s = this.samples.map(x => x.r).sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.75)];
  }

  // ratio: the pinch measure, null with no hand. Returns new thresholds when a fit is due.
  push(t: number, ratio: number | null, current: PinchThresholds): PinchThresholds | null {
    const o = this.o;
    if (ratio === null) {
      this.dipFrom = null; // the hand left mid-dip: it doesn't count
      return null;
    }
    this.samples.push({ t, r: ratio });
    while (this.samples.length && t - this.samples[0].t > o.windowMs) this.samples.shift();
    const open = this.openLevel();
    if (open === null) return null;
    if (this.dipFrom === null) {
      if (ratio < open - o.dip) {
        this.dipFrom = t;
        this.dipMin = ratio;
      }
      return null;
    }
    this.dipMin = Math.min(this.dipMin, ratio);
    if (ratio < open - o.dip / 2) {
      if (t - this.dipFrom > o.maxDipMs) this.dipFrom = null; // resting half closed: wait for an open hand
      return null;
    }
    const len = t - this.dipFrom;
    this.dipFrom = null;
    if (len < o.minDipMs) return null;
    this.mins.push(this.dipMin);
    if (this.mins.length > o.keep) this.mins.shift();
    if (this.mins.length < o.dips || t - this.fittedAt < o.cooldownMs) return null;
    const fit = fitPinch(open, median(this.mins));
    if (!fit || (Math.abs(fit.on - current.on) < o.minChange && Math.abs(fit.off - current.off) < o.minChange)) return null;
    this.fittedAt = t;
    return fit;
  }

  reset(): void {
    this.samples = [];
    this.mins = [];
    this.dipFrom = null;
  }
}
