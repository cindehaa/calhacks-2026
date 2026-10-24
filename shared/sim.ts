// The combat simulation. Pure and deterministic: no clock, no randomness, no I/O.
// One step() runs in three places: the SpacetimeDB tick (authoritative), bot mode in the
// browser, and the headless balance sim.
import {
  AGGRO_RANGE,
  ARENA_H,
  ARENA_W,
  BRIDGE_HALF,
  BRIDGE_X,
  DOUBLE_ELIXIR_AT,
  ELIXIR_MAX,
  ELIXIR_PER_SEC,
  ELIXIR_START,
  KING_HEALTH,
  KING_LANE,
  MATCH_SECONDS,
  MID_Y,
  RIVER_HALF,
  TOWER,
  TOWER_X,
  UNIT_RADIUS,
  towerRadius,
  towerY,
  type Side,
} from './arena.js';

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
  lane: number; // 0 and 2 princess towers, 1 the king (KING_LANE)
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

// One unit's hit this step, for the per-troop logs. damage is what actually landed (capped at
// the target's remaining health); kill means it finished the unit or tower off.
export interface Hit {
  by: number; // attacking unit id
  tower: boolean;
  damage: number;
  kill: boolean;
}

// winner: 0 or 1, -1 for a draw, null while the match is running.
export interface StepResult {
  deadUnitIds: number[];
  hits: Hit[];
  over: boolean;
  winner: Side | -1 | null;
}

type Target = { kind: 'unit'; u: SimUnit } | { kind: 'tower'; t: SimTower };

// Tower stats are a parameter (defaulting to TOWER) so the balance sim can try other values.
export type TowerStats = typeof TOWER;

