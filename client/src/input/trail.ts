// Short timestamped cursor trail, so a fire can aim from where the pointer was a moment ago,
// before the pinch itself moved it.

export interface Pt { x: number; y: number }

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
