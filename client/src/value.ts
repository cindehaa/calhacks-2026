// Is a troop a bargain? The cost is the troop's power rounded to whole elixir (shared/troop.ts
// price()), so the honest measure is what that rounding did: the exact, unrounded price against
// the cost charged. Rounded down by a quarter elixir or more is a bargain, up by as much is pricey
// (the floor of 1 makes the weakest troops pricey too). Display only; nothing here changes prices.
import { K, clampStats, power, quirkMultiplier, type TroopQuirks, type TroopStats } from '../../shared/troop';

export type Deal = 'bargain' | 'fair' | 'pricey';

export const DEAL_MARGIN = 0.25; // elixir between the exact price and the cost before it shows

// The price before rounding, from the same stats and quirks price() reads.
export function exactCost(s: TroopStats & Partial<TroopQuirks>): number {
  return (power(clampStats(s)) * quirkMultiplier(s)) / K;
}

export function deal(cost: number, exact: number | undefined): Deal {
  if (exact === undefined || !Number.isFinite(exact)) return 'fair';
  if (exact - cost >= DEAL_MARGIN) return 'bargain';
  if (cost - exact >= DEAL_MARGIN) return 'pricey';
  return 'fair';
}
