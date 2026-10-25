// The practice bot. Pure: it reads a SimState and says which anchor to drop where, or nothing.
// Only the browser's local "vs Bot" mode runs it (never the server); the headless balance sim
// can reuse it. Randomness comes in through `rand`, so tests can seed it and step() stays pure.
import { ANCHORS, type Anchor } from './anchors.js';
import { BRIDGE_X, KING_LANE, MID_Y, clampToHalf, type Side } from './arena.js';
import type { SimState, SimUnit } from './sim.js';
import { K } from './troop.js';

export type BotLevel = 'easy' | 'normal' | 'hard';

export interface BotConfig {
  thinkEvery: number; // seconds between decisions
  cooldown: number; // seconds after a drop lands before it thinks again
  reaction: number; // seconds a threat must be on its half before it defends
  designTime: number; // seconds from lock to deploy, as if it were describing the troop
  fumble: number; // chance a locked drop never comes, like a troop that got misheard
  saveChance: number; // chance, when it could push, to save up for a big troop instead
  minPush: number; // elixir it holds before attacking; defending spends whatever it has
  maxCost: number; // the biggest troop it will ever drop
  jitter: number; // tiles of placement noise
  counters: boolean; // pick defenders that suit the threat (easy picks at random)
}

export const BOT_LEVELS: Record<BotLevel, BotConfig> = {
  easy: { thinkEvery: 4, cooldown: 18, reaction: 4, designTime: 2.5, fumble: 0.3, saveChance: 0, minPush: 3, maxCost: 5, jitter: 1.5, counters: false },
  normal: { thinkEvery: 1.5, cooldown: 6, reaction: 0.8, designTime: 1.2, fumble: 0.1, saveChance: 0.3, minPush: 5, maxCost: 15, jitter: 0.8, counters: true },
  hard: { thinkEvery: 1, cooldown: 3, reaction: 0.4, designTime: 0.8, fumble: 0, saveChance: 0.5, minPush: 7, maxCost: 15, jitter: 0.3, counters: true },
};

// What the bot remembers between decisions.
export interface BotMemory {
  nextThink: number; // sim time of the next decision
  threatSince: number | null; // when enemy units first crossed onto its half
  saveFor: number | null; // anchor index it is saving up for
}

// Give the player a couple of seconds' head start.
export const newBotMemory = (): BotMemory => ({ nextThink: 2, threatSince: null, saveFor: null });

export interface BotMove {
  anchor: number; // index into ANCHORS
  x: number;
  y: number;
  why: 'defend' | 'push';
  fumble: boolean; // lock it, then give up: the drop is telegraphed but nothing lands
}

// How far past the river y is, toward `side`'s back line. Negative on the other half.
const depth = (side: Side, y: number) => (side === 1 ? y - MID_Y : MID_Y - y);
const atDepth = (side: Side, d: number) => (side === 1 ? MID_Y + d : MID_Y - d);
const dps = (a: Anchor) => a.damage * a.attack_speed * a.count;

// Elixir-equivalent of a group of units, the same shape as price(): sqrt(hp * dps) / K.
export function groupValue(units: SimUnit[]): number {
  if (!units.length) return 0;
  const hp = units.reduce((n, u) => n + u.hp, 0);
  const d = units.reduce((n, u) => n + u.damage * u.attackSpeed, 0);
  return Math.sqrt(hp * d) / K;
}

export function botDecide(s: SimState, side: Side, mem: BotMemory, cfg: BotConfig, rand = Math.random): BotMove | null {
  if (s.time < mem.nextThink) return null;
  mem.nextThink = s.time + cfg.thinkEvery * (0.75 + rand() * 0.5);
  const elixir = s.elixir[side];
  const move = decide(s, side, mem, elixir, cfg, rand);
  // A drop buys a rest, counted from when it lands, so it can't chain one troop after another.
  if (move) mem.nextThink = s.time + cfg.designTime + cfg.cooldown * (0.75 + rand() * 0.5);
  return move;
}

function decide(s: SimState, side: Side, mem: BotMemory, elixir: number, cfg: BotConfig, rand: () => number): BotMove | null {
  // Enemy units on its half, or about to cross the river.
  const threats = s.units.filter(u => u.side !== side && depth(side, u.y) > -1.5);
  if (!threats.length) mem.threatSince = null;
  else mem.threatSince ??= s.time;
  if (threats.length && s.time - mem.threatSince! >= cfg.reaction) {
    const move = defend(s, side, threats, elixir, cfg, rand);
    if (move) return move;
  }
  return push(s, side, mem, elixir, cfg, rand);
}

