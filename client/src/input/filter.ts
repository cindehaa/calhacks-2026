// One Euro filter (Casiez et al. 2012): heavy smoothing when the hand is still, little lag when
// it moves fast. The cutoff rises with speed, so jitter goes away without the cursor trailing.

const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t: number | null = null;

  constructor(public minCutoff = 1.0, public beta = 0.007, public dCutoff = 1.0) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  // v in any unit, t in seconds.
  filter(v: number, t: number): number {
    if (this.x === null || this.t === null) {
      this.x = v;
      this.t = t;
      return v;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const a = alpha(this.dCutoff, dt);
    this.dx = a * ((v - this.x) / dt) + (1 - a) * this.dx;
    const b = alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    this.x = b * v + (1 - b) * this.x;
    return this.x;
  }
}
