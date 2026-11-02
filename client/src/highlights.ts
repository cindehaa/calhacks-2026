// What makes a moment of a round worth a clip. Watches the board once a frame (like mvp.ts) and
// marks moments with a score and a plain label; at the end of the round pick() turns the best of
// them into a few short, non-overlapping windows of the recording (clips.ts cuts them).
//
// Interesting, by score:
//   a tower destroyed      king 10, princess 7 (yours falling counts for less than theirs)
//   the round's last blow  6 (when it ends while the board is still busy, not on a forfeit)
//   troops defeated at once  3 or more of one side within 2 s: 3 + one per troop
//   a spell landing on troops  2 or more caught in it: 2 + one per troop
//   a big summon           your troops costing 6 or more: cost / 2
import { KING_LANE } from '../../shared/arena';
import type { MatchTower, MatchUnit } from './match';
import type { DrawSpell, DrawTroop } from './render';

export interface Moment { at: number; score: number; label: string }
export interface Window { from: number; to: number; score: number; label: string } // ms on the same clock as `at`

export const BEFORE_MS = 2200; // a clip starts this long before its moment
export const AFTER_MS = 1300; // and runs this long after it
const MAX_MS = 6000; // moments merge into one clip up to this long
const WIPE_MS = 2000; // deaths this close together count as one moment
const WIPE_MIN = 3;
const SPELL_MIN = 2;
const BIG_SUMMON = 6;

export interface Board {
  side: number; // yours
  units: MatchUnit[];
  towers: MatchTower[];
  spells: DrawSpell[];
  troops: Map<bigint, DrawTroop>;
}

export class HighlightTracker {
  readonly moments: Moment[] = [];
  private towerHp = new Map<string, number>();
  private alive = new Map<bigint, { side: number }>();
  private deaths: { at: number; side: number }[] = [];
  private landed = new Set<bigint>();
  private summoned = new Set<bigint>();

  reset(): void {
    this.moments.length = 0;
    this.towerHp.clear();
    this.alive.clear();
    this.deaths.length = 0;
    this.landed.clear();
    this.summoned.clear();
  }

  // Once a frame while the round is being played. `now` is performance.now().
  observe(b: Board, now: number): void {
    for (const t of b.towers) {
      const key = `${t.side}:${t.lane}`;
      const before = this.towerHp.get(key);
      this.towerHp.set(key, t.hp);
      if (before === undefined || before <= 0 || t.hp > 0) continue;
      const king = t.lane === KING_LANE;
      const theirs = t.side !== b.side;
      this.add(now, (king ? 10 : 7) * (theirs ? 1 : 0.7), `${theirs ? 'Enemy' : 'Your'} ${king ? 'king tower' : 'tower'} destroyed`);
    }

    const seen = new Set<bigint>();
    for (const u of b.units) {
      seen.add(u.id);
      if (u.hp > 0 && u.delay <= 0) this.alive.set(u.id, { side: u.side });
      else if (u.hp <= 0 && this.alive.delete(u.id)) this.deaths.push({ at: now, side: u.side });
      if (u.side === b.side && u.delay <= 0 && !this.summoned.has(u.troopId)) {
        this.summoned.add(u.troopId);
        const t = b.troops.get(u.troopId);
        if (t && t.cost >= BIG_SUMMON) this.add(now, t.cost / 2, `${t.name} summoned`);
      }
    }
    for (const [id, u] of this.alive) if (!seen.has(id)) { this.alive.delete(id); this.deaths.push({ at: now, side: u.side }) }
    this.countWipes(now, false);

    for (const s of b.spells) {
      if (s.delay > 0 || this.landed.has(s.id)) continue;
      this.landed.add(s.id);
      const hit = b.units.filter(u => u.side !== s.side && u.hp > 0 && Math.hypot(u.x - s.x, u.y - s.y) <= s.radius).length;
      if (hit >= SPELL_MIN) this.add(now, 2 + hit, `Spell hits ${hit} troops`);
    }
  }

  // The round just ended: its last moment, unless it was a forfeit.
  end(now: number, forfeit: boolean): void {
    this.countWipes(now, true);
    if (!forfeit) this.add(now, 6, 'Final moment');
  }

  // Runs of deaths of one side, closed once WIPE_MS passes with no more (or at the end).
  private countWipes(now: number, flush: boolean): void {
    for (const side of [0, 1]) {
      const run = this.deaths.filter(d => d.side === side);
      if (!run.length) continue;
      const last = run[run.length - 1].at;
      if (!flush && now - last < WIPE_MS) continue;
      this.deaths = this.deaths.filter(d => d.side !== side);
      // split the run wherever there's a WIPE_MS gap
      let group: number[] = [];
      const close = () => {
        if (group.length >= WIPE_MIN) this.add(group[group.length - 1], 3 + group.length, `${group.length} troops defeated`);
        group = [];
      };
      for (const d of run) {
        if (group.length && d.at - group[group.length - 1] >= WIPE_MS) close();
        group.push(d.at);
      }
      close();
    }
  }

  private add(at: number, score: number, label: string): void {
    this.moments.push({ at, score, label });
  }
}

// The best `n` windows inside [start, end]: moments whose windows overlap merge into one (scores
// add up, the best label stays), then the top scores, in the order they happened.
export function pick(moments: readonly Moment[], start: number, end: number, n = 4): Window[] {
  const sorted = [...moments].sort((a, b) => a.at - b.at);
  const merged: (Window & { best: number })[] = [];
  for (const m of sorted) {
    const from = Math.max(start, m.at - BEFORE_MS), to = Math.min(end, m.at + AFTER_MS);
    if (to - from < 500) continue;
    const prev = merged[merged.length - 1];
    if (prev && from < prev.to && to - prev.from <= MAX_MS) {
      prev.to = Math.max(prev.to, to);
      prev.score += m.score;
      if (m.score > prev.best) { prev.best = m.score; prev.label = m.label }
    } else merged.push({ from: Math.max(from, prev?.to ?? from), to, score: m.score, label: m.label, best: m.score });
  }
  return merged
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => a.from - b.from)
    .map(({ from, to, score, label }) => ({ from, to, score, label }));
}