function defend(s: SimState, side: Side, all: SimUnit[], elixir: number, cfg: BotConfig, rand: () => number) {
  // Deal with the most dangerous bridge side first.
  const bySide = BRIDGE_X.map((_, b) => all.filter(u => nearestBridge(u.x) === b));
  const threats = bySide.reduce((b, l) => (groupValue(l) > groupValue(b) ? l : b));
  const cx = threats.reduce((n, u) => n + u.x, 0) / threats.length;
  const cy = threats.reduce((n, u) => n + u.y, 0) / threats.length;
  // Already handled: its own units near the threat outclass it.
  const near = s.units.filter(u => u.side === side && Math.hypot(u.x - cx, u.y - cy) < 6);
  const threat = groupValue(threats);
  if (groupValue(near) > threat * 1.2) return null;
  // Its towers handle a lone small troop; spending on it just loses the elixir race.
  if (threat < 2.5) return null;

  // Answer in proportion: a knight doesn't get a golem.
  const budget = Math.min(elixir, cfg.maxCost, Math.max(3, Math.ceil(threat) + 1));
  const choices = ANCHORS.map((a, i) => ({ a, i })).filter(c => c.a.cost <= budget);
  if (!choices.length) return null;
  const swarm = threats.length >= 4;
  const tanky = threats.reduce((n, u) => n + u.hp, 0) >= 1500;
  // Strongest it can spare, plus a bonus for many hits against swarms and high dps against tanks.
  const scored = choices.map(c => ({
    ...c,
    score: !cfg.counters
      ? rand()
      : c.a.cost + (swarm && (c.a.range > 1 || c.a.count > 1) ? 3 : 0) + (tanky && dps(c.a) >= 200 ? 3 : 0) + rand() * 0.5,
  }));
  const pick = scored.reduce((best, c) => (c.score > best.score ? c : best));

  // Drop between the threat and the tower it's walking at: melee meets it, ranged hangs back.
  const towers = s.towers.filter(t => t.side === side && t.hp > 0);
  const tower = towers.reduce((b, t) => (Math.hypot(t.x - cx, t.y - cy) < Math.hypot(b.x - cx, b.y - cy) ? t : b), towers[0]);
  const k = pick.a.range > 1 ? 0.25 : 0.6;
  const x = tower ? tower.x + (cx - tower.x) * k : cx;
  const y = tower ? tower.y + (cy - tower.y) * k : cy;
  return place(side, pick.i, x, y, 'defend', cfg, rand);
}

function push(s: SimState, side: Side, mem: BotMemory, elixir: number, cfg: BotConfig, rand: () => number) {
  let pick: number | null = null;
  if (mem.saveFor !== null) {
    if (elixir < ANCHORS[mem.saveFor].cost) return null;
    pick = mem.saveFor;
    mem.saveFor = null;
  } else {
    if (elixir < cfg.minPush) return null;
    if (rand() < cfg.saveChance) {
      const big = ANCHORS.map((a, i) => ({ a, i })).filter(c => c.a.cost >= 5 && c.a.cost <= cfg.maxCost);
      if (!big.length) return null;
      mem.saveFor = big[Math.floor(rand() * big.length)].i;
      return null;
    }
    const affordable = ANCHORS.map((a, i) => ({ a, i })).filter(c => c.a.cost <= Math.min(elixir, cfg.maxCost));
    if (!affordable.length) return null;
    // Towers shrug off small troops, so smarter bots lean toward the bigger ones.
    pick = weighted(affordable, c => (cfg.counters ? c.a.cost : 1), rand).i;
  }
  const a = ANCHORS[pick];
  // Tanks lead from the bridge; everything else follows a few tiles back.
  const d = a.health * a.count >= 900 ? 1.5 : 4;
  const bridge = cfg.counters ? pushingBridge(s, side) ?? weakestBridge(s, side, rand) : weakestBridge(s, side, rand);
  return place(side, pick, BRIDGE_X[bridge], atDepth(side, d), 'push', cfg, rand);
}

// The bridge its own troops are already pushing over, so the next drop backs them up.
function pushingBridge(s: SimState, side: Side): number | null {
  const mine = s.units.filter(u => u.side === side && depth(side, u.y) > -6);
  if (!mine.length) return null;
  const value = BRIDGE_X.map((_, b) => groupValue(mine.filter(u => nearestBridge(u.x) === b)));
  return value.indexOf(Math.max(...value));
}

const nearestBridge = (x: number) => BRIDGE_X.reduce((b, bx, i) => (Math.abs(bx - x) < Math.abs(BRIDGE_X[b] - x) ? i : b), 0);

function weighted<T>(items: T[], weight: (t: T) => number, rand: () => number): T {
  let r = rand() * items.reduce((n, t) => n + weight(t), 0);
  for (const t of items) if ((r -= weight(t)) < 0) return t;
  return items[items.length - 1];
}

// The bridge in front of the enemy's weakest standing princess tower; ties, and a king with
// both princess towers gone, go to a random bridge.
export function weakestBridge(s: SimState, side: Side, rand = Math.random): number {
  const standing = s.towers.filter(t => t.side !== side && t.hp > 0 && t.lane !== KING_LANE);
  if (!standing.length) return Math.floor(rand() * BRIDGE_X.length);
  const low = Math.min(...standing.map(t => t.hp));
  const weakest = standing.filter(t => t.hp - low < 1);
  return nearestBridge(weakest[Math.floor(rand() * weakest.length)].x);
}

function place(side: Side, anchor: number, x: number, y: number, why: BotMove['why'], cfg: BotConfig, rand: () => number): BotMove {
  const [px, py] = clampToHalf(side, x + (rand() - 0.5) * 2 * cfg.jitter, y + (rand() - 0.5) * 2 * cfg.jitter);
  return { anchor, x: px, y: py, why, fumble: rand() < cfg.fumble };
}
