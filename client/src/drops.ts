// Your own drops between letting go and the troop appearing: what the board shows at the spot
// (the words, "designing…", a pulsing silhouette) and when each step happened, for the timing
// readout. Pure: times come in as arguments (ms), so it runs the same in tests.
//
// A drop is keyed by its deploy nonce. While the pinch or button is still held the input layer
// draws the lock and the live transcript, so a drop only shows once it's released.

export type DropPhase = 'held' | 'hearing' | 'designing' | 'deployed' | 'refused' | 'cancelled';

export interface DropTimes {
  lock: number;
  release?: number; // let go (or Enter for typed text)
  heard?: number; // final transcript in hand
  stats?: number; // design back from the api
  deployed?: number; // the match took it; the troop is in the air
  art?: number; // sprite ready
}

export interface Drop {
  nonce: number;
  spot: [number, number]; // world coords
  phase: DropPhase;
  words: string;
  name: string;
  note: string; // refusal reason, or the designer's source tags
  t: DropTimes;
}

// What render.ts draws at the spot.
export interface DropView {
  x: number;
  y: number;
  phase: DropPhase;
  text: string; // pill above the ring
  sub: string; // small line under it
  age: number; // ms since the phase began, for fades
}

const KEEP = 6; // drops remembered for the timing readout
const REFUSED_MS = 1400; // how long a refusal stays on the board

export class Drops {
  list: Drop[] = [];

  begin(nonce: number, spot: [number, number], t: number): void {
    this.list.push({ nonce, spot, phase: 'held', words: '', name: '', note: '', t: { lock: t } });
    while (this.list.length > KEEP) this.list.shift();
  }

  // Let go: words so far, still waiting on the recogniser's last ones.
  release(nonce: number, words: string, t: number): void {
    const d = this.get(nonce);
    if (!d || d.phase !== 'held') return;
    d.phase = 'hearing';
    d.words = words;
    d.t.release = t;
  }

  // Final words; the designer starts (or was already running on the partial transcript).
  heard(nonce: number, words: string, t: number): void {
    const d = this.get(nonce);
    if (!d || (d.phase !== 'held' && d.phase !== 'hearing')) return;
    d.t.release ??= t;
    d.t.heard = t;
    d.words = words;
    d.phase = 'designing';
  }

  designed(nonce: number, name: string, note: string, t: number): void {
    const d = this.get(nonce);
    if (!d) return;
    d.name = name;
    d.note = note;
    d.t.stats = t;
  }

  deployed(nonce: number, t: number): void {
    const d = this.get(nonce);
    if (d && d.phase === 'designing') {
      d.phase = 'deployed';
      d.t.deployed = t;
    }
  }

  art(nonce: number, t: number): void {
    const d = this.get(nonce);
    if (d && d.t.art === undefined) d.t.art = t;
  }

  refused(nonce: number, why: string, t: number): void {
    const d = this.get(nonce);
    if (!d) return;
    d.phase = 'refused';
    d.note = why;
    d.t.deployed = t; // reused as "phase began" for the fade
  }

  cancelled(nonce: number): void {
    const d = this.get(nonce);
    if (d) d.phase = 'cancelled';
  }

  get(nonce: number): Drop | undefined {
    return this.list.find(d => d.nonce === nonce);
  }

  views(t: number): DropView[] {
    const out: DropView[] = [];
    for (const d of this.list) {
      const [x, y] = d.spot;
      if (d.phase === 'hearing') {
        out.push({ x, y, phase: d.phase, text: d.words ? `“${clip(d.words)}”` : 'listening…', sub: '', age: t - (d.t.release ?? t) });
      } else if (d.phase === 'designing') {
        out.push({ x, y, phase: d.phase, text: `“${clip(d.words)}”`, sub: d.name ? d.name : 'designing…', age: t - (d.t.heard ?? t) });
      } else if (d.phase === 'refused') {
        const age = t - (d.t.deployed ?? t);
        if (age < REFUSED_MS) out.push({ x, y, phase: d.phase, text: d.name || 'refused', sub: d.note, age });
      }
    }
    return out;
  }
}

// One line per drop for the debug readout, newest first. "release → stats" is the number that
// has to stay under the 2.5 s deploy delay.
export function timingLines(drops: Drop[]): string[] {
  const ms = (a?: number, b?: number) => (a === undefined || b === undefined ? '…' : `${Math.round(b - a)}`);
  return drops
    .filter(d => d.phase !== 'held' && d.phase !== 'cancelled')
    .slice()
    .reverse()
    .map(d => {
      const r = d.t.release;
      const typed = r === d.t.lock && d.t.heard === r; // Enter in the text box: nothing to hear
      const parts = [
        ...(typed ? ['typed'] : [`held ${ms(d.t.lock, r)}`, `→heard ${ms(r, d.t.heard)}`]),
        `→stats ${ms(r, d.t.stats)}`,
        `→art ${ms(r, d.t.art)}`,
      ];
      const name = clip(d.name || d.words || '?', 22);
      return `${name}: ${parts.join(' · ')}${d.note ? ` (${d.note})` : ''}`;
    });
}

// Release → stats in ms, or null while it's still running.
export function releaseToStats(d: Drop): number | null {
  return d.t.release !== undefined && d.t.stats !== undefined ? d.t.stats - d.t.release : null;
}

const clip = (s: string, n = 34) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
