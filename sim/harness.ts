// Headless fights on the real step(): duels between two troops, and one troop against towers.
import { ARENA_W, BRIDGE_X, MATCH_SECONDS, MID_Y, RIVER_HALF, TICK_HZ, TOWER, formation, type Side } from '../shared/arena';
import { newTowers, newUnit, step, type SimState, type TowerStats } from '../shared/sim';
import { MAX_COST, PRICING, clampStats, power, price, quirkMultiplier, sanitizeQuirks, type Pricing, type TroopQuirks, type TroopStats } from '../shared/troop';
import { fairCost, flag, matchCounts, median, trade, tradeRatio, valuePerElixir, type Flag, type SideResult, type Trade } from './metrics';

export interface Troop extends TroopStats, TroopQuirks {
  name: string;
  cost: number;
  power: number;
  rejected: boolean; // priced above MAX_COST: the game would refuse it
  anchor: boolean;
}

export interface Knobs {
  pricing: Pricing;
  tower: TowerStats;
  budget: number; // elixir per side in elixir-matched duels
  timeout: number; // seconds per duel
}

export const DEFAULT_KNOBS: Knobs = { pricing: PRICING, tower: TOWER, budget: 20, timeout: 60 };

// Same path as a deploy in the game: clamp, then price with the quirks.
export function prepare(raw: TroopStats & Partial<TroopQuirks> & { name: string }, pricing: Pricing, anchor = false): Troop {
  const s = clampStats(raw);
  const q = sanitizeQuirks(raw);
  const cost = price(s, q, pricing);
  return { ...s, ...q, name: raw.name, cost, power: power(s, pricing) * quirkMultiplier(q), rejected: cost > MAX_COST, anchor };
}

const DT = 1 / TICK_HZ;
// Duels happen away from the towers: they stay on the board as walking targets (so units
// advance and meet the way they do in a match) but never shoot and can't fall.
const INERT_TOWER: TowerStats = { health: 1e9, damage: 0, attack_speed: 1, range: -1e9 };

let nextId = 1;
function spawn(s: SimState, side: Side, t: TroopStats, x: number, y: number) {
  for (const [dx, dy] of formation(t.count)) {
    s.units.push(newUnit(nextId++, side, x + dx, y + dy, t, 0));
  }
}

// n copies packed in rows of up to 4, extra rows further back from the enemy.
function spawnCopies(s: SimState, side: Side, t: TroopStats, n: number, x: number, y: number) {
  const back = side === 0 ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const cols = Math.min(4, n - Math.floor(i / 4) * 4);
    const col = i % 4, row = Math.floor(i / 4);
    const cx = Math.min(ARENA_W - 0.5, Math.max(0.5, x + (col - (cols - 1) / 2) * 1.0));
    spawn(s, side, t, cx, y + back * row * 0.9);
  }
}

export interface Placement {
  spot: number; // 0 = in front of a bridge, 1 = mid-board, between the bridges
  bFirst: boolean; // B's units come first in the array, so they act first within a tick
  offset: number; // B's sideways offset in tiles
}

// 2 spots × who acts first × sideways offset, to average out geometry and tick order.
export const PLACEMENTS: Placement[] = [0, 1].flatMap(spot =>
  [false, true].flatMap(bFirst => [0, 1].map(offset => ({ spot, bFirst, offset })))
);

// Where a placement or tower run drops: at a bridge, or mid-board, which walks to one first.
const SPOT_X = [BRIDGE_X[0], ARENA_W / 2];

export interface DuelResult {
  a: SideResult;
  b: SideResult;
  winner: 'a' | 'b' | 'draw'; // draw: both wiped on the same tick, or the timeout
  time: number;
}

// A (side 0) and B (side 1) deployed at once, 8 tiles apart across the river (outside every aggro
// radius, so both walk in and engage on their own terms). Runs until one side is wiped.
export function duel(A: Troop, nA: number, B: Troop, nB: number, p: Placement, timeout: number): DuelResult {
  const s: SimState = { time: 0, elixir: [0, 0], units: [], towers: newTowers(INERT_TOWER).map((t, i) => ({ ...t, id: i + 1 })) };
  const x = SPOT_X[p.spot];
  const put = [() => spawnCopies(s, 0, A, nA, x, MID_Y - 4), () => spawnCopies(s, 1, B, nB, x + p.offset, MID_Y + 4)];
  if (p.bFirst) put.reverse();
  put.forEach(f => f());

  const side = (sd: Side, t: Troop, n: number): SideResult => ({
    spent: t.cost * n,
    maxHp: t.health * t.count * n,
    hpLeft: s.units.filter(u => u.side === sd).reduce((a, u) => a + u.hp, 0),
  });
  const alive = (sd: Side) => s.units.some(u => u.side === sd);
  while (alive(0) && alive(1) && s.time < timeout) step(s, DT, INERT_TOWER);
  const a0 = alive(0), a1 = alive(1);
  return { a: side(0, A, nA), b: side(1, B, nB), winner: a0 && !a1 ? 'a' : a1 && !a0 ? 'b' : 'draw', time: s.time };
}

