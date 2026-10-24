// Where a match comes from. main.ts renders and deploys through MatchSource, so the same UI
// plays an online room (OnlineMatch, SpacetimeDB) or a bot match in this tab (LocalMatch).
import { ELIXIR, TICK_HZ, type ElixirRules, type Side } from '../../shared/arena';
import type { SimUnit } from '../../shared/sim';
import type { Attack, Element, Motion, OnHit, Targets, Trait, TroopDesign } from '../../shared/troop';
import type { Player, Room } from './module_bindings/types';
import type { Net } from './net';
import { exactCost } from './value';
import type { DrawPending, DrawTower, DrawTroop, DrawUnit } from './render';

export type MatchStatus = 'lobby' | 'playing' | 'done';

// Quirk and state fields the renderer reads, under SimUnit's names (shared/sim.ts).
export type UnitQuirkView = Pick<SimUnit, 'attackSpeed' |
  'attack' | 'targets' | 'onHit' | 'windup' | 'trait' | 'motion' | 'element' | 'burnT' | 'burnDps' | 'slowT' | 'stunT' |
  'windupT' | 'shield' | 'maxShield' | 'spawnT' | 'chargeDist' | 'lastTargetX' | 'lastTargetY' | 'chainXs' | 'chainYs'>;

export interface MatchUnit extends DrawUnit, UnitQuirkView {
  attackSeq: number; // bumps on every hit
  damage?: number; // per hit, for the result screen's MVP tally online (mvp.ts)
}

// Copies the quirk fields off a SimUnit or a unit row (same camelCase names; enums are strings in the table).
export function quirkView(u: Omit<UnitQuirkView, 'attack' | 'targets' | 'onHit' | 'trait' | 'motion' | 'element'> &
  { attack: string; targets: string; onHit: string; trait: string; motion: string; element: string }): UnitQuirkView {
  return {
    attackSpeed: u.attackSpeed, attack: u.attack as Attack, targets: u.targets as Targets, onHit: u.onHit as OnHit, windup: u.windup,
    trait: u.trait as Trait, motion: u.motion as Motion, element: u.element as Element,
    burnT: u.burnT, burnDps: u.burnDps, slowT: u.slowT, stunT: u.stunT, windupT: u.windupT,
    shield: u.shield, maxShield: u.maxShield, spawnT: u.spawnT, chargeDist: u.chargeDist,
    lastTargetX: u.lastTargetX, lastTargetY: u.lastTargetY, chainXs: u.chainXs, chainYs: u.chainYs,
  };
}
export interface MatchTower extends DrawTower {
  lane: number;
  attackSeq: number;
}

export interface MatchSource {
  readonly key: string; // room code, or 'bot'
  readonly label: string; // HUD text: 'room ABCD' or 'vs Bot'
  readonly side: Side;
  readonly status: MatchStatus;
  readonly time: number; // match seconds elapsed
  readonly elixir: number; // yours
  readonly rules: ElixirRules; // cap and refill; online always plays ELIXIR
  readonly winner: Side | -1 | null; // -1 draw, null while undecided
  units(): MatchUnit[]; // positions already smoothed between ticks
  towers(): MatchTower[];
  troops(): Map<bigint, DrawTroop>;
  pendings(): DrawPending[];
  // Same contract as the server's reducers: errors reject with the reducer's message,
  // e.g. 'too expensive: 12' or 'not enough elixir: 6'.
  beginDeploy(nonce: number, x: number, y: number): Promise<void>;
  deployTroop(nonce: number, x: number, y: number, description: string, d: TroopDesign, spriteUrl?: string): Promise<void>;
  cancelDeploy(nonce: number): Promise<void>;
  // Art that arrived after the deploy: set it on your troops with this description that have none.
  attachSprite(description: string, spriteUrl: string): Promise<void>;
  rematch(): Promise<void>;
  leave(): Promise<void>;
}

// The sim ticks at 20 Hz; glide each unit from where it was drawn to its new position.
const TICK_MS = 1000 / TICK_HZ;

export class Glide {
  private g = new Map<bigint, { fx: number; fy: number; tx: number; ty: number; at: number }>();

  moved(id: bigint, x: number, y: number): void {
    const [cx, cy] = this.pos(id, x, y);
    this.g.set(id, { fx: cx, fy: cy, tx: x, ty: y, at: performance.now() });
  }

  drop(id: bigint): void {
    this.g.delete(id);
  }

  pos(id: bigint, x: number, y: number): [number, number] {
    const g = this.g.get(id);
    if (!g) return [x, y];
    const k = Math.min(1, (performance.now() - g.at) / TICK_MS);
    return [g.fx + (g.tx - g.fx) * k, g.fy + (g.ty - g.fy) * k];
  }
}

// The player's room on the SpacetimeDB connection. A thin view over the subscribed tables.
export class OnlineMatch implements MatchSource {
  readonly rules = ELIXIR;
  private glide = new Glide();
  // The SDK's find() scans the whole table, the player table gains a row for every tab ever
  // opened, and the HUD asks for me() and room() dozens of times a frame. So look them up again
  // only after a player or room row has changed.
  private changes = 0;
  private looked = -1;
  private meRow: Player | undefined;
  private roomRow: Room | undefined;

  constructor(readonly net: Net) {
    net.conn.db.unit.onUpdate((_ctx, _old, row) => this.glide.moved(row.id, row.x, row.y));
    net.conn.db.unit.onDelete((_ctx, row) => this.glide.drop(row.id));
    const changed = () => void this.changes++;
    for (const t of [net.conn.db.player, net.conn.db.room]) {
      t.onInsert(changed);
      t.onUpdate(changed);
      t.onDelete(changed);
    }
  }

