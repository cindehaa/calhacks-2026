// Logs for improving the designer and the art: what players said, what got generated from it, and
// how it went. Written to private SpacetimeDB tables through the log_* reducers (see the bottom of
// server/src/index.ts); read them with `npm run logs`. Fire and forget: a log never slows or
// breaks a deploy, and calls made before the connection is up wait for it.
import { DEPLOY_DELAY, MIN_DEPLOY_DELAY } from '../../shared/arena';
import type { TroopDesign } from '../../shared/troop';
import type { Designed } from './designer';
import type { Net } from './net';

type Call = (n: Net) => Promise<unknown>;

let net: Net | null = null;
const queue: Call[] = [];
const QUEUE_MAX = 200; // vs Bot works offline; don't hold a whole session in memory

export function attachLogs(n: Net): void {
  net = n;
  for (const f of queue.splice(0)) send(f);
}

function send(f: Call): void {
  if (!net) {
    if (queue.length < QUEUE_MAX) queue.push(f);
    return;
  }
  f(net).catch(e => console.warn('log failed:', e?.message ?? e));
}

export function logUtterance(text: string, nonce = 0): void {
  const at = Date.now();
  send(n => n.conn.reducers.logUtterance({ at, text, nonce }));
}

export function logEvent(kind: string, detail = '', nonce = 0): void {
  const at = Date.now();
  send(n => n.conn.reducers.logEvent({ at, kind, detail, nonce }));
}

// ---------- deploy attempts ----------

export type Input = 'voice' | 'typed' | 'anchor';

// One deploy attempt, filled in as it goes and logged once it has settled: deployed, rejected or
// cancelled, and the art has arrived or failed.
export class Attempt {
  input: Input = 'typed';
  lockedBy: string;
  transcript = '';
  description = '';
  outcome = '';
  readonly lockedAt = Date.now();
  releasedAt = 0;
  designedAt = 0;
  deployedAt = 0;
  spriteAt = 0;
  spriteUrl = '';
  designed: Designed | null = null;
  design: TroopDesign | null = null;
  cost = 0;
  private art: Promise<unknown> = Promise.resolve();
  private done = false;

  constructor(readonly nonce: number, lockedBy: string) {
    this.lockedBy = lockedBy;
  }

  released(description: string, input: Input, transcript = '', lockedBy?: string): void {
    this.releasedAt = Date.now();
    this.description = description;
    this.input = input;
    this.transcript = transcript;
    if (lockedBy) this.lockedBy = lockedBy;
  }

  gotDesign(d: Designed): void {
    this.designedAt = Date.now();
    this.designed = d;
    this.design = d.design;
    this.cost = d.cost;
  }

  waitForArt(art: Promise<string>): void {
    this.art = art.then(url => {
      this.spriteAt = Date.now();
      this.spriteUrl = url;
    });
  }

  // The first outcome wins; later ones (a cancel after a rejected deploy) are ignored.
  settle(outcome: string): void {
    if (this.done) return;
    this.done = true;
    this.outcome = outcome;
    if (outcome === 'deployed') this.deployedAt = Date.now();
    void this.art.then(() => this.log());
  }

  private log(): void {
    const d = this.designed;
    // Troops land DEPLOY_DELAY after the lock, or MIN_DEPLOY_DELAY after a late deploy.
    const landAt = Math.max(this.lockedAt + DEPLOY_DELAY * 1000, this.deployedAt + MIN_DEPLOY_DELAY * 1000);
    const artLateMs = this.deployedAt && this.spriteUrl ? this.spriteAt - landAt : 0;
    const row = {
      nonce: this.nonce,
      input: this.input,
      lockedBy: this.lockedBy,
      transcript: this.transcript,
      description: this.description,
      outcome: this.outcome,
      lockedAt: this.lockedAt,
      releasedAt: this.releasedAt,
      designedAt: this.designedAt,
      deployedAt: this.deployedAt,
      spriteAt: this.spriteUrl ? this.spriteAt : 0,
      artLateMs,
      source: d?.source ?? (this.input === 'anchor' ? 'anchor' : ''),
      model: d?.model ?? '',
      prompt: d?.prompt ?? '',
      early: !!d?.early,
      apiMs: Math.max(0, Math.round(d?.apiMs ?? 0)),
      waitMs: Math.max(0, Math.round(d?.ms ?? 0)),
      error: d?.error ?? '',
      raw: d?.raw ?? '',
      design: this.design ? JSON.stringify(this.design) : '',
      cost: this.cost,
      spriteUrl: this.spriteUrl,
    };
    send(n => n.conn.reducers.logGeneration(row));
  }
}

// ---------- bot rounds (they never touch the server, so the browser reports them) ----------

export interface BotTroopLog {
  troopId: bigint;
  side: number;
  bot: boolean;
  nonce: number;
  description: string;
  name: string;
  design: string;
  cost: number;
  count: number;
  deployedAt: number;
  landsAt: number;
  unitDamage: number;
  towerDamage: number;
  kills: number;
  towersDestroyed: number;
  alive: number;
  diedAt: number;
}

export interface BotRoundLog {
  winner: number;
  towersLost0: number;
  towersLost1: number;
  cappedSecs0: number;
  cappedSecs1: number;
  troops: BotTroopLog[];
}

export function logBotStart(level: string): void {
  send(n => n.conn.reducers.logBotStart({ level }));
}

// reason: 'over' when the round finished, 'left' when the player walked away mid-round.
export function logBotEnd(r: BotRoundLog, reason: 'over' | 'left'): void {
  for (const t of r.troops) send(n => n.conn.reducers.logBotTroop(t));
  const { winner, towersLost0, towersLost1, cappedSecs0, cappedSecs1 } = r;
  send(n => n.conn.reducers.logBotEnd({ winner, towersLost0, towersLost1, cappedSecs0, cappedSecs1, reason }));
}

// ---------- control scheme (A/B) ----------

// Which control scheme this player is on. The server keeps it per player and stamps it on their
// match_log side and on every generation row from then on.
export function logScheme(scheme: string): void {
  send(n => n.conn.reducers.logScheme({ scheme }));
}

// The post-match "Controls felt: 👍 / 👎", and how it was answered (click, dwell, voice).
export function logControlsFeedback(scheme: string, good: boolean, how: string): void {
  logEvent('controls:feedback', `${good ? 'up' : 'down'} ${scheme} ${how}`);
}
