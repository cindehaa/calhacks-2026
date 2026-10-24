// Pure scoring helpers for the balance sim. No simulation here, so they are easy to test.

// How many copies each side deploys so both spend about the same elixir. Picks the pair with
// the smallest relative spend gap within the budget, preferring fewer copies; a side whose
// copies would exceed maxUnits bodies is held to fewer copies.
export function matchCounts(
  costA: number, costB: number, budget = 20, countA = 1, countB = 1, maxUnits = 60
): [number, number] {
  const cap = (cost: number, count: number) =>
    Math.max(1, Math.min(Math.floor(budget / cost), Math.floor(maxUnits / count)));
  let best: [number, number] = [1, 1];
  let bestGap = Infinity;
  for (let a = 1; a <= cap(costA, countA); a++) {
    for (let b = 1; b <= cap(costB, countB); b++) {
      const sa = a * costA, sb = b * costB;
      const gap = Math.abs(sa - sb) / Math.max(sa, sb);
      if (gap < bestGap - 1e-9) { bestGap = gap; best = [a, b] }
    }
  }
  return best;
}

// One side of a finished fight: what it spent and how much of its HP is left.
export interface SideResult {
  spent: number; // elixir
  maxHp: number; // total over all its units
  hpLeft: number;
}

// Elixir value is taken as proportional to HP left: a troop at 30% HP has lost 70% of its cost.
export const hpFrac = (r: SideResult) => (r.maxHp > 0 ? Math.max(0, r.hpLeft) / r.maxHp : 0);

export interface Trade {
  destroyed: number; // enemy elixir destroyed
  lost: number; // own elixir lost
  spent: number;
}

export function trade(own: SideResult, enemy: SideResult): Trade {
  return {
    destroyed: enemy.spent * (1 - hpFrac(enemy)),
    lost: own.spent * (1 - hpFrac(own)),
    spent: own.spent,
  };
}

// Elixir destroyed per elixir lost over many fights; 1 is an even trade. Losses are floored
// at 5% of spend so a troop that never gets touched still gets a finite number.
export function tradeRatio(trades: Trade[]): number {
  const d = trades.reduce((a, t) => a + t.destroyed, 0);
  const l = trades.reduce((a, t) => a + t.lost, 0);
  const s = trades.reduce((a, t) => a + t.spent, 0);
  return s > 0 ? d / Math.max(l, 0.05 * s) : 0;
}

// Net elixir traded per elixir spent: (destroyed − lost) / spent, between −1 and about +1.
export function valuePerElixir(trades: Trade[]): number {
  const s = trades.reduce((a, t) => a + t.spent, 0);
  return s > 0 ? trades.reduce((a, t) => a + t.destroyed - t.lost, 0) / s : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// In a fight to the end both sides trade HP for DPS, so the trade ratio grows with the square
// of strength per elixir (power = sqrt(HP × DPS)). A troop trading x times the median is
// therefore about sqrt(x) times underpriced. Groups fighting at once amplify this (Lanchester's
// square law), so treat it as the largest correction worth making.
export function fairCost(cost: number, ratio: number, medianRatio: number): number {
  return medianRatio > 0 && ratio > 0 ? cost * Math.sqrt(ratio / medianRatio) : NaN;
}

export type Flag = 'strong' | 'weak' | null;

export const FLAG_HIGH = 1.5;
export const FLAG_LOW = 0.67;

export function flag(value: number, med: number, hi = FLAG_HIGH, lo = FLAG_LOW): Flag {
  if (!(med > 0)) return null;
  if (value > hi * med) return 'strong';
  if (value < lo * med) return 'weak';
  return null;
}
