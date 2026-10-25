// "vs Bot": a whole match in this tab, for solo practice and as the demo fallback when the
// network or Maincloud is down. Nothing here touches SpacetimeDB; nobody else can see it.
// It runs the same step() and deploy rules as the server, with you as side 0 and the bot as 1.
import { ANCHORS } from '../../shared/anchors';
import { ELIXIR, MATCH_START, TICK_HZ, TIEBREAK_AT, canDeploy, clampDeploy, onBoard, type ElixirRules, type Side } from '../../shared/arena';
import { BOT_LEVELS, botDecide, newBotMemory, type BotLevel, type BotMemory, type BotMove } from '../../shared/bot';
import { arrivalDelay, priceDeploy, unitSpots } from '../../shared/deploy';
import { newMatch, newSpell, newUnit, step, type SimState } from '../../shared/sim';
import { newTally, tallyStep, type TroopTally } from '../../shared/tally';
import type { TroopDesign } from '../../shared/troop';
import { Glide, quirkView, type MatchSource, type MatchStatus, type MatchTower, type MatchUnit } from './match';
import type { DrawPending, DrawSpell, DrawTroop } from './render';
import type { BotRoundLog, BotTroopLog } from './telemetry';
import { exactCost } from './value';

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
  paused = false; // the pause menu: the clock, the bot and your deploys all wait
  foe = ''; // the opponent's name when it isn't the bot (film.ts)

  protected s!: SimState;
  private locks: Lock[] = [];
  private troopRows = new Map<bigint, DrawTroop>();
  private unitTroop = new Map<number, bigint>();
  private spellLook = new Map<number, Pick<DrawSpell, 'name' | 'cost' | 'element' | 'flavor'>>();
  private nextId = 100; // towers take 1–6
  private mem!: BotMemory;
  private botMove: { nonce: number; move: BotMove; at: number } | null = null; // locked, not yet deployed
  private glide = new Glide();
  private tallies = new Map<bigint, BotTroopLog>(); // what each troop did, for the logs
  private capped: [number, number] = [0, 0]; // seconds each side sat on full elixir
  private acc = 0;
  private last = 0;
  private raf = 0;

  constructor(readonly level: BotLevel = 'normal', private onLeave: () => void = () => {}, autorun = true, private rand = Math.random,
    readonly rules: ElixirRules = ELIXIR) {
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
      return { ...quirkView(u), id, troopId, side: u.side, x, y, hp: u.hp, maxHp: u.maxHp, delay: u.delay, attackSeq: u.attackSeq, range: u.range, damage: u.damage };
    });
  }

  towers(): MatchTower[] { return this.s.towers; }
  troops() { return this.troopRows; }

  spells(): DrawSpell[] {
    return (this.s.spells ?? []).map(s => ({
      ...(this.spellLook.get(s.id) ?? { name: '', cost: 0, element: 'none', flavor: '' }),
      id: BigInt(s.id), side: s.side, x: s.x, y: s.y, effect: s.effect, radius: s.radius, duration: s.duration, delay: s.delay, age: s.age,
    }));
  }

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
  // Nobody else sees this match, so the bot's troops take art the same way yours do.
  async attachSprite(description: string, spriteUrl: string) {
    for (const t of this.troopRows.values()) if (t.description === description && !t.spriteUrl) t.spriteUrl = spriteUrl.slice(0, 2048);
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
    const res = step(this.s, dt, undefined, this.rules);
    // Spawner minions join their spawner's troop, under an id from our own counter.
    for (const { unit, parentId } of res.spawned) {
      unit.id = this.nextId++;
      const troopId = this.unitTroop.get(parentId);
      if (troopId !== undefined) this.unitTroop.set(unit.id, troopId);
    }
    tallyStep(this.tallies as Map<bigint, TroopTally>, res, id => this.unitTroop.get(id), this.s.time);
    if (this.s.time > 0) for (const side of [0, 1] as Side[]) if (this.s.elixir[side] >= this.rules.max) this.capped[side] += dt;
    for (const id of res.doneSpellIds) this.spellLook.delete(id);
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

  // The round so far, for the logs.
  report(): BotRoundLog {
    const lost = (side: Side) => this.s.towers.filter(t => t.side === side && t.hp <= 0).length;
    return {
      winner: this.winner ?? -2,
      towersLost0: lost(0),
      towersLost1: lost(1),
      cappedSecs0: this.capped[0],
      cappedSecs1: this.capped[1],
      troops: [...this.tallies.values()],
    };
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.paused) return void (this.last = now);
    // Cap the catch-up so a backgrounded tab pauses the match instead of fast-forwarding it.
    if (this.last) this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    for (; this.acc >= DT; this.acc -= DT) this.tick();
  };

  private reset() {
    this.s = newMatch(undefined, this.rules);
    this.s.time = MATCH_START;
    this.locks = [];
    this.troopRows.clear();
    this.unitTroop.clear();
    this.spellLook.clear();
    this.tallies.clear();
    this.capped = [0, 0];
    this.mem = newBotMemory();
    this.botMove = null;
    this.status = 'playing';
    this.winner = null;
    this.paused = false;
  }

  // The bot goes through the same lock → deploy path as you, so its drop is telegraphed.
  protected runBot() {
    if (this.s.time < 0 || this.s.time >= TIEBREAK_AT) return;
    const cfg = BOT_LEVELS[this.level];
    if (this.botMove) {
      if (this.s.time < this.botMove.at) return;
      const { nonce, move } = this.botMove;
      this.botMove = null;
      const a = ANCHORS[move.anchor];
      try {
        this.deploy(BOT, nonce, move.x, move.y, a.description, a, '');
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
    if (this.paused) throw new Error('paused');
    if (this.s.time < 0) throw new Error('match starting');
    if (this.s.time >= TIEBREAK_AT) throw new Error('tiebreaker');
  }

  protected lock(side: Side, nonce: number, x: number, y: number) {
    this.mustPlay();
    if (!onBoard(x, y)) throw new Error('off the board');
    if (this.findLock(side, nonce)) return;
    // Past your zone it's a spell spot, kept as aimed; a troop sent there snaps back in deploy().
    const [cx, cy] = canDeploy(side, x, y, this.s.towers) ? clampDeploy(side, x, y, this.s.towers) : [x, y];
    this.locks.push({ side, nonce, x: cx, y: cy, at: this.s.time });
  }

  private unlock(side: Side, nonce: number) {
    this.locks = this.locks.filter(l => !(l.side === side && l.nonce === nonce));
  }

  private findLock(side: Side, nonce: number) {
    return this.locks.find(l => l.side === side && l.nonce === nonce);
  }

  protected deploy(side: Side, nonce: number, x: number, y: number, description: string, raw: TroopDesign, spriteUrl: string) {
    this.mustPlay();
    const { design, cost, error } = priceDeploy(raw, this.s.elixir[side]);
    if (error) throw new Error(error);
    const l = this.findLock(side, nonce);
    const spell = design.kind === 'spell' && design.spell;
    let delay = arrivalDelay(0);
    if (l) {
      [x, y] = spell ? [l.x, l.y] : clampDeploy(side, l.x, l.y, this.s.towers);
      delay = arrivalDelay(this.s.time - l.at);
      this.unlock(side, nonce);
    } else if (spell ? !onBoard(x, y) : !canDeploy(side, x, y, this.s.towers)) {
      throw new Error(spell ? 'off the board' : 'deploy on your own half');
    }
    if (spell) {
      const id = this.nextId++;
      (this.s.spells ??= []).push(newSpell(id, side, x, y, spell, delay));
      this.spellLook.set(id, { name: design.name, cost, element: design.element, flavor: design.flavor });
      this.s.elixir[side] -= cost;
      return;
    }
    const troopId = BigInt(this.nextId++);
    this.troopRows.set(troopId, {
      name: design.name, cost, spriteUrl: spriteUrl.slice(0, 2048), description, flavor: design.flavor, value: exactCost(design),
    });
    this.tallies.set(troopId, {
      troopId, side, bot: side === BOT, nonce, description, name: design.name, design: JSON.stringify(design), cost,
      count: design.count, deployedAt: this.s.time, landsAt: this.s.time + delay, ...newTally(design.count),
    });
    for (const [ux, uy] of unitSpots(side, x, y, design.count, this.s.towers)) {
      const id = this.nextId++;
      this.unitTroop.set(id, troopId);
      this.s.units.push(newUnit(id, side, ux, uy, design, delay));
    }
    this.s.elixir[side] -= cost;
  }
}
