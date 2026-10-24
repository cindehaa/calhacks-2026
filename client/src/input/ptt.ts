// Push-to-talk pieces that don't need a browser: when audio is gated it only reaches the
// recogniser while something is held, plus a short pre-roll so the first syllable isn't clipped.

// The last few audio chunks heard while nothing was held.
export class PreRoll<T> {
  private chunks: T[] = [];
  constructor(readonly keep: number) {}
  push(c: T): void {
    this.chunks.push(c);
    if (this.chunks.length > this.keep) this.chunks.shift();
  }
  // Hands over what it holds and empties itself.
  take(): T[] {
    return this.chunks.splice(0);
  }
  clear(): void {
    this.chunks = [];
  }
  get size(): number {
    return this.chunks.length;
  }
}