  me(): Player | undefined {
    this.lookUp();
    return this.meRow;
  }

  room(): Room | undefined {
    this.lookUp();
    return this.roomRow;
  }

  private lookUp(): void {
    if (this.looked === this.changes) return;
    this.looked = this.changes;
    const db = this.net.conn.db;
    this.meRow = db.player.identity.find(this.net.identity) ?? undefined;
    this.roomRow = this.meRow?.roomCode ? db.room.code.find(this.meRow.roomCode) ?? undefined : undefined;
  }

  private get code() {
    return this.room()?.code ?? '';
  }

  get key() { return this.code; }
  get label() { return `room ${this.code}`; }
  get side(): Side {
    const r = this.room();
    return r && r.guest && r.guest.isEqual(this.net.identity) ? 1 : 0;
  }
  get status() { return (this.room()?.status ?? 'lobby') as MatchStatus; }
  get time() { return this.room()?.time ?? 0; }
  get elixir() {
    const r = this.room();
    return !r ? 0 : this.side === 0 ? r.elixir0 : r.elixir1;
  }
  get winner() {
    const r = this.room();
    return r?.status === 'done' ? (r.winner as Side | -1) : null;
  }

  units(): MatchUnit[] {
    const code = this.code, out: MatchUnit[] = [];
    for (const u of this.net.conn.db.unit.iter()) {
      if (u.roomCode !== code) continue;
      const [x, y] = this.glide.pos(u.id, u.x, u.y);
      out.push({ ...quirkView(u), id: u.id, troopId: u.troopId, side: u.side, x, y, hp: u.hp, maxHp: u.maxHp, delay: u.delay, attackSeq: u.attackSeq, range: u.range, damage: u.damage });
    }
    return out;
  }

  towers(): MatchTower[] {
    const code = this.code;
    return [...this.net.conn.db.tower.iter()].filter(t => t.roomCode === code);
  }

  troops(): Map<bigint, DrawTroop> {
    const code = this.code;
    return new Map(
      [...this.net.conn.db.troop.iter()].filter(t => t.roomCode === code).map(t => [t.id, { name: t.name, cost: t.cost, spriteUrl: t.spriteUrl, description: t.description, flavor: t.flavor, value: troopValue(t) }])
    );
  }

  pendings(): DrawPending[] {
    const code = this.code;
    const nowMicros = BigInt(Date.now()) * 1000n;
    return [...this.net.conn.db.pending.iter()]
      .filter(p => p.roomCode === code)
      .map(p => ({ side: p.side, x: p.x, y: p.y, age: Number(nowMicros - p.createdAt.microsSinceUnixEpoch) / 1e6 }));
  }

  beginDeploy(nonce: number, x: number, y: number) {
    return this.net.conn.reducers.beginDeploy({ nonce, x, y });
  }

  deployTroop(nonce: number, x: number, y: number, description: string, d: TroopDesign, spriteUrl = '') {
    return this.net.conn.reducers.deployTroop({
      nonce, x, y, description, name: d.name, health: d.health, damage: d.damage, attackSpeed: d.attack_speed,
      moveSpeed: d.move_speed, range: d.range, count: d.count, battleCry: d.battle_cry, voiceStyle: d.voice_style,
      spriteUrl, attack: d.attack, targets: d.targets, onHit: d.on_hit, windup: d.windup, trait: d.trait,
      motion: d.motion, element: d.element, flavor: d.flavor,
    });
  }

  cancelDeploy(nonce: number) {
    return this.net.conn.reducers.cancelDeploy({ nonce });
  }

  // set_troop_sprite only takes the owner's troops. The new row can trail the reducer's reply by
  // a moment, so look a few times before giving up.
  async attachSprite(description: string, spriteUrl: string) {
    const desc = description.slice(0, 300);
    for (let tries = 0; tries < 6; tries++) {
      const mine = [...this.net.conn.db.troop.iter()].filter(
        t => t.roomCode === this.code && t.owner.isEqual(this.net.identity) && t.description === desc && !t.spriteUrl
      );
      if (mine.length) {
        await Promise.all(mine.map(t => this.net.conn.reducers.setTroopSprite({ troopId: t.id, spriteUrl })));
        return;
      }
      await new Promise(r => setTimeout(r, 250));
    }
  }

  rematch() {
    return this.net.conn.reducers.startMatch({});
  }

  leave() {
    return this.net.conn.reducers.leaveRoom({});
  }

  forfeit() {
    return this.net.conn.reducers.forfeit({});
  }
}

// The unrounded price of a troop row, for the cost reveal's tint (value.ts).
type TroopRow = { health: number; damage: number; attackSpeed: number; moveSpeed: number; range: number; count: number; attack: string; targets: string; onHit: string; windup: boolean; trait: string };
const values = new WeakMap<object, number>();
function troopValue(t: TroopRow): number {
  let v = values.get(t);
  if (v === undefined) {
    v = exactCost({
      health: t.health, damage: t.damage, attack_speed: t.attackSpeed, move_speed: t.moveSpeed, range: t.range, count: t.count,
      attack: t.attack as Attack, targets: t.targets as Targets, on_hit: t.onHit as OnHit, windup: t.windup, trait: t.trait as Trait,
    });
    values.set(t, v);
  }
  return v;
}
