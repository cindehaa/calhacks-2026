// "vs Bot": a whole match in this tab, for solo practice and as the demo fallback when the
// network or Maincloud is down. Nothing here touches SpacetimeDB; nobody else can see it.
// It runs the same step() and deploy rules as the server, with you as side 0 and the bot as 1.
import { ANCHORS } from '../../shared/anchors';
import { COUNTDOWN, TICK_HZ, canDeploy, clampDeploy, type Side } from '../../shared/arena';
import { BOT_LEVELS, botDecide, newBotMemory, type BotLevel, type BotMemory, type BotMove } from '../../shared/bot';
import { arrivalDelay, priceDeploy, unitSpots } from '../../shared/deploy';
import { newMatch, step, type SimState } from '../../shared/sim';
import type { TroopDesign } from '../../shared/troop';
import { Glide, type MatchSource, type MatchStatus, type MatchTower, type MatchUnit } from './match';
import type { DrawPending, DrawTroop } from './render';
import { readySprite, spriteFor } from './sprites';

const DT = 1 / TICK_HZ;
const PENDING_TTL = 15; // seconds; a lock nobody followed up on (same as the server)
const BOT: Side = 1;

interface Lock { side: Side; nonce: number; x: number; y: number; at: number } // at = sim time

export class LocalMatch implements MatchSource {
  readonly key = 'bot';
  readonly side: Side = 0;
  readonly label: string;
  status: MatchStatus = 'playing';
  winner: Side | -1 | null = null;

  private s!: SimState;
  private locks: Lock[] = [];
  private troopRows = new Map<bigint, DrawTroop>();
  private unitTroop = new Map<number, bigint>();
  private nextId = 100; // towers take 1–6
  private mem!: BotMemory;
  private botMove: { nonce: number; move: BotMove; at: number } | null = null; // locked, not yet deployed
  private glide = new Glide();
  private acc = 0;
  private last = 0;
  private raf = 0;

  constructor(readonly level: BotLevel = 'normal', private onLeave: () => void = () => {}, autorun = true, private rand = Math.random) {
    this.label = level === 'normal' ? 'vs Bot' : `vs Bot (${level})`;
    this.reset();
    if (autorun) this.raf = requestAnimationFrame(this.loop);
  }

  get time() { return this.s.time; }
  get elixir() { return this.s.elixir[this.side]; }

  units(): MatchUnit[] {
    return this.s.units.map(u => {
      const id = BigInt(u.id);
      const [x, y] = this.glide.pos(id, u.x, u.y);
      const troopId = this.unitTroop.get(u.id) ?? 0n;
      return { id, troopId, side: u.side, x, y, hp: u.hp, maxHp: u.maxHp, delay: u.delay, attackSeq: u.attackSeq, range: u.range };
    });
  }

  towers(): MatchTower[] { return this.s.towers; }
  troops() { return this.troopRows; }

  pendings(): DrawPending[] {
    return this.locks.map(l => ({ side: l.side, x: l.x, y: l.y, age: this.s.time - l.at }));
  }

  // Async so errors reject like the server's reducers; the body still runs synchronously,
  // so a beginDeploy() followed straight away by deployTroop() keeps its order.
  async beginDeploy(nonce: number, x: number, y: number) { this.lock(this.side, nonce, x, y); }
  async deployTroop(nonce: number, x: number, y: number, description: string, d: TroopDesign, spriteUrl = '') {
    this.deploy(this.side, nonce, x, y, description, d, spriteUrl);
  }
  async cancelDeploy(nonce: number) { this.unlock(this.side, nonce); }
  // Both sides: the bot's anchors get art the same way.
  async attachSprite(description: string, url: string) {
    for (const t of this.troopRows.values()) if (t.description === description && !t.spriteUrl) t.spriteUrl = url;
  }
  async rematch() { if (this.status !== 'playing') this.reset(); }
  async leave() {
    cancelAnimationFrame(this.raf);
    this.onLeave();
  }

