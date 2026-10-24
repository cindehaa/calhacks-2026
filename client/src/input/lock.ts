// The lock → deploy / cancel state machine shared by pinch and voice. Pure: time comes in as
// arguments and positions are screen px, so it runs the same in tests as in the browser.
//
// Pinch start, Space down or speech start locks the spot. Releasing the pinch or Space (or going
// quiet) deploys it, unless the cursor has been pulled outside the drag-off ring, which cancels
// like dragging a card back. Losing the hand cancels a lock that was made with the hand.
//
// A flick is a tap, not a hold: it locks, then going quiet after the description (or a second
// flick) deploys. Flicking while talking deploys the voice lock at once.

export interface Pt { x: number; y: number }
export type LockBy = 'pinch' | 'key' | 'voice' | 'flick';
export interface Lock { x: number; y: number; t: number; by: LockBy; hand: boolean }

export interface LockOptions {
  dragRadius: number; // px
  handLostMs: number;
  lagMs: number; // judge a pinch from the cursor this long ago, before the pinch itself moved it
  flickWaitMs: number; // a flick lock nobody describes gives up after this
}
export const LOCK_DEFAULTS: LockOptions = { dragRadius: 150, handLostMs: 250, lagMs: 100, flickWaitMs: 5000 };

export interface LockEvents {
  onLock(l: Lock): boolean; // false refuses the spot (off your half, no match running)
  onDeploy(l: Lock): void;
  onCancel(l: Lock, reason: string): void;
}

export interface HandInput {
  cursor: Pt | null; // hand cursor if a hand is visible, else the mouse, else null
  hand: boolean;
  pinched: boolean;
  onset?: number; // when the pinch began closing; aims from then instead of lagMs ago
}

// Short timestamped cursor trail, so a lock can use where the pointer was a moment ago.
export class CursorHistory {
  private pts: { t: number; p: Pt }[] = [];
  constructor(private keepMs = 1500) {}
  push(t: number, p: Pt): void {
    this.pts.push({ t, p });
    while (this.pts.length && this.pts[0].t < t - this.keepMs) this.pts.shift();
  }
  // Latest sample at or before t; the oldest one if t predates them all.
  at(t: number): Pt | null {
    for (let i = this.pts.length - 1; i >= 0; i--) if (this.pts[i].t <= t) return this.pts[i].p;
    return this.pts[0]?.p ?? null;
  }
  clear(): void {
    this.pts = [];
  }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export class LockMachine {
  lock: Lock | null = null;
  cursor: Pt | null = null;
  private history = new CursorHistory();
  private pinched = false;
  private hadHand = false;
  private lastHandT = -Infinity;
  private speaking = false;

  constructor(private ev: LockEvents, readonly o: LockOptions = LOCK_DEFAULTS) {}

  // Call every frame.
  frame(t: number, f: HandInput): void {
    const gap = t - this.lastHandT;
    if (this.lock?.hand && gap > this.o.handLostMs) this.cancel('hand lost');
    if (this.lock?.by === 'flick' && !this.speaking && t - this.lock.t > this.o.flickWaitMs) this.cancel('no words');

    // Pointer source changed (hand appeared or vanished): old samples are from the other one.
    if (f.hand !== this.hadHand) this.history.clear();
    this.hadHand = f.hand;
    this.cursor = f.cursor;
    if (f.cursor) this.history.push(t, f.cursor);

    let started = false, ended = false;
    if (f.hand) {
      // A hand that enters the frame already pinched doesn't click.
      if (gap > this.o.handLostMs) this.pinched = f.pinched;
      started = f.pinched && !this.pinched;
      ended = !f.pinched && this.pinched;
      this.pinched = f.pinched;
      this.lastHandT = t;
    }
    // While the hand is briefly gone, keep the old pinch state so a release seen on its return counts.

    const l = this.lock;
    if (!l) {
      const aim = f.onset !== undefined ? this.history.at(f.onset) : this.lagged(t);
      if (started) this.tryLock(t, aim ?? f.cursor, 'pinch', true);
      return;
    }
    // Pinching during a voice lock hands control to the pinch: deploy on release, not on quiet.
    if (started && l.by === 'voice') l.by = 'pinch';
    if (ended && l.by === 'pinch') this.resolve(this.lagged(t), 'drag');
  }

  // Speech began at t (when the sound started, not when it was confirmed).
  speechStart(t: number): void {
    this.speaking = true;
    if (this.lock) return;
    this.tryLock(t, this.history.at(t) ?? this.cursor, 'voice', this.hadHand);
  }

  // Space works like a pinch: down locks at the cursor, up deploys. It takes over a voice lock the
  // same way a pinch does.
  keyDown(t: number): void {
    if (this.lock) {
      if (this.lock.by === 'voice') this.lock.by = 'key';
      return;
    }
    this.tryLock(t, this.cursor, 'key', this.hadHand);
  }

  keyUp(): void {
    if (this.lock?.by === 'key') this.resolve(this.cursor, 'drag');
  }

  speechEnd(): void {
    this.speaking = false;
    if (this.lock?.by === 'voice') this.resolve(this.cursor, 'drag');
    else if (this.lock?.by === 'flick') this.release();
  }

  // A flick that began at onset: aims from then, before the flick moved the pointer. It locks, or
  // deploys a voice or flick lock already running.
  flick(t: number, onset: number): void {
    const l = this.lock;
    if (!l) return this.tryLock(t, this.history.at(onset) ?? this.cursor, 'flick', false);
    if (l.by === 'voice' || l.by === 'flick') this.release();
  }

  // Deploy whatever is locked now, wherever the cursor is.
  release(): void {
    this.resolve(null, '');
  }

  cancel(reason: string): void {
    const l = this.lock;
    if (!l) return;
    this.lock = null;
    this.ev.onCancel(l, reason);
  }

  // How far the cursor that would judge a release is from the lock, for drawing the ring.
  dragDistance(t: number): number {
    const l = this.lock;
    if (l?.by === 'flick') return 0;
    const c = l?.by === 'pinch' ? this.lagged(t) : this.cursor;
    return l && c ? dist(l, c) : 0;
  }

  private lagged(t: number): Pt | null {
    return this.history.at(t - this.o.lagMs) ?? this.cursor;
  }

  private tryLock(t: number, c: Pt | null, by: LockBy, hand: boolean): void {
    if (!c) return;
    const l: Lock = { x: c.x, y: c.y, t, by, hand };
    if (this.ev.onLock(l)) this.lock = l;
  }

  private resolve(c: Pt | null, reason: string): void {
    const l = this.lock;
    if (!l) return;
    if (c && dist(l, c) > this.o.dragRadius) return this.cancel(reason);
    this.lock = null;
    this.ev.onDeploy(l);
  }
}
