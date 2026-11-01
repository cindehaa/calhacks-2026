// Is the hand where the camera can use it? One piece of advice at a time, for the setup screen,
// the first summon (onboard.ts) and the in-match "show your hand" notice: too dark, no hand, too
// far, too close, or off one edge of the touchpad area (the middle of the frame, homography.ts).
// Pure: the controller measures, this decides, and Framing holds advice steady so it doesn't flicker.

export type Advice = 'ok' | 'none' | 'light' | 'closer' | 'back' | 'left' | 'right' | 'up' | 'down';

export const FRAMING = {
  dark: 45, // mean luma (0..255) under this: too dark to track well
  small: 0.1, // hand size (pose.ts handSize) over frame height under this: too far
  big: 0.45, // and over this: so close it leaves the frame when it moves
  edge: 0.06, // the aim this far past a screen edge (0..1 screen units): move the hand back in
  holdMs: 400, // new advice must hold this long before it replaces the current one
};

export interface FramingInput {
  visible: boolean;
  size?: number; // handSize / frame height
  aim?: [number, number]; // where the aim lands on screen, 0..1, unclamped (past an edge is < 0 or > 1)
  luma?: number | null; // mean brightness of the frame, null if not measured yet
}

export function assessFraming(f: FramingInput, o = FRAMING): Advice {
  if (f.luma != null && f.luma < o.dark) return 'light';
  if (!f.visible) return 'none';
  if (f.size !== undefined && f.size < o.small) return 'closer';
  if (f.size !== undefined && f.size > o.big) return 'back';
  if (f.aim) {
    // The camera is mirrored, so the screen's left is the player's left: off the left edge, move right.
    const [u, v] = f.aim;
    if (u < -o.edge) return 'right';
    if (u > 1 + o.edge) return 'left';
    if (v < -o.edge) return 'down';
    if (v > 1 + o.edge) return 'up';
  }
  return 'ok';
}

export const ADVICE_TEXT: Record<Advice, string> = {
  ok: 'Your hand is in frame',
  none: 'Raise your hand in front of the camera',
  light: 'Too dark for the camera: turn on a light or face a window',
  closer: 'Bring your hand closer to the camera',
  back: 'Move your hand back from the camera a little',
  left: 'Move your hand a little to the left',
  right: 'Move your hand a little to the right',
  up: 'Raise your hand a little',
  down: 'Lower your hand a little',
};

// The advice shown, changed only once a new one has held for holdMs. The first one shows at once.
export class Framing {
  advice: Advice | null = null;
  since = 0; // when the shown advice took over
  private next: Advice | null = null;
  private nextAt = 0;

  constructor(readonly holdMs = FRAMING.holdMs) {}

  push(t: number, a: Advice): Advice {
    if (this.advice === null || a === this.advice) {
      if (this.advice === null) this.since = t;
      this.advice = a;
      this.next = null;
      return a;
    }
    if (a !== this.next) {
      this.next = a;
      this.nextAt = t;
    } else if (t - this.nextAt >= this.holdMs) {
      this.advice = a;
      this.since = t;
      this.next = null;
    }
    return this.advice;
  }

  reset(): void {
    this.advice = this.next = null;
  }
}
