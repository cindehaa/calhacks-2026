// Board and match constants. Units are tiles and seconds.
// Side 0 (the room host) owns the low-y half, side 1 the high-y half.
// Clients rotate the board so their own side is at the bottom.

export const ARENA_W = 18;
export const ARENA_H = 30;
export const MID_Y = ARENA_H / 2;
export const LANE_X = [3, 9, 15];

export const MATCH_SECONDS = 90;
export const COUNTDOWN = 3; // "3-2-1, Fight!": matches start at time −3, with no deploys or elixir until 0
export const DOUBLE_ELIXIR_AT = 60; // last 30 s
export const ELIXIR_MAX = 10;
export const ELIXIR_START = 5;
export const ELIXIR_PER_SEC = 0.5;

export const DEPLOY_DELAY = 2.5; // release → arrival; hides troop generation
export const MIN_DEPLOY_DELAY = 0.3; // if generation ran long, still telegraph the drop
export const TICK_HZ = 20;

export const UNIT_RADIUS = 0.4;
export const TOWER_RADIUS = 1.0;
export const AGGRO_RANGE = 5.5; // units chase enemy units this close, else walk at towers

export const TOWER = { health: 2400, damage: 60, attack_speed: 1.0, range: 6 }; // first pass, tune in playtests
export const TOWER_Y = [3, ARENA_H - 3]; // per side

export type Side = 0 | 1;

export function onOwnHalf(side: Side, y: number): boolean {
  return side === 0 ? y > 0 && y < MID_Y : y > MID_Y && y < ARENA_H;
}

export function clampToHalf(side: Side, x: number, y: number): [number, number] {
  const m = 0.5;
  const cx = Math.min(ARENA_W - m, Math.max(m, x));
  const cy = side === 0 ? Math.min(MID_Y - m, Math.max(m, y)) : Math.min(ARENA_H - m, Math.max(MID_Y + m, y));
  return [cx, cy];
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
