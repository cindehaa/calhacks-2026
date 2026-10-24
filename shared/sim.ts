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
import type { Attack, Element, Motion, OnHit, Targets, Trait, TroopDesign } from './troop';

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
  // Quirks, copied from the design. motion and element are only for the renderer.
  attack: Attack;
  targets: Targets;
  onHit: OnHit;
  windup: boolean;
  trait: Trait; // flying is trait === 'flying'
  motion: Motion;
  element: Element;
  // Status timers (tier 2): seconds remaining, burn as damage per second. 0 when inactive.
  burnT: number;
  burnDps: number;
  slowT: number;
  stunT: number;
  windupT: number; // seconds charged toward the current hit, 0..WINDUP_SECONDS
  // Traits (tier 3).
  shield: number; // shield hp, lost before health; 0 without the trait
  maxShield: number;
  spawnT: number; // seconds until the next minion
  chargeDist: number; // tiles moved since the last attack
  // Where the most recent hit landed, and the extra hops of a chain (empty otherwise).
  lastTargetX: number;
  lastTargetY: number;
  chainXs: number[];
  chainYs: number[];
}

// Quirk rule numbers, fixed in code (spec: Troop quirks → Quirk rules).
export const SPLASH_RADIUS = 1; // tiles around the target
export const BREATH_HALF_ANGLE = Math.PI / 6; // a 60° cone
export const CHAIN_HOPS = 3;
export const CHAIN_JUMP = 2; // tiles from the last target
export const CHAIN_FALLOFF = 0.75;
export const WINDUP_SECONDS = 0.8;

type UnitDesign = Pick<TroopDesign, 'health' | 'damage' | 'attack_speed' | 'move_speed' | 'range'> &
  Partial<Pick<TroopDesign, 'attack' | 'targets' | 'on_hit' | 'windup' | 'trait' | 'motion' | 'element'>>;

// A fresh unit from a design. Every spawn site goes through this so new fields can't be missed.
export function newUnit(id: number, side: Side, x: number, y: number, d: UnitDesign, delay: number): SimUnit {
  return {
    id, side, x, y, hp: d.health, maxHp: d.health, damage: d.damage, attackSpeed: d.attack_speed,
    moveSpeed: d.move_speed, range: d.range, cooldown: 0, delay, attackSeq: 0,
    attack: d.attack ?? 'single', targets: d.targets ?? 'any', onHit: d.on_hit ?? 'none', windup: d.windup ?? false,
    trait: d.trait ?? 'none', motion: d.motion ?? 'other', element: d.element ?? 'none',
    burnT: 0, burnDps: 0, slowT: 0, stunT: 0, windupT: 0, shield: 0, maxShield: 0, spawnT: 0, chargeDist: 0,
    lastTargetX: x, lastTargetY: y, chainXs: [], chainYs: [],
  };
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
    s.time += dt;
    if (s.time > -1e-6) s.time = 0; // snap float drift, so 60 ticks of 0.05 s end exactly at 0
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
    // targets: buildings ignores units and walks to the nearest tower.
    for (const e of u.targets === 'buildings' ? [] : active) {
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
        hit(u, target, active, live);
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

// One attack by u on its target, shaped by u.attack. Towers always hit single targets.
function hit(u: SimUnit, target: Target, units: SimUnit[], towers: SimTower[]) {
  const x = tx(target), y = ty(target);
  u.lastTargetX = x;
  u.lastTargetY = y;
  u.chainXs = [];
  u.chainYs = [];
  const enemies: Target[] = [];
  for (const e of units) if (e.side !== u.side && e.hp > 0) enemies.push({ kind: 'unit', u: e });
  for (const t of towers) if (t.side !== u.side && t.hp > 0) enemies.push({ kind: 'tower', t });
  const same = (a: Target, b: Target) => (a.kind === 'unit' ? b.kind === 'unit' && a.u === b.u : b.kind === 'tower' && a.t === b.t);
  // Edge distance from a point, so a tower's bulk counts like a unit's.
  const edge = (e: Target, px: number, py: number) => dist(px, py, tx(e), ty(e)) - radius(e);

  if (u.attack === 'splash') {
    // Full damage to every enemy within SPLASH_RADIUS of the target.
    for (const e of enemies) if (same(e, target) || edge(e, x, y) <= SPLASH_RADIUS) damage(e, u.damage);
  } else if (u.attack === 'breath') {
    // Full damage to every enemy in a 60° cone out to the unit's range.
    const aim = Math.atan2(y - u.y, x - u.x);
    const len = Math.max(u.range, reach(u.range)) + UNIT_RADIUS;
    for (const e of enemies) {
      if (same(e, target)) { damage(e, u.damage); continue; }
      if (edge(e, u.x, u.y) > len) continue;
      let da = Math.abs(Math.atan2(ty(e) - u.y, tx(e) - u.x) - aim);
      if (da > Math.PI) da = 2 * Math.PI - da;
      if (da <= BREATH_HALF_ANGLE) damage(e, u.damage);
    }
  } else if (u.attack === 'chain') {
    // The target, then up to CHAIN_HOPS more, each the nearest unhit enemy within CHAIN_JUMP
    // of the last one, each jump CHAIN_FALLOFF of the one before.
    damage(target, u.damage);
    const done = [target];
    let last = target, dmg = u.damage;
    for (let hop = 0; hop < CHAIN_HOPS; hop++) {
      let next: Target | null = null, best = Infinity;
      for (const e of enemies) {
        if (done.some(d => same(d, e))) continue;
        const d = edge(e, tx(last), ty(last)) - radius(last);
        if (d <= CHAIN_JUMP && d < best) { best = d; next = e }
      }
      if (!next) break;
      dmg *= CHAIN_FALLOFF;
      damage(next, dmg);
      done.push(next);
      u.chainXs.push(tx(next));
      u.chainYs.push(ty(next));
      last = next;
    }
  } else {
    damage(target, u.damage);
  }
}

function damage(t: Target, amount: number) {
  if (t.kind === 'unit') t.u.hp -= amount;
  else t.t.hp = Math.max(0, t.t.hp - amount);
}

// Most enemy towers destroyed wins; tie-break on total tower health left.
export function judge(s: SimState): Side | -1 {
  const lost = (side: Side) => s.towers.filter(t => t.side === side && t.hp <= 0).length;
  const health = (side: Side) => s.towers.filter(t => t.side === side).reduce((a, t) => a + t.hp, 0);
  if (lost(0) !== lost(1)) return lost(0) < lost(1) ? 0 : 1;
  if (health(0) !== health(1)) return health(0) > health(1) ? 0 : 1;
  return -1;
}
