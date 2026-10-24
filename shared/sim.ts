// The combat simulation. Pure and deterministic: no clock, no randomness, no I/O.
// One step() runs in three places: the SpacetimeDB tick (authoritative), bot mode in the
// browser, and the headless balance sim.
import {
  AGGRO_RANGE,
  ARENA_H,
  ARENA_W,
  DOUBLE_ELIXIR_AT,
  ELIXIR_MAX,
  ELIXIR_PER_SEC,
  ELIXIR_START,
  LANE_X,
  MATCH_SECONDS,
  TOWER,
  TOWER_RADIUS,
  TOWER_Y,
  UNIT_RADIUS,
  type Side,
} from './arena';

export interface SimUnit {
  id: number;
  side: Side;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  attackSpeed: number;
  moveSpeed: number;
  range: number;
  cooldown: number; // seconds until it can hit again
  delay: number; // seconds until it arrives; inert while > 0
  attackSeq: number; // bumps on every hit, so clients can animate attacks
}

export interface SimTower {
  id: number;
  side: Side;
  lane: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  attackSeq: number;
}

export interface SimState {
  time: number; // seconds since the match started
  elixir: [number, number];
  units: SimUnit[];
  towers: SimTower[];
}

// winner: 0 or 1, -1 for a draw, null while the match is running.
export interface StepResult {
  deadUnitIds: number[];
  over: boolean;
  winner: Side | -1 | null;
}

type Target = { kind: 'unit'; u: SimUnit } | { kind: 'tower'; t: SimTower };

// Tower stats are a parameter (defaulting to TOWER) so the balance sim can try other values.
export type TowerStats = typeof TOWER;

export function newTowers(tower: TowerStats = TOWER): Omit<SimTower, 'id'>[] {
  const out: Omit<SimTower, 'id'>[] = [];
  for (const side of [0, 1] as Side[]) {
    LANE_X.forEach((x, lane) =>
      out.push({ side, lane, x, y: TOWER_Y[side], hp: tower.health, maxHp: tower.health, cooldown: 0, attackSeq: 0 })
    );
  }
  return out;
}

