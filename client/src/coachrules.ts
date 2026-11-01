// When to coach a new player during their first matches (coach.ts shows it). Each rule spots one
// way of being stuck: a hand up but never pinching, talking without pinching (those words are
// dropped), a hand that keeps leaving the camera, or a hand badly placed for a while. Pure: feed
// it what happens, ask tick() what to say.
import type { Advice } from './input/framing';

export type CoachRule = 'idle' | 'talkNoPinch' | 'handFlaky' | 'framing';

export const COACH = {
  idleMs: 12_000, // hand up, playing, no pinch for this long
  talkCount: 2, // this many dropped utterances
  talkWindowMs: 10_000, // within this long
  lostCount: 3, // the hand leaving this many times
  lostWindowMs: 20_000, // within this long
  framingMs: 3000, // bad advice held this long
  gapMs: 8000, // at least this long between any two hints
  maxPerRule: 2,
};

export class CoachRules {
  private playingFrom: number | null = null;
  private lastPinch = -Infinity;
  private visible = false;
  private ignored: number[] = [];
  private losses: number[] = [];
  private advice: Advice = 'ok';
  private adviceFrom = 0;
  private lastHint = -Infinity;
  private shown: Partial<Record<CoachRule, number>> = {};
  constructor(readonly o = COACH) {}

  hand(t: number, visible: boolean): void {
    if (this.visible && !visible) this.losses.push(t);
    this.visible = visible;
  }
  pinch(t: number): void {
    this.lastPinch = t;
  }
  ignoredWords(t: number): void {
    this.ignored.push(t);
  }
  framing(t: number, a: Advice): void {
    if (a !== this.advice) this.adviceFrom = t;
    this.advice = a;
  }

  // playing: a match is on and past its countdown. The rule to show now, if any; the advice it
  // goes with is `currentAdvice`.
  tick(t: number, playing: boolean): CoachRule | null {
    const o = this.o;
    if (!playing) {
      this.playingFrom = null;
      return null;
    }
    this.playingFrom ??= t;
    this.ignored = this.ignored.filter(x => t - x <= o.talkWindowMs);
    this.losses = this.losses.filter(x => t - x <= o.lostWindowMs);
    if (t - this.lastHint < o.gapMs) return null;
    const due: [CoachRule, boolean][] = [
      ['talkNoPinch', this.ignored.length >= o.talkCount],
      ['handFlaky', this.losses.length >= o.lostCount],
      ['framing', this.visible && this.advice !== 'ok' && this.advice !== 'none' && t - this.adviceFrom >= o.framingMs],
      ['idle', this.visible && t - Math.max(this.lastPinch, this.playingFrom) >= o.idleMs],
    ];
    for (const [rule, yes] of due) {
      if (!yes || (this.shown[rule] ?? 0) >= o.maxPerRule) continue;
      this.shown[rule] = (this.shown[rule] ?? 0) + 1;
      this.lastHint = t;
      if (rule === 'talkNoPinch') this.ignored = [];
      if (rule === 'handFlaky') this.losses = [];
      if (rule === 'idle') this.lastPinch = t; // another full wait before it can repeat
      return rule;
    }
    return null;
  }

  get currentAdvice(): Advice {
    return this.advice;
  }
}
