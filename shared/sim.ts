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
import type { Attack, Element, Motion, OnHit, Targets, Trait, TroopDesign } from './troop.js';

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
export const BURN_SHARE = 0.2; // of hit damage, per second
export const BURN_SECONDS = 3;
export const SLOW_FACTOR = 0.6; // move and attack speed while slowed
export const SLOW_SECONDS = 2;
export const STUN_SECONDS = 0.5;
export const SHIELD_SHARE = 0.3; // of health
export const SPAWN_EVERY = 5;
export const MINION = { health: 100, damage: 20, attack_speed: 1, move_speed: 1, range: 1 };
export const BURST_MULT = 2;
export const BURST_RADIUS = 1.5;
export const AURA_RADIUS = 2;
export const AURA_SHARE = 0.03; // of max health, per second
export const CHARGE_AFTER = 2; // tiles moved without attacking
export const CHARGE_MULT = 2; // damage of the charged hit
export const CHARGE_SPEED = 1.5;

type UnitDesign = Pick<TroopDesign, 'health' | 'damage' | 'attack_speed' | 'move_speed' | 'range'> &
  Partial<Pick<TroopDesign, 'attack' | 'targets' | 'on_hit' | 'windup' | 'trait' | 'motion' | 'element'>>;

// A fresh unit from a design. Every spawn site goes through this so new fields can't be missed.
export function newUnit(id: number, side: Side, x: number, y: number, d: UnitDesign, delay: number): SimUnit {
  const trait = d.trait ?? 'none';
  const shield = trait === 'shield' ? d.health * SHIELD_SHARE : 0;
  return {
    id, side, x, y, hp: d.health, maxHp: d.health, damage: d.damage, attackSpeed: d.attack_speed,
    moveSpeed: d.move_speed, range: d.range, cooldown: 0, delay, attackSeq: 0,
    attack: d.attack ?? 'single', targets: d.targets ?? 'any', onHit: d.on_hit ?? 'none', windup: d.windup ?? false,
    trait, motion: d.motion ?? 'other', element: d.element ?? 'none',
    burnT: 0, burnDps: 0, slowT: 0, stunT: 0, windupT: 0, shield, maxShield: shield,
    spawnT: trait === 'spawner' ? SPAWN_EVERY : 0, chargeDist: 0,
    lastTargetX: x, lastTargetY: y, chainXs: [], chainYs: [],
  };
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
// spawned: units step() added to s.units this tick (spawner minions), with the id of their spawner.
// Their ids are max id + 1, unique within the state; hosts with their own id scheme reassign them.
export interface StepResult {
  deadUnitIds: number[];
  hits: Hit[];
  spawned: { unit: SimUnit; parentId: number }[];
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
    return { deadUnitIds: [], hits: [], spawned: [], over: false, winner: null };
  }
  s.time += dt;
  const rate = ELIXIR_PER_SEC * (s.time >= DOUBLE_ELIXIR_AT ? 2 : 1);
  s.elixir = [Math.min(ELIXIR_MAX, s.elixir[0] + rate * dt), Math.min(ELIXIR_MAX, s.elixir[1] + rate * dt)];

  for (const u of s.units) if (u.delay > 0) u.delay = Math.max(0, u.delay - dt);
  const active = s.units.filter(u => u.delay <= 0 && u.hp > 0);
  const live = s.towers.filter(t => t.hp > 0);
  const hits: Hit[] = [];

  // Heal auras first, from health as it stood at the start of the tick.
  for (const h of active) {
    if (h.trait !== 'heal_aura' || h.hp <= 0) continue;
    for (const a of active) {
      if (a === h || a.side !== h.side || a.hp <= 0 || dist(a.x, a.y, h.x, h.y) > AURA_RADIUS) continue;
      a.hp = Math.min(a.maxHp, a.hp + a.maxHp * AURA_SHARE * dt);
    }
  }

  // Spawners drop a minion at their feet every SPAWN_EVERY seconds.
  const spawned: StepResult['spawned'] = [];
  let maxId = s.units.reduce((m, u) => Math.max(m, u.id), 0);
  for (const u of active) {
    if (u.trait !== 'spawner' || u.hp <= 0) continue;
    u.spawnT -= dt;
    if (u.spawnT > 0) continue;
    u.spawnT += SPAWN_EVERY;
    const m = newUnit(++maxId, u.side, u.x, u.y, MINION, 0);
    s.units.push(m);
    spawned.push({ unit: m, parentId: u.id });
  }

  // Units: nearest enemy unit within aggro range, else the nearest enemy tower.
  for (const u of active) {
    if (u.hp <= 0) continue;
    // Status effects: burn ticks, stun freezes everything, slow scales the clock for moving and hitting.
    if (u.burnT > 0) {
      hurt(u, u.burnDps * Math.min(dt, u.burnT));
      u.burnT = Math.max(0, u.burnT - dt);
      if (u.burnT === 0) u.burnDps = 0;
      if (u.hp <= 0) continue;
    }
    const slowed = u.slowT > 0;
    u.slowT = Math.max(0, u.slowT - dt);
    if (u.stunT > 0) {
      u.stunT = Math.max(0, u.stunT - dt);
      continue;
    }
    const pace = slowed ? SLOW_FACTOR : 1;
    u.cooldown = Math.max(0, u.cooldown - dt * pace);
    const charged = u.trait === 'charge' && u.chargeDist >= CHARGE_AFTER;
    const aggro = Math.max(AGGRO_RANGE, u.range + 1);
    let target: Target | null = null;
    let best = Infinity;
    // targets: buildings ignores units and walks to the nearest tower.
    for (const e of u.targets === 'buildings' ? [] : active) {
      if (e.side === u.side || e.hp <= 0 || !canHit(u, e)) continue;
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
        // windup: charge in reach for WINDUP_SECONDS before each hit.
        if (u.windup && u.windupT < WINDUP_SECONDS) u.windupT = Math.min(WINDUP_SECONDS, u.windupT + dt * pace);
        if (!u.windup || u.windupT >= WINDUP_SECONDS) {
          hit(u, target, active, live, hits, charged ? CHARGE_MULT : 1);
          u.cooldown = 1 / u.attackSpeed;
          u.attackSeq++;
          u.windupT = 0;
          u.chargeDist = 0;
        }
      }
    } else {
      u.windupT = 0;
      // Ground units cross the river on a bridge; flying units go straight over it.
      const [wx, wy] = u.trait === 'flying' ? [tx(target), ty(target)] : waypoint(u.x, u.y, tx(target), ty(target));
      const direct = wx === tx(target) && wy === ty(target);
      const d = dist(u.x, u.y, wx, wy);
      const move = Math.min(u.moveSpeed * pace * (charged ? CHARGE_SPEED : 1) * dt, direct ? gap - reach(u.range) + 0.05 : d);
      if (d > 1e-6) {
        u.x += ((wx - u.x) / d) * move;
        u.y += ((wy - u.y) / d) * move;
      }
      if (u.trait === 'charge') u.chargeDist += move;
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
      hurt(target, tower.damage);
      t.cooldown = 1 / tower.attack_speed;
      t.attackSeq++;
    }
  }

  // death_burst: once, on death, BURST_MULT × damage to enemies within BURST_RADIUS. Bursts can chain.
  const burst = new Set<SimUnit>();
  for (let more = true; more;) {
    more = false;
    for (const u of active) {
      if (u.hp > 0 || u.trait !== 'death_burst' || burst.has(u)) continue;
      burst.add(u);
      more = true;
      for (const e of active) {
        if (e.side !== u.side && e.hp > 0 && dist(u.x, u.y, e.x, e.y) - UNIT_RADIUS <= BURST_RADIUS) hurt(e, u.damage * BURST_MULT);
      }
      for (const t of live) {
        if (t.side !== u.side && t.hp > 0 && dist(u.x, u.y, t.x, t.y) - towerRadius(t.lane) <= BURST_RADIUS) {
          t.hp = Math.max(0, t.hp - u.damage * BURST_MULT);
        }
      }
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
    if (u.trait !== 'flying') keepOutOfRiver(u);
  }

  const deadUnitIds = s.units.filter(u => u.hp <= 0).map(u => u.id);
  s.units = s.units.filter(u => u.hp > 0);

  // Losing the king takes the whole side down: three towers.
  for (const side of [0, 1] as Side[]) if (kingDown(s, side)) for (const t of s.towers) if (t.side === side) t.hp = 0;
  const over = s.time >= MATCH_SECONDS || kingDown(s, 0) || kingDown(s, 1);
  return { deadUnitIds, hits, spawned, over, winner: over ? judge(s) : null };
}