export function newTowers(tower: TowerStats = TOWER): Omit<SimTower, 'id'>[] {
  const out: Omit<SimTower, 'id'>[] = [];
  for (const side of [0, 1] as Side[]) {
    TOWER_X.forEach((x, lane) => {
      const hp = tower.health * (lane === KING_LANE ? KING_HEALTH : 1);
      out.push({ side, lane, x, y: towerY(side, lane), hp, maxHp: hp, cooldown: 0, attackSeq: 0 });
    });
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
const radius = (t: Target) => (t.kind === 'unit' ? UNIT_RADIUS : towerRadius(t.t.lane));
// Melee needs to be in contact; ranged units fire from `range` tiles, edge to edge.
const reach = (range: number) => (range <= 1 ? 0.3 : range);

const RIVER_LO = MID_Y - RIVER_HALF, RIVER_HI = MID_Y + RIVER_HALF;
const bank = (y: number) => (y <= RIVER_LO ? -1 : y >= RIVER_HI ? 1 : 0); // 0: on a bridge
const nearestBridge = (x: number) => BRIDGE_X.reduce((b, c) => (Math.abs(c - x) < Math.abs(b - x) ? c : b));

// Troops cross the river only on a bridge. Returns where a unit at (x, y) walks next on its way
// to (tx, ty): straight there on the same bank, else to the near end of whichever bridge makes
// the shorter trip, then over it.
export function waypoint(x: number, y: number, tx: number, ty: number): [number, number] {
  const from = bank(y), to = bank(ty);
  if (from === to && from !== 0) return [tx, ty];
  if (from === 0) {
    const bx = nearestBridge(x);
    if (to === 0 && Math.abs(tx - bx) < BRIDGE_HALF * 2) return [tx, ty]; // both on this bridge
    const dir = to !== 0 ? to : ty >= y ? 1 : -1;
    return [bx, dir > 0 ? RIVER_HI + UNIT_RADIUS : RIVER_LO - UNIT_RADIUS];
  }
  const near = from < 0 ? RIVER_LO - UNIT_RADIUS : RIVER_HI + UNIT_RADIUS;
  const far = from < 0 ? RIVER_HI + UNIT_RADIUS : RIVER_LO - UNIT_RADIUS;
  const trip = (bx: number) => dist(x, y, bx, near) + dist(bx, far, tx, ty);
  const bx = to === 0 ? nearestBridge(tx) : BRIDGE_X.reduce((b, c) => (trip(c) < trip(b) ? c : b));
  const onRamp = Math.abs(x - bx) <= BRIDGE_HALF - UNIT_RADIUS && Math.abs(y - near) <= 0.3 + UNIT_RADIUS;
  if (!onRamp) return [bx, near];
  return to === 0 ? [tx, ty] : [bx, far];
}

// Shoves (from crowding) can't push a unit into the water: off a bridge it goes back to the bank.
function keepOutOfRiver(u: SimUnit) {
  if (bank(u.y) !== 0) return;
  const bx = nearestBridge(u.x), w = BRIDGE_HALF - UNIT_RADIUS;
  if (Math.abs(u.x - bx) <= BRIDGE_HALF + UNIT_RADIUS) u.x = Math.min(bx + w, Math.max(bx - w, u.x));
  else u.y = u.y < MID_Y ? RIVER_LO : RIVER_HI;
}

// The king sleeps until it is hit or one of its princess towers falls.
const awake = (s: SimState, t: SimTower) =>
  t.lane !== KING_LANE || t.hp < t.maxHp || s.towers.some(o => o.side === t.side && o.lane !== KING_LANE && o.hp <= 0);
const kingDown = (s: SimState, side: Side) => s.towers.some(t => t.side === side && t.lane === KING_LANE && t.hp <= 0);

export function step(s: SimState, dt: number, tower: TowerStats = TOWER): StepResult {
  // Pre-match countdown (negative time): only the clock runs.
  if (s.time < 0) {
    s.time += dt;
    if (s.time > -1e-6) s.time = 0; // snap float drift, so 60 ticks of 0.05 s end exactly at 0
    return { deadUnitIds: [], hits: [], over: false, winner: null };
  }
  s.time += dt;
  const rate = ELIXIR_PER_SEC * (s.time >= DOUBLE_ELIXIR_AT ? 2 : 1);
  s.elixir = [Math.min(ELIXIR_MAX, s.elixir[0] + rate * dt), Math.min(ELIXIR_MAX, s.elixir[1] + rate * dt)];

  for (const u of s.units) if (u.delay > 0) u.delay = Math.max(0, u.delay - dt);
  const active = s.units.filter(u => u.delay <= 0 && u.hp > 0);
  const live = s.towers.filter(t => t.hp > 0);
  const hits: Hit[] = [];

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
        if (target.kind === 'unit') {
          hits.push({ by: u.id, tower: false, damage: Math.min(u.damage, target.u.hp), kill: target.u.hp <= u.damage });
          target.u.hp -= u.damage;
        } else {
          hits.push({ by: u.id, tower: true, damage: Math.min(u.damage, target.t.hp), kill: target.t.hp <= u.damage });
          target.t.hp = Math.max(0, target.t.hp - u.damage);
        }
        u.cooldown = 1 / u.attackSpeed;
        u.attackSeq++;
      }
    } else {
      const [wx, wy] = waypoint(u.x, u.y, tx(target), ty(target));
      const direct = wx === tx(target) && wy === ty(target);
      const d = dist(u.x, u.y, wx, wy);
      const move = Math.min(u.moveSpeed * dt, direct ? gap - reach(u.range) + 0.05 : d);
      if (d > 1e-6) {
        u.x += ((wx - u.x) / d) * move;
        u.y += ((wy - u.y) / d) * move;
      }
    }
  }

  // Towers shoot the nearest enemy unit in range.
  for (const t of live) {
    if (t.hp <= 0) continue;
    t.cooldown = Math.max(0, t.cooldown - dt);
    if (!awake(s, t)) continue;
    let target: SimUnit | null = null;
    let best = Infinity;
    for (const e of active) {
      if (e.side === t.side || e.hp <= 0) continue;
      const d = dist(t.x, t.y, e.x, e.y) - UNIT_RADIUS - towerRadius(t.lane);
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
    keepOutOfRiver(u);
  }

  const deadUnitIds = s.units.filter(u => u.hp <= 0).map(u => u.id);
  s.units = s.units.filter(u => u.hp > 0);

  // Losing the king takes the whole side down: three towers.
  for (const side of [0, 1] as Side[]) if (kingDown(s, side)) for (const t of s.towers) if (t.side === side) t.hp = 0;
  const over = s.time >= MATCH_SECONDS || kingDown(s, 0) || kingDown(s, 1);
  return { deadUnitIds, hits, over, winner: over ? judge(s) : null };
}

// Most enemy towers destroyed wins; tie-break on total tower health left.
export function judge(s: SimState): Side | -1 {
  const lost = (side: Side) => s.towers.filter(t => t.side === side && t.hp <= 0).length;
  const health = (side: Side) => s.towers.filter(t => t.side === side).reduce((a, t) => a + t.hp, 0);
  if (lost(0) !== lost(1)) return lost(0) < lost(1) ? 0 : 1;
  if (health(0) !== health(1)) return health(0) > health(1) ? 0 : 1;
  return -1;
}
