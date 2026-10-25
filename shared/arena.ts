// Board and match constants. Units are tiles and seconds.
// Side 0 (the room host) owns the low-y half, side 1 the high-y half.
// Clients rotate the board so their own side is at the bottom.

// Laid out like Clash Royale: a river across the middle with two bridges, a king tower at the
// back of each side and a princess tower in front of each bridge.
export const ARENA_W = 18;
export const ARENA_H = 30;
export const MID_Y = ARENA_H / 2;
export const RIVER_HALF = 1; // the river runs from MID_Y − 1 to MID_Y + 1
export const BRIDGE_X = [3.5, 14.5];
export const BRIDGE_HALF = 1.25; // bridges are 2.5 tiles wide

export const MATCH_SECONDS = 60;
export const COUNTDOWN = 3; // "3-2-1, Fight!" runs from time −3, with no deploys or elixir until 0
export const INTRO = 2.5; // the "you vs them" card before the countdown
export const MATCH_START = -(INTRO + COUNTDOWN); // the clock a new match starts at
export const DOUBLE_ELIXIR_AT = 30; // last 30 s
// Level on towers at MATCH_SECONDS: overtime, sudden death at triple elixir, and the first tower
// down wins. Still level when it runs out: the tiebreaker. Everything stops, every standing tower
// loses health at DRAIN_PER_SEC, and the side whose tower falls first loses. Towers that fall
// together draw.
export const OVERTIME_SECONDS = 30;
export const TIEBREAK_AT = MATCH_SECONDS + OVERTIME_SECONDS;
export const DRAIN_PER_SEC = 1200; // a full king tower drains in 3 s
// Elixir: where each side starts, the cap, and the base refill per second (doubled from
// DOUBLE_ELIXIR_AT, tripled in overtime). MAX_COST in troop.ts matches the cap (15), so
// a full bar buys the most expensive troop.
// A parameter of the match, so Practice can try other numbers (the dev settings in client/src/dev.ts).
export interface ElixirRules { max: number; start: number; perSec: number }
export const ELIXIR: ElixirRules = { max: 15, start: 5, perSec: 1.5 };
export const ELIXIR_MAX = ELIXIR.max;
export const ELIXIR_START = ELIXIR.start;
export const elixirRate = (time: number, perSec = ELIXIR.perSec) => perSec * (time >= MATCH_SECONDS ? 3 : time >= DOUBLE_ELIXIR_AT ? 2 : 1);

export const DEPLOY_DELAY = 2.5; // release → arrival; hides troop generation
export const MIN_DEPLOY_DELAY = 0.3; // if generation ran long, still telegraph the drop
export const TICK_HZ = 20;

export const UNIT_RADIUS = 0.4;
export const TOWER_RADIUS = 1.0; // princess towers
export const KING_RADIUS = 1.5;
export const AGGRO_RANGE = 5.5; // units chase enemy units this close, else walk at towers

export const TOWER = { health: 2400, damage: 60, attack_speed: 1.0, range: 6 }; // first pass, tune in playtests
export const KING_HEALTH = 1.5; // × TOWER.health

// Towers by lane: 0 and 2 are the princess towers (left and right bridge), 1 the king.
export const KING_LANE = 1;
export const TOWER_X = [BRIDGE_X[0], ARENA_W / 2, BRIDGE_X[1]];
const TOWER_BACK = [6, 2.5, 6]; // tiles from the owner's back line
export const towerY = (side: Side, lane: number) => (side === 0 ? TOWER_BACK[lane] : ARENA_H - TOWER_BACK[lane]);
export const towerRadius = (lane: number) => (lane === KING_LANE ? KING_RADIUS : TOWER_RADIUS);

export type Side = 0 | 1;

// Your half, including the near half of the river (drops there land on the bank).
export function onOwnHalf(side: Side, y: number): boolean {
  return side === 0 ? y > 0 && y < MID_Y : y > MID_Y && y < ARENA_H;
}

const M = 0.5; // keeps drops off the edges and out of the water

export function clampToHalf(side: Side, x: number, y: number): [number, number] {
  return clampTo(deployZones(side, [])[0], x, y);
}

export interface Rect { x0: number; x1: number; y0: number; y1: number }
export interface TowerState { side: number; lane: number; hp: number }

// Where `side` may drop troops: its own half up to the river bank, plus a pocket for each enemy
// princess tower it has destroyed, that side of the enemy half from the river back to the
// tower's row. The first rect is always its own half.
export function deployZones(side: Side, towers: readonly TowerState[]): Rect[] {
  const out: Rect[] = [side === 0 ? { x0: 0, x1: ARENA_W, y0: 0, y1: MID_Y - RIVER_HALF } : { x0: 0, x1: ARENA_W, y0: MID_Y + RIVER_HALF, y1: ARENA_H }];
  for (const t of towers) {
    if (t.side === side || t.lane === KING_LANE || t.hp > 0) continue;
    const x0 = t.lane === 0 ? 0 : ARENA_W / 2, x1 = x0 + ARENA_W / 2;
    const ty = towerY(t.side as Side, t.lane);
    out.push(side === 0 ? { x0, x1, y0: MID_Y + RIVER_HALF, y1: ty } : { x0, x1, y0: ty, y1: MID_Y - RIVER_HALF });
  }
  return out;
}

// The zone a drop at (x, y) belongs to. Aiming at the near half of the river counts, and lands
// on the bank.
export function zoneAt(side: Side, x: number, y: number, towers: readonly TowerState[]): Rect | null {
  if (x <= 0 || x >= ARENA_W) return null;
  return deployZones(side, towers).find(z => x >= z.x0 && x <= z.x1 && y > z.y0 - RIVER_HALF && y < z.y1 + RIVER_HALF && y > 0 && y < ARENA_H && (y < MID_Y) === (z.y1 <= MID_Y)) ?? null;
}

export const canDeploy = (side: Side, x: number, y: number, towers: readonly TowerState[]) => zoneAt(side, x, y, towers) !== null;

// Snap a drop into the zone it was aimed at (its own half if none).
export function clampDeploy(side: Side, x: number, y: number, towers: readonly TowerState[]): [number, number] {
  return clampTo(zoneAt(side, x, y, towers) ?? deployZones(side, towers)[0], x, y);
}

export function clampTo(z: Rect, x: number, y: number): [number, number] {
  return [Math.min(z.x1 - M, Math.max(z.x0 + M, x)), Math.min(z.y1 - M, Math.max(z.y0 + M, y))];
}

// Where each copy of a count > 1 troop lands, relative to the deploy point.
export function formation(count: number): [number, number][] {
  if (count <= 1) return [[0, 0]];
  const out: [number, number][] = [];
  const ring = Math.min(1.4, 0.35 + 0.1 * count);
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count;
    out.push([Math.cos(a) * ring, Math.sin(a) * ring]);
  }
  return out;
}

// Anywhere on the board: where a spell may be cast. A spot past your zone (canDeploy false)
// is a spell spot; a troop aimed there snaps back with clampDeploy.
export const onBoard = (x: number, y: number) => x > 0 && x < ARENA_W && y > 0 && y < ARENA_H;
