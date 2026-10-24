// Push-to-talk pieces that don't need a browser. With the camera on, the pinch is the talk
// button: audio only reaches the recogniser while you hold it, plus a short pre-roll so the first
// syllable said a beat before the fingers closed isn't clipped.

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

// Whether starting to talk locks a spot on its own (voice click). With the camera on the pinch
// does that, and an open mic would lock on anything said near the laptop, so it's off unless
// asked for. Without a camera there's no pinch, so talking is the hands-free way in.
export function voiceLocks(camera: boolean, voiceClickWithCamera: boolean): boolean {
  return !camera || voiceClickWithCamera;
}

// Audio is held back (pre-roll only) unless voice click needs to hear everything.
export function gated(micOn: boolean, voiceLocksOn: boolean): boolean {
  return micOn && !voiceLocksOn;
}

// A press shorter than this that heard nothing and had nothing typed was a click, not a talk:
// cancel it quietly and let the click pick the spot for typing, as before.
export const CLICK_MS = 300;

export function wasClick(heldMs: number, heard: string, typed: string): boolean {
  return heldMs < CLICK_MS && !heard.trim() && !typed.trim();
}