  // One fixed 20 Hz step, exactly like a server tick. Public so tests can drive it.
  tick(dt = DT): void {
    if (this.status !== 'playing') return;
    this.runBot();
    const res = step(this.s, dt);
    for (const id of res.deadUnitIds) {
      this.unitTroop.delete(id);
      this.glide.drop(BigInt(id));
    }
    for (const u of this.s.units) this.glide.moved(BigInt(u.id), u.x, u.y);
    this.locks = this.locks.filter(l => this.s.time - l.at <= PENDING_TTL);
    if (res.over) {
      this.status = 'done';
      this.winner = res.winner;
    }
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    // Cap the catch-up so a backgrounded tab pauses the match instead of fast-forwarding it.
    if (this.last) this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    for (; this.acc >= DT; this.acc -= DT) this.tick();
  };

  private reset() {
    this.s = newMatch();
    this.s.time = -COUNTDOWN;
    this.locks = [];
    this.troopRows.clear();
    this.unitTroop.clear();
    this.mem = newBotMemory();
    this.botMove = null;
    this.status = 'playing';
    this.winner = null;
  }

  // The bot goes through the same lock → deploy path as you, so its drop is telegraphed.
  private runBot() {
    if (this.s.time < 0) return;
    const cfg = BOT_LEVELS[this.level];
    if (this.botMove) {
      if (this.s.time < this.botMove.at) return;
      const { nonce, move } = this.botMove;
      this.botMove = null;
      const a = ANCHORS[move.anchor];
      try {
        const url = readySprite(a.description);
        this.deploy(BOT, nonce, move.x, move.y, a.description, a, url);
        if (!url) spriteFor(a.description).then(u => { if (u) this.attachSprite(a.description, u); });
      } catch {
        this.unlock(BOT, nonce);
      }
      return;
    }
    const move = botDecide(this.s, BOT, this.mem, cfg, this.rand);
    if (!move) return;
    const nonce = this.nextId++;
    this.lock(BOT, nonce, move.x, move.y);
    this.botMove = { nonce, move, at: this.s.time + cfg.designTime };
  }

  // ---------- the server's begin_deploy / deploy_troop / cancel_deploy, in memory ----------

  private mustPlay() {
    if (this.status !== 'playing') throw new Error('match not running');
    if (this.s.time < 0) throw new Error('match starting');
  }

  private lock(side: Side, nonce: number, x: number, y: number) {
    this.mustPlay();
    if (!canDeploy(side, x, y, this.s.towers)) throw new Error('deploy on your own half');
    if (this.findLock(side, nonce)) return;
    const [cx, cy] = clampDeploy(side, x, y, this.s.towers);
    this.locks.push({ side, nonce, x: cx, y: cy, at: this.s.time });
  }

  private unlock(side: Side, nonce: number) {
    this.locks = this.locks.filter(l => !(l.side === side && l.nonce === nonce));
  }

  private findLock(side: Side, nonce: number) {
    return this.locks.find(l => l.side === side && l.nonce === nonce);
  }

  private deploy(side: Side, nonce: number, x: number, y: number, description: string, raw: TroopDesign, spriteUrl: string) {
    this.mustPlay();
    const { design, cost, error } = priceDeploy(raw, this.s.elixir[side]);
    if (error) throw new Error(error);
    const l = this.findLock(side, nonce);
    let delay = arrivalDelay(0);
    if (l) {
      x = l.x; y = l.y;
      delay = arrivalDelay(this.s.time - l.at);
      this.unlock(side, nonce);
    } else if (!canDeploy(side, x, y, this.s.towers)) {
      throw new Error('deploy on your own half');
    }
    const troopId = BigInt(this.nextId++);
    this.troopRows.set(troopId, { name: design.name, cost, spriteUrl: spriteUrl.slice(0, 2048), description });
    for (const [ux, uy] of unitSpots(side, x, y, design.count, this.s.towers)) {
      const id = this.nextId++;
      this.unitTroop.set(id, troopId);
      this.s.units.push({
        id, side, x: ux, y: uy, hp: design.health, maxHp: design.health, damage: design.damage,
        attackSpeed: design.attack_speed, moveSpeed: design.move_speed, range: design.range,
        cooldown: 0, delay, attackSeq: 0,
      });
    }
    this.s.elixir[side] -= cost;
  }
}