export function newMatch(tower: TowerStats = TOWER): SimState {
  return {
    time: 0,
    elixir: [ELIXIR_START, ELIXIR_START],
    units: [],
    towers: newTowers(tower).map((t, i) => ({ ...t, id: i + 1 })),
  };
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const tx = (t: Target) => (t.kind === 'unit' ? t.u.x : t.t.x);
const ty = (t: Target) => (t.kind === 'unit' ? t.u.y : t.t.y);
const radius = (t: Target) => (t.kind === 'unit' ? UNIT_RADIUS : TOWER_RADIUS);
// Melee needs to be in contact; ranged units fire from `range` tiles, edge to edge.
const reach = (range: number) => (range <= 1 ? 0.3 : range);

export function step(s: SimState, dt: number, tower: TowerStats = TOWER): StepResult {
  // Pre-match countdown (negative time): only the clock runs.
  if (s.time < 0) {
    s.time = Math.min(0, s.time + dt);
    return { deadUnitIds: [], over: false, winner: null };
  }
  s.time += dt;
  const rate = ELIXIR_PER_SEC * (s.time >= DOUBLE_ELIXIR_AT ? 2 : 1);
  s.elixir = [Math.min(ELIXIR_MAX, s.elixir[0] + rate * dt), Math.min(ELIXIR_MAX, s.elixir[1] + rate * dt)];

  for (const u of s.units) if (u.delay > 0) u.delay = Math.max(0, u.delay - dt);
  const active = s.units.filter(u => u.delay <= 0 && u.hp > 0);
  const live = s.towers.filter(t => t.hp > 0);

  // Units: nearest enemy unit within aggro range, else the nearest enemy tower.
  for (const u of active) {
    if (u.hp <= 0) continue;
    u.cooldown = Math.max(0, u.cooldown - dt);
    const aggro = Math.max(AGGRO_RANGE, u.range + 1);
    let target: Target | null = null;
    let best = Infinity;
    for (const e of active) {
      if (e.side === u.side || e.hp <= 0) continue;
      const d = dist(u.x, u.y, e.x, e.y);
      if (d < aggro && d < best) { best = d; target = { kind: 'unit', u: e } }
    }
    if (!target) {
      for (const t of live) {
        if (t.side === u.side || t.hp <= 0) continue;
        const d = dist(u.x, u.y, t.x, t.y);
        if (d < best) { best = d; target = { kind: 'tower', t } }
      }
    }
    if (!target) continue;
    const gap = dist(u.x, u.y, tx(target), ty(target)) - radius(target) - UNIT_RADIUS;
    if (gap <= reach(u.range)) {
      if (u.cooldown <= 0) {
        if (target.kind === 'unit') target.u.hp -= u.damage;
        else target.t.hp = Math.max(0, target.t.hp - u.damage);
        u.cooldown = 1 / u.attackSpeed;
        u.attackSeq++;
      }
    } else {
      const d = dist(u.x, u.y, tx(target), ty(target));
      const move = Math.min(u.moveSpeed * dt, gap - reach(u.range) + 0.05);
      u.x += ((tx(target) - u.x) / d) * move;
      u.y += ((ty(target) - u.y) / d) * move;
    }
  }

  // Towers shoot the nearest enemy unit in range.
  for (const t of live) {
    if (t.hp <= 0) continue;
    t.cooldown = Math.max(0, t.cooldown - dt);
    let target: SimUnit | null = null;
    let best = Infinity;
    for (const e of active) {
      if (e.side === t.side || e.hp <= 0) continue;
      const d = dist(t.x, t.y, e.x, e.y) - UNIT_RADIUS - TOWER_RADIUS;
      if (d <= tower.range && d < best) { best = d; target = e }
    }
    if (target && t.cooldown <= 0) {
      target.hp -= tower.damage;
      t.cooldown = 1 / tower.attack_speed;
      t.attackSeq++;
    }
  }

  // Keep bodies from stacking, and keep everyone on the board.
  const alive = active.filter(u => u.hp > 0);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      const d = dist(a.x, a.y, b.x, b.y);
      const min = UNIT_RADIUS * 1.8;
      if (d >= min) continue;
      const push = (min - d) / 2;
      const nx = d > 1e-6 ? (a.x - b.x) / d : 1, ny = d > 1e-6 ? (a.y - b.y) / d : 0;
      a.x += nx * push; a.y += ny * push;
      b.x -= nx * push; b.y -= ny * push;
    }
  }
  for (const u of alive) {
    u.x = Math.min(ARENA_W - UNIT_RADIUS, Math.max(UNIT_RADIUS, u.x));
    u.y = Math.min(ARENA_H - UNIT_RADIUS, Math.max(UNIT_RADIUS, u.y));
  }

  const deadUnitIds = s.units.filter(u => u.hp <= 0).map(u => u.id);
  s.units = s.units.filter(u => u.hp > 0);

  const standing = (side: Side) => s.towers.filter(t => t.side === side && t.hp > 0).length;
  const over = s.time >= MATCH_SECONDS || standing(0) === 0 || standing(1) === 0;
  return { deadUnitIds, over, winner: over ? judge(s) : null };
}

// Most enemy towers destroyed wins; tie-break on total tower health left.
export function judge(s: SimState): Side | -1 {
  const lost = (side: Side) => s.towers.filter(t => t.side === side && t.hp <= 0).length;
  const health = (side: Side) => s.towers.filter(t => t.side === side).reduce((a, t) => a + t.hp, 0);
  if (lost(0) !== lost(1)) return lost(0) < lost(1) ? 0 : 1;
  if (health(0) !== health(1)) return health(0) > health(1) ? 0 : 1;
  return -1;
}
