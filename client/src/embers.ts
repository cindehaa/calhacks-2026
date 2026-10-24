// Points, kept in this browser (stored as "embers"). Wins add points, losses take some away;
// the total sets your rank, from Bronze up to Diamond.
import type { BotLevel } from '../../shared/bot';

export const RANKS = [
  { name: 'Bronze', at: 0 },
  { name: 'Silver', at: 100 },
  { name: 'Gold', at: 300 },
  { name: 'Platinum', at: 600 },
  { name: 'Diamond', at: 1000 },
] as const;

export interface Rank { name: string; next: string | null; nextAt: number | null }

export function rankOf(total: number): Rank {
  let i = 0;
  while (i + 1 < RANKS.length && total >= RANKS[i + 1].at) i++;
  const next = RANKS[i + 1];
  return { name: RANKS[i].name, next: next?.name ?? null, nextAt: next?.at ?? null };
}

export type Outcome = 'win' | 'lose' | 'draw';

// Online rounds are worth the most; against the bot, harder bots pay more and cost less to lose to.
export function emberDelta(outcome: Outcome, vs: BotLevel | 'online'): number {
  if (outcome === 'draw') return 0;
  const table = { online: [30, -20], easy: [10, -15], normal: [20, -10], hard: [30, -5] } as const;
  return table[vs][outcome === 'win' ? 0 : 1];
}

export const applyDelta = (total: number, delta: number) => Math.max(0, total + delta);

const KEY = 'arena.embers';

export function loadEmbers(): number {
  try { return Math.max(0, Number(localStorage.getItem(KEY)) || 0) } catch { return 0 }
}

export function saveEmbers(n: number): void {
  try { localStorage.setItem(KEY, String(n)) } catch { /* private mode */ }
}
