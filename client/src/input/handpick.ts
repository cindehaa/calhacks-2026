// Which hand controls. The tracker looks for two hands because players often hold the handheld
// mic in one, and a hand wrapped round a mic can read as a pinch or a thumbs down. Each frame one
// hand is chosen; only it aims and gestures, the other is ignored.
//
// The rule:
//  - Sticky: once a hand controls, it is followed by handedness and position until it has been
//    out of view for LOSE_MS. Until then no other hand takes over.
//  - Choosing (no control hand, or it was lost): a hand is rejected if it's in a grip (all four
//    fingers wrapped, thumb not out) near the top or centre of the frame, where the mouth is, or
//    if it has held still in a grip for STILL_MS. Of the rest, the one pointing (index out, the
//    others curled) over the board wins, then any hand over the board.
//  - The control hand gives way only if it becomes a still grip while another hand is acceptable
//    (the mic hand was picked up first).
//  - A Left/Right preference only ever accepts that hand.
import { applyH, DEFAULT_H } from './homography';
import { thumbDownScore, type Landmark } from './pose';

export type Side = 'left' | 'right';
export type HandPref = 'auto' | Side;

export interface HandIn {
  lm: Landmark[]; // 0..1 of the unmirrored frame
  world: Landmark[];
  side: Side | null; // the player's own hand (see sideFromLabel)
}

// MediaPipe labels handedness as if the image were mirrored (a selfie). We pass it the raw,
// unmirrored camera frame, so its "Left" is the player's right hand, and the other way round.
export const sideFromLabel = (label: string | undefined): Side | null =>
  label === 'Left' ? 'right' : label === 'Right' ? 'left' : null;

export const LOSE_MS = 400;
export const STILL_MS = 1000;
const STILL_MOVE = 0.04; // a grip that moves less than this (frame widths) is holding still
const MATCH_SAME_SIDE = 0.3; // how far the control hand may jump between frames, same handedness
const MATCH_ANY = 0.15; // and if the handedness disagrees (MediaPipe sometimes swaps it)

export interface HandFeatures {
  center: [number, number]; // palm centre, 0..1 of the unmirrored frame
  fingers: number[]; // index, middle, ring, pinky: wrist → tip over wrist → knuckle (~1.9 straight, <1 curled)
  grip: boolean; // all four wrapped and the thumb not out: holding something
  pointing: number; // 0..1, index out and the rest curled
  overBoard: boolean; // the fingertip lands on the screen
  nearMouth: boolean; // top or centre of the frame
}

const FINGERS: [number, number][] = [[5, 8], [9, 12], [13, 16], [17, 20]];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function features(h: HandIn): HandFeatures {
  const { lm, world } = h;
  const palm = [0, 5, 9, 13, 17];
  const center: [number, number] = [palm.reduce((s, i) => s + lm[i].x, 0) / 5, palm.reduce((s, i) => s + lm[i].y, 0) / 5];
  const d = (i: number, j: number) => Math.hypot(world[i].x - world[j].x, world[i].y - world[j].y, world[i].z - world[j].z);
  const fingers = FINGERS.map(([k, t]) => d(0, t) / (d(0, k) || 1e-9));
  const curled = (r: number) => r < 1.3;
  const grip = fingers.every(curled) && thumbDownScore(lm, world, 1, 1) < 0.5;
  const othersCurl = Math.min(...fingers.slice(1).map(r => clamp01((1.45 - r) / 0.3)));
  const pointing = Math.min(clamp01((fingers[0] - 1.3) / 0.35), othersCurl);
  const [u, v] = applyH(DEFAULT_H, [1 - lm[8].x, lm[8].y]);
  const overBoard = u >= 0 && u <= 1 && v >= 0 && v <= 1;
  const nearMouth = center[1] < 0.25 || (center[1] < 0.6 && Math.abs(center[0] - 0.5) < 0.25);
  return { center, fingers, grip, pointing, overBoard, nearMouth };
}

interface Track { center: [number, number]; gripSince: number | null; anchor: [number, number] | null }