export interface TowerRun {
  towerDamage: number; // enemy tower HP removed
  towersTaken: number;
  timeAlive: number; // seconds until the last unit died, or the end of the match
}

// One troop alone, deployed at the river bank, against full-strength enemy towers.
export function towerRun(t: Troop, spot: number, tower: TowerStats): TowerRun {
  const s: SimState = { time: 0, elixir: [0, 0], units: [], towers: newTowers(tower).map((tw, i) => ({ ...tw, id: i + 1 })) };
  spawn(s, 0, t, SPOT_X[spot], MID_Y - RIVER_HALF - 0.5);
  let over = false;
  while (!over && s.units.length && s.time < MATCH_SECONDS) over = step(s, DT, tower).over;
  const enemy = s.towers.filter(tw => tw.side === 1);
  return {
    towerDamage: enemy.reduce((a, tw) => a + tw.maxHp - tw.hp, 0),
    towersTaken: enemy.filter(tw => tw.hp <= 0).length,
    timeAlive: s.time,
  };
}

// Every troop against the field (elixir-matched and one copy each), plus its tower runs.
export interface Row {
  troop: Troop;
  win1v1: number; // share of one-copy-each duels won (draws count half)
  winMatched: number; // same, elixir-matched
  ratio: number; // elixir destroyed / elixir lost, elixir-matched
  vpe: number; // (destroyed − lost) / spent, elixir-matched
  dpe: number; // enemy HP destroyed per elixir spent, elixir-matched
  avgTime: number; // seconds per matched duel
  bridge: TowerRun;
  middle: TowerRun;
  towerPE: number; // tower damage per elixir, mean of the bridge and mid-board runs
  fair: number;
  duelFlag: Flag;
  towerFlag: Flag;
  vs: Record<string, { nA: number; nB: number; win: number; ratio: number }>;
}

const score = (w: 'a' | 'b' | 'draw') => (w === 'a' ? 1 : w === 'draw' ? 0.5 : 0);

export function evaluate(troops: Troop[], field: Troop[], knobs: Knobs) {
  const rows: Row[] = troops.map(T => {
    let wins1 = 0, games1 = 0, winsM = 0, gamesM = 0, hpDestroyed = 0, time = 0;
    const trades: Trade[] = [];
    const vs: Row['vs'] = {};
    for (const O of field) {
      if (O === T) continue; // mirror matches are even by construction
      for (const p of PLACEMENTS) { wins1 += score(duel(T, 1, O, 1, p, knobs.timeout).winner); games1++ }
      if (T.rejected) continue; // unaffordable in game, so no elixir-matched numbers
      const [nA, nB] = matchCounts(T.cost, O.cost, knobs.budget, T.count, O.count);
      const mine: Trade[] = [];
      let w = 0;
      for (const p of PLACEMENTS) {
        const r = duel(T, nA, O, nB, p, knobs.timeout);
        mine.push(trade(r.a, r.b));
        hpDestroyed += r.b.maxHp - r.b.hpLeft;
        time += r.time;
        w += score(r.winner);
      }
      trades.push(...mine);
      winsM += w; gamesM += PLACEMENTS.length;
      vs[O.name] = { nA, nB, win: w / PLACEMENTS.length, ratio: tradeRatio(mine) };
    }
    const bridge = towerRun(T, 0, knobs.tower), middle = towerRun(T, 1, knobs.tower);
    const spent = trades.reduce((a, t) => a + t.spent, 0);
    return {
      troop: T,
      win1v1: games1 ? wins1 / games1 : NaN,
      winMatched: gamesM ? winsM / gamesM : NaN,
      ratio: trades.length ? tradeRatio(trades) : NaN,
      vpe: trades.length ? valuePerElixir(trades) : NaN,
      dpe: spent ? hpDestroyed / spent : NaN,
      avgTime: gamesM ? time / gamesM : NaN,
      bridge, middle,
      towerPE: (bridge.towerDamage + middle.towerDamage) / 2 / T.cost,
      fair: NaN, duelFlag: null, towerFlag: null, vs,
    };
  });

  // The anchors are the reference curve, so medians come from them alone and extra troops
  // don't shift each other's flags. A troop that only targets buildings walks past units, so
  // duels can't rate it (it trades 0) and it stays out of the duel median; the tower runs do.
  const anchorRows = rows.filter(r => r.troop.anchor && !r.troop.rejected);
  const fights = (r: Row) => r.troop.targets !== 'buildings';
  const medRatio = median(anchorRows.filter(fights).map(r => r.ratio));
  const medTower = median(anchorRows.map(r => r.towerPE));
  for (const r of rows) {
    if (r.troop.rejected) continue;
    if (fights(r)) {
      r.fair = fairCost(r.troop.cost, r.ratio, medRatio);
      r.duelFlag = flag(r.ratio, medRatio);
    }
    r.towerFlag = flag(r.towerPE, medTower);
  }
  return { rows, medRatio, medTower };
}
