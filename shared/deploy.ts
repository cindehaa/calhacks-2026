// Deploy rules, shared by the server's deploy_troop and the browser's bot mode so the two
// can't drift. Pure: callers own the rows, the clock and how errors are thrown.
import { DEPLOY_DELAY, MIN_DEPLOY_DELAY, clampTo, deployZones, formation, zoneAt, type Side, type TowerState } from './arena';
import { MAX_COST, price, sanitizeDesign, type TroopDesign } from './troop';

export interface PricedDeploy {
  design: TroopDesign;
  cost: number;
  // 'too expensive: N' or 'not enough elixir: N'; the client parses N to say what it would have cost.
  error: string | null;
}

// Stats can come from anywhere (Claude, a client), so always re-clamp and re-price.
export function priceDeploy(raw: Partial<TroopDesign>, elixir: number): PricedDeploy {
  const design = sanitizeDesign(raw);
  const cost = price(design);
  const error = cost > MAX_COST ? `too expensive: ${cost}` : cost > elixir ? `not enough elixir: ${cost}` : null;
  return { design, cost, error };
}

// Troops land DEPLOY_DELAY after the lock; if generation ran long, still telegraph the drop.
export function arrivalDelay(waitedSeconds: number): number {
  return Math.max(MIN_DEPLOY_DELAY, DEPLOY_DELAY - waitedSeconds);
}

// Where each of `count` units lands around the deploy point, kept in the zone it was dropped in
// (the owner's half, or a pocket it has opened).
export function unitSpots(side: Side, x: number, y: number, count: number, towers: readonly TowerState[] = []): [number, number][] {
  const z = zoneAt(side, x, y, towers) ?? deployZones(side, towers)[0];
  return formation(count).map(([dx, dy]) => clampTo(z, x + dx, y + dy));
}