// flying: melee units can't reach it; ranged units and towers can.
const canHit = (u: SimUnit, e: SimUnit) => e.trait !== 'flying' || u.range > 1;

// Damage to a unit, through its shield first.
function hurt(u: SimUnit, amount: number) {
  const soak = Math.min(u.shield, amount);
  u.shield -= soak;
  u.hp -= amount - soak;
}

// One attack by u on its target, shaped by u.attack. Towers always hit single targets.
// mult scales every hit (a charged hit). on_hit lands on every unit hit, never on towers.
// Each target hit goes on `hits` with the health it actually lost (shields soak first).
function hit(u: SimUnit, target: Target, units: SimUnit[], towers: SimTower[], hits: Hit[], mult = 1) {
  const x = tx(target), y = ty(target);
  u.lastTargetX = x;
  u.lastTargetY = y;
  u.chainXs = [];
  u.chainYs = [];
  const enemies: Target[] = [];
  for (const e of units) if (e.side !== u.side && e.hp > 0 && canHit(u, e)) enemies.push({ kind: 'unit', u: e });
  for (const t of towers) if (t.side !== u.side && t.hp > 0) enemies.push({ kind: 'tower', t });
  const same = (a: Target, b: Target) => (a.kind === 'unit' ? b.kind === 'unit' && a.u === b.u : b.kind === 'tower' && a.t === b.t);
  // Edge distance from a point, so a tower's bulk counts like a unit's.
  const edge = (e: Target, px: number, py: number) => dist(px, py, tx(e), ty(e)) - radius(e);
  const damage = (e: Target, amount: number) => {
    amount *= mult;
    if (e.kind === 'tower') {
      const hp = e.t.hp;
      e.t.hp = Math.max(0, hp - amount);
      hits.push({ by: u.id, tower: true, damage: hp - e.t.hp, kill: hp > 0 && e.t.hp <= 0 });
      return;
    }
    const hp = e.u.hp;
    hurt(e.u, amount);
    hits.push({ by: u.id, tower: false, damage: hp - Math.max(0, e.u.hp), kill: hp > 0 && e.u.hp <= 0 });
    if (u.onHit === 'burn') { e.u.burnT = BURN_SECONDS; e.u.burnDps = amount * BURN_SHARE; }
    else if (u.onHit === 'slow') e.u.slowT = SLOW_SECONDS;
    else if (u.onHit === 'stun') {
      e.u.stunT = STUN_SECONDS;
      e.u.cooldown = 1 / e.u.attackSpeed;
      e.u.windupT = 0;
    }
  };

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

// Most enemy towers destroyed wins; tie-break on total tower health left.
export function judge(s: SimState): Side | -1 {
  const lost = (side: Side) => s.towers.filter(t => t.side === side && t.hp <= 0).length;
  const health = (side: Side) => s.towers.filter(t => t.side === side).reduce((a, t) => a + t.hp, 0);
  if (lost(0) !== lost(1)) return lost(0) < lost(1) ? 0 : 1;
  if (health(0) !== health(1)) return health(0) > health(1) ? 0 : 1;
  return -1;
}