export interface Pick {
  control: number; // index into the hands passed in, -1 for none
  reasons: string[]; // per hand: why it was or wasn't chosen, for the debug view
  fresh: boolean; // control was just chosen (first hand, or another took over), not followed
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export class HandPicker {
  pref: HandPref = 'auto';
  private ctl: { center: [number, number]; side: Side | null; seen: number } | null = null;
  private tracks: Track[] = [];

  reset(): void {
    this.ctl = null;
    this.tracks = [];
  }

  update(hands: HandIn[], now: number): Pick {
    const fs = hands.map(features);
    const still = this.updateTracks(fs, now);
    const allowed = hands.map(h => this.pref === 'auto' || h.side === null || h.side === this.pref);
    const reasons = hands.map((_, i) => (allowed[i] ? '' : `not ${this.pref}`));
    const rejected = fs.map((f, i) => !allowed[i] || (f.grip && f.nearMouth) || still[i]);
    fs.forEach((f, i) => {
      if (!reasons[i] && f.grip && f.nearMouth) reasons[i] = 'grip near mouth';
      else if (!reasons[i] && still[i]) reasons[i] = 'still grip';
    });

    // Follow the control hand.
    let pick = -1;
    if (this.ctl && now - this.ctl.seen <= LOSE_MS) {
      pick = this.follow(hands, fs, allowed);
      if (pick >= 0 && still[pick] && fs.some((_, j) => j !== pick && !rejected[j])) pick = -1; // the mic hand, picked up first
      else if (pick < 0) return this.done(-1, reasons.map(r => r || 'waiting for control hand'));
    }
    // Or choose one.
    const fresh = pick < 0;
    if (pick < 0) {
      let best = -Infinity;
      fs.forEach((f, i) => {
        if (rejected[i]) return;
        const score = 2 * f.pointing + (f.overBoard ? 1 : 0) - (f.grip ? 0.5 : 0);
        if (score > best) { best = score; pick = i }
      });
    }
    if (pick < 0) { this.ctl = null; return this.done(-1, reasons) }
    this.ctl = { center: fs[pick].center, side: hands[pick].side, seen: now };
    reasons[pick] = 'control';
    return this.done(pick, reasons.map(r => r || 'other hand'), fresh);
  }

  private done(control: number, reasons: string[], fresh = false): Pick {
    return { control, reasons, fresh };
  }

  private follow(hands: HandIn[], fs: HandFeatures[], allowed: boolean[]): number {
    const c = this.ctl!;
    let best = -1, bestD = Infinity;
    fs.forEach((f, i) => {
      if (!allowed[i]) return;
      const sameSide = c.side !== null && hands[i].side === c.side;
      const d = dist(f.center, c.center);
      const lim = sameSide || c.side === null || hands[i].side === null ? MATCH_SAME_SIDE : MATCH_ANY;
      const key = d - (sameSide ? 1 : 0); // same handedness first, then nearest
      if (d <= lim && key < bestD) { bestD = key; best = i }
    });
    return best;
  }

  // Match this frame's hands to last frame's by position, and time how long each has gripped still.
  private updateTracks(fs: HandFeatures[], now: number): boolean[] {
    const prev = this.tracks, used = new Set<number>();
    this.tracks = fs.map(f => {
      let j = -1, bd = 0.2;
      prev.forEach((t, k) => {
        const d = dist(t.center, f.center);
        if (!used.has(k) && d < bd) { bd = d; j = k }
      });
      if (j >= 0) used.add(j);
      const t = j >= 0 ? prev[j] : null;
      if (!f.grip) return { center: f.center, gripSince: null, anchor: null };
      if (t?.gripSince != null && t.anchor && dist(t.anchor, f.center) < STILL_MOVE) return { center: f.center, gripSince: t.gripSince, anchor: t.anchor };
      return { center: f.center, gripSince: now, anchor: f.center };
    });
    return this.tracks.map(t => t.gripSince !== null && now - t.gripSince >= STILL_MS);
  }
}
