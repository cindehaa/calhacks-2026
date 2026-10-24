// Pure parts of pointing at menus with the hand: which button the cursor is on (snapping to the
// nearest one within a small radius, so a shaky hand still lands), and the dwell timer that clicks
// a button the cursor rests on. No DOM here, so it can be tested.

export interface Box { left: number; top: number; right: number; bottom: number }

export const SNAP_PX = 44; // a button this close to the cursor counts as under it

// Distance from p to the nearest edge of a box, 0 inside it.
export function boxDistance(x: number, y: number, b: Box): number {
  const dx = Math.max(b.left - x, 0, x - b.right);
  const dy = Math.max(b.top - y, 0, y - b.bottom);
  return Math.hypot(dx, dy);
}

// The index of the box under (x, y), or else the nearest within `radius`; -1 for none. Ties go to
// the first, so callers can list the topmost first.
export function nearestBox(x: number, y: number, boxes: readonly Box[], radius = SNAP_PX): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const d = boxDistance(x, y, boxes[i]);
    if (d < bestD && d <= radius) {
      best = i;
      bestD = d;
      if (d === 0) break;
    }
  }
  return best;
}

// Rest the cursor on one target for `ms` and it fires once. After firing it waits for the cursor to
// leave (or the target to change) before it can fire again, so a button that stays under a still
// hand isn't clicked over and over.
export class Dwell<T> {
  private target: T | null = null;
  private since = 0;
  private spent = false;
  constructor(readonly ms: number) {}

  // Call every frame with what's under the cursor. Returns the target when the dwell completes.
  update(now: number, target: T | null): T | null {
    if (target !== this.target) {
      this.target = target;
      this.since = now;
      this.spent = false;
    }
    if (target === null || this.spent || now - this.since < this.ms) return null;
    this.spent = true;
    return target;
  }

  // 0..1, how full the ring is.
  progress(now: number): number {
    if (this.target === null || this.spent) return 0;
    return Math.min(1, Math.max(0, (now - this.since) / this.ms));
  }

  // Something else clicked the target (a flick, Space): don't also dwell-click it.
  spend(): void {
    this.spent = true;
  }

  reset(): void {
    this.target = null;
    this.spent = false;
  }
}
