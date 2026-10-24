// Game feel: watches each frame's View, diffs it against the last one by id (hp, attackSeq,
// delay, which units exist) and turns the differences into short-lived effects and sounds.
// Pure client-side decoration; nothing here feeds back into the game.
import { COUNTDOWN, DOUBLE_ELIXIR_AT, MATCH_SECONDS, TIEBREAK_AT, TOWER_RADIUS, UNIT_RADIUS } from '../../shared/arena';
import type { DrawQuirks, DrawTower, DrawUnit, View } from './render';
import { sfx, soundKind, type SoundKind } from './sfx';
import { anticipation, elementColors, hitInterval, inPose } from './tokens';

const MAX_PARTICLES = 320;
const MAX_RINGS = 48;
const MAX_SHOTS = 96;
const MAX_FLOATERS = 20;
const MAX_TRAILS = 48;

const COLORS = {
  mine: '#4aa3ff',
  theirs: '#ff5d6c',
  mineLight: '#a8d4ff',
  theirsLight: '#ffb0b8',
  tower: '#ffd27a',
  elixir: '#ff8a3d', // embers amber (proposal)
  dust: '#9aa3c2',
};

interface UTrack {
  side: number;
  x: number;
  y: number;
  hp: number;
  seq: number;
  delay: number;
  range: number;
  seen: number;
  seed: number;
  landedAt: number; // -1 while still dropping
  flashAt: number;
  hitAt: number; // when attackSeq last bumped, -1 before the first hit
  interval: number; // expected seconds between hits, 0 until known
  tdx: number; // world-space unit vector toward the last target
  tdy: number;
  ranged: boolean;
  phase: number; // walk cycle, advances with distance walked
  moving: number; // 0..1, smoothed
  kind: SoundKind; // which family of the sound pack it plays
  vx: number; // smoothed world velocity, tiles/s (for lean)
  vy: number;
  motion: string;
  element: string;
  windup: boolean;
  windupFrac: number; // 0..1 from the sim's windupT, -1 when the feed doesn't carry it
  trait: string;
  stunT: number; // last seen, to catch a new stun
  burnAcc: number; // particle emission accumulators (particles owed this frame)
  dustAcc: number;
}

interface TTrack { side: number; x: number; y: number; hp: number; seq: number; seen: number; flashAt: number; downAt: number }

export interface Particle {
  x: number; y: number; z: number; // world tiles; z is height above the ground
  vx: number; vy: number; vz: number;
  t0: number; life: number; size: number; color: string;
  kind: 0 | 1 | 2; // 0 puff, 1 chunk (falls), 2 spark
  spin: number;
}
export interface Ring { x: number; y: number; t0: number; dur: number; r0: number; r1: number; color: string; width: number }
export interface Shot {
  fx: number; fy: number; tid: bigint | null; tx: number; ty: number; t0: number; dur: number; color: string; width: number;
  arc: number; // lob height in tiles (0 for the default flat-ish shot); lobs draw a ground shadow
  orb: boolean; // cast: a big glowing head
  splash: number; // ring radius in tiles at impact, 0 for none
}
export interface Floater { x: number; y: number; t0: number; amt: number; color: string; key: unknown; size: number }
// Attack trails, all in world tiles. swipe: a slash arc around (x, y) facing ang; cone: a breath
// wedge out to len; line: a thrust or dash streak to (x2, y2); bolt: a jagged chain through pts.
export interface Trail {
  kind: 'swipe' | 'cone' | 'line' | 'bolt';
  x: number; y: number; x2: number; y2: number; ang: number; len: number; dir: number;
  pts: number[] | null; t0: number; dur: number; color: string; width: number;
}

export interface FxLive { now: number; particles: Particle[]; rings: Ring[]; shots: Shot[]; trails: Trail[]; floaters: Floater[] }

// Per-unit body animation: offsets in the units of the radius passed to anim() (pov.ts passes
// tiles), angles in radians. glow is 0..1 (cast charge, windup), smear 0..1 with (smx, smy) the
// screen direction ghosts trail toward.
export interface UnitAnim {
  dx: number; dy: number; sx: number; sy: number; flash: number; rot: number;
  up: number; // the vertical part of dy, as a lift (positive is up): the 3D view separates the two
  glow: number; glowColor: string; smear: number; smx: number; smy: number;
}

export const quirks = (u: DrawUnit): DrawQuirks => u as DrawQuirks;

export const towerKey = (tw: DrawTower, i: number): unknown => tw.id ?? i;

const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
};

export class Fx {
  private now = 0;
  private frame = 0;
  private mySide = 0;
  private units = new Map<bigint, UTrack>();
  private towers = new Map<unknown, TTrack>();
  private particles: Particle[] = [];
  private pool: Particle[] = [];
  private rings: Ring[] = [];
  private shots: Shot[] = [];
  private floaters: Floater[] = [];
  private trails: Trail[] = [];
  private shakeUntil = 0;
  private shakeAmp = 0;
  private shakeDur = 0.45;
  private dt = 0;
  private status: string | undefined;
  private prevTime = -1;
  private countdownAt = -10;
  private countStep = -1;
  private banner = { at: -10, title: '', sub: '' }; // DOUBLE EMBERS, OVERTIME, TIEBREAKER
  private pendingCount = [0, 0];
  private reduced = reducedMotion();
  private out: UnitAnim = { dx: 0, dy: 0, sx: 1, sy: 1, flash: 0, rot: 0, up: 0, glow: 0, glowColor: '#fff', smear: 0, smx: 0, smy: 0 };

  constructor() {
    try {
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => (this.reduced = reducedMotion()));
    } catch { /* old browsers */ }
  }

  // ---------- observing ----------

  observe(v: View, now: number): void {
    const dt = Math.min(0.05, Math.max(0, now - this.now));
    this.now = now;
    this.dt = dt;
    this.frame++;
    this.mySide = v.mySide;
    // Without a status (e.g. a feed that doesn't set it) treat the board as live.
    const live = v.status === undefined || v.status === 'playing';

    this.observeMatch(v, now);
    this.observeUnits(v, now, live);
    this.observeTowers(v, now, live);

    const counts = [0, 0];
    for (const p of v.pendings) counts[p.side === 1 ? 1 : 0]++;
    if (live) {
      const me = v.mySide, them = 1 - v.mySide;
      if (counts[me] > this.pendingCount[me]) sfx.play('deploy');
      if (counts[them] > this.pendingCount[them]) sfx.play('incoming');
    }
    this.pendingCount = counts;

    this.step(dt);
  }

  private observeMatch(v: View, now: number): void {
    const time = v.time ?? -99;
    if (v.status !== this.status) {
      // Matches start at time −COUNTDOWN, so "FIGHT!" lands as deploys open at 0.
      if (v.status === 'playing' && time >= -COUNTDOWN && time < 0.5) {
        this.countdownAt = now - (time + COUNTDOWN);
        this.countStep = -1;
      }
      if (v.status === 'done' && this.status === 'playing') {
        sfx.play(v.winner === -1 ? 'draw' : v.winner === v.mySide ? 'win' : 'lose');
        this.countdownAt = -10;
      }
      this.status = v.status;
    } else if (v.status === 'playing' && this.prevTime < -COUNTDOWN && time >= -COUNTDOWN && time < 0.5) {
      // New matches open on the versus card; the countdown starts as the clock passes −COUNTDOWN.
      this.countdownAt = now - (time + COUNTDOWN);
      this.countStep = -1;
    }
    // 3, 2, 1, FIGHT!
    const step = Math.floor((now - this.countdownAt) / COUNT_STEP);
    if (step >= 0 && step <= 3 && step !== this.countStep) {
      this.countStep = step;
      sfx.play(step === 3 ? 'fight' : 'count');
    }
    const crossed = (at: number) => v.status === 'playing' && this.prevTime >= 0 && this.prevTime < at && time >= at;
    if (crossed(DOUBLE_ELIXIR_AT)) {
      this.banner = { at: now, title: 'DOUBLE EMBERS', sub: 'the fire roars' };
      sfx.play('double');
    }
    if (crossed(MATCH_SECONDS)) {
      this.banner = { at: now, title: 'OVERTIME', sub: 'next tower down wins · triple embers' };
      sfx.play('overtime');
    }
    if (crossed(TIEBREAK_AT)) {
      this.banner = { at: now, title: 'TIEBREAKER', sub: 'all towers lose health · first to fall loses' };
      sfx.play('fight');
    }
    if (crossed(MATCH_SECONDS - 10) || crossed(TIEBREAK_AT - 10)) sfx.play('lastTen');
    sfx.setMusic(v.status === 'playing' ? (time >= DOUBLE_ELIXIR_AT ? 'overtime' : 'battle') : 'menu');
    this.prevTime = v.status === 'playing' ? time : -1;
  }

  private observeUnits(v: View, now: number, live: boolean): void {
    for (const u of v.units) {
      let t = this.units.get(u.id);
      if (!t) {
        t = {
          side: u.side, x: u.x, y: u.y, hp: u.hp, seq: u.attackSeq ?? 0, delay: u.delay, range: u.range ?? 1,
          seen: this.frame, seed: Number(u.id % 997n), landedAt: u.delay > 0 ? -1 : now - 10, flashAt: -10,
          hitAt: -1, interval: 0, tdx: 0, tdy: u.side === 0 ? 1 : -1, ranged: (u.range ?? 1) > 1, phase: 0, moving: 0,
          vx: 0, vy: 0, motion: 'other', element: 'none', windup: false, windupFrac: -1,
          trait: quirks(u).trait ?? 'none', stunT: quirks(u).stunT ?? 0, burnAcc: 0, dustAcc: 0,
          kind: this.kindOf(u, v),
        };
        // A unit that pops up on the ground next to a friendly spawner is its minion.
        if (live && u.delay <= 0.3 && this.frame > 1 && this.nearSpawner(t)) this.spawnPuff(t, now);
        this.units.set(u.id, t);
        continue;
      }
      const q = quirks(u);
      t.motion = q.motion ?? 'other';
      t.element = q.element ?? 'none';
      t.windup = !!q.windup;
      t.windupFrac = q.windupT !== undefined ? Math.min(1, Math.max(0, q.windupT / 0.8)) : -1;
      t.trait = q.trait ?? 'none';
      if (live) {
        if (t.delay > 0 && u.delay <= 0) this.land(t, now);
        if (u.hp < t.hp - 0.01) this.hurt(u.id, t, t.hp - u.hp, u.side === v.mySide, now);
        if (u.attackSeq !== undefined && u.attackSeq > t.seq && u.delay <= 0) sfx.play('attack', t.kind);
        if (u.attackSeq !== undefined && u.attackSeq > t.seq && u.delay <= 0) this.attack(t, u, v, now);
        if (u.delay <= 0) this.statusFx(t, q, now);
      }
      t.stunT = q.stunT ?? 0;
      const d = Math.hypot(u.x - t.x, u.y - t.y);
      t.phase += d * 5.5;
      const target = d > 0.0015 ? 1 : 0;
      t.moving += (target - t.moving) * 0.2;
      if (this.dt > 0) {
        t.vx += ((u.x - t.x) / this.dt - t.vx) * 0.15;
        t.vy += ((u.y - t.y) / this.dt - t.vy) * 0.15;
      }
      t.x = u.x; t.y = u.y; t.hp = u.hp; t.delay = u.delay;
      if (u.attackSeq !== undefined) t.seq = u.attackSeq;
      if (u.range !== undefined) { t.range = u.range; t.ranged = u.range > 1 }
      t.seen = this.frame;
    }
    for (const [id, t] of this.units) {
      if (t.seen === this.frame) continue;
      if (live && t.delay <= 0) {
        this.poof(t);
        if (t.trait === 'death_burst') this.burst(t);
      }
      this.units.delete(id);
    }
  }

  private observeTowers(v: View, now: number, live: boolean): void {
    v.towers.forEach((tw, i) => {
      const key = towerKey(tw, i);
      let t = this.towers.get(key);
      if (!t) {
        t = { side: tw.side, x: tw.x, y: tw.y, hp: tw.hp, seq: tw.attackSeq ?? 0, seen: this.frame, flashAt: -10, downAt: tw.hp > 0 ? -1 : now - 10 };
        this.towers.set(key, t);
        return;
      }
      if (live) {
        if (tw.hp < t.hp - 0.01) {
          t.flashAt = now;
          this.floater(key, tw.x, tw.y, t.hp - tw.hp, COLORS.tower, 12);
          sfx.play('towerHit');
          if (tw.hp <= 0 && t.hp > 0) this.crumble(t, now);
        }
        if (tw.attackSeq !== undefined && tw.attackSeq > t.seq && tw.hp > 0) {
          const target = this.nearestUnit(v.units, tw.x, tw.y, tw.side);
          if (target) this.shot(tw.x, tw.y, target.id, target.x, target.y, COLORS.tower, 3, now, TOWER_RADIUS * 0.6);
        }
      }
      if (tw.hp > 0) t.downAt = -1;
      t.hp = tw.hp;
      if (tw.attackSeq !== undefined) t.seq = tw.attackSeq;
      t.x = tw.x; t.y = tw.y;
      t.seen = this.frame;
    });
    for (const [k, t] of this.towers) if (t.seen !== this.frame) this.towers.delete(k);
  }

  // A unit's sound family, from its troop's words and stats; swarms are told apart by how many
  // units the troop has on the board.
  private kindOf(u: DrawUnit, v: View): SoundKind {
    const troop = v.troops.get(u.troopId);
    let n = 0;
    for (const o of v.units) if (o.troopId === u.troopId) n++;
    return soundKind(`${troop?.name ?? ''} ${troop?.description ?? ''}`, u.range ?? 1, u.maxHp, n);
  }

  // ---------- spawning effects ----------

  private land(t: UTrack, now: number): void {
    t.landedAt = now;
    const color = t.side === this.mySide ? COLORS.mine : COLORS.theirs;
    this.ring(t.x, t.y, 0.25, 1.5, 0.42, color, 3);
    const n = this.reduced ? 3 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const s = 1.2 + Math.random() * 1.2;
      this.particle(t.x + Math.cos(a) * 0.3, t.y + Math.sin(a) * 0.3, 0.05, Math.cos(a) * s, Math.sin(a) * s, 0.3, 0.45, 0.22, COLORS.dust, 0);
    }
    sfx.play('land', t.kind);
  }

  private hurt(id: bigint, t: UTrack, amt: number, mine: boolean, now: number): void {
    t.flashAt = now;
    this.floater(id, t.x, t.y, amt, mine ? COLORS.theirsLight : '#ffffff', 9);
    sfx.play('hit', t.kind);
  }

  // A hit landed (attackSeq bumped): the strike half of the motion, plus the quirk visuals.
  private attack(t: UTrack, u: DrawUnit, v: View, now: number): void {
    const q = quirks(u);
    let tx: number, ty: number, tid: bigint | null = null;
    if (q.lastTargetX !== undefined && q.lastTargetY !== undefined && (q.lastTargetX !== 0 || q.lastTargetY !== 0)) {
      tx = q.lastTargetX; ty = q.lastTargetY;
      tid = this.nearestUnit(v.units, tx, ty, u.side, 0.75)?.id ?? null;
    } else {
      const g = this.nearestTarget(u, v);
      if (!g) return;
      tx = g.x; ty = g.y; tid = g.id;
    }
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.hypot(dx, dy) || 1;
    t.tdx = dx / d; t.tdy = dy / d;
    t.interval = hitInterval(t.interval, t.hitAt >= 0 ? now - t.hitAt : 0, q.attackSpeed, (q.slowT ?? 0) > 0);
    t.hitAt = now;

    const mine = u.side === this.mySide;
    const el = elementColors(t.element);
    const main = el?.[0] ?? (mine ? COLORS.mine : COLORS.theirs);
    const light = el?.[1] ?? (mine ? COLORS.mineLight : COLORS.theirsLight);
    const attack = q.attack ?? 'single';
    const splash = attack === 'splash' ? 1 : 0;
    const ang = Math.atan2(dy, dx);
    const n = this.reduced ? 0.5 : 1;
    let shot: Shot | null = null;

    switch (t.motion) {
      case 'slash':
        this.trail('swipe', u.x, u.y, 0, 0, ang, Math.min(1.1, Math.max(0.7, d * 0.8)), this.screenDir(t.tdx, t.tdy)[0] >= 0 ? 1 : -1, null, 0.24, light, 5);
        sfx.play('whoosh');
        break;
      case 'smash':
        this.ring(tx, ty, 0.2, 1, 0.3, light, 3);
        for (let i = 0; i < 6 * n; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.random() * 0.6, s = 1.5 + Math.random();
          this.particle(tx, ty, 0.05, Math.cos(a) * s, Math.sin(a) * s, 0.3, 0.4, 0.2, el ? main : COLORS.dust, 0);
        }
        if (!this.reduced) this.kick(3, 0.16);
        sfx.play('slam');
        break;
      case 'stab':
        this.trail('line', u.x + t.tdx * 0.3, u.y + t.tdy * 0.3, u.x + t.tdx * Math.min(d, 1.4), u.y + t.tdy * Math.min(d, 1.4), 0, 0, 0, null, 0.14, light, 3);
        break;
      case 'bite':
      case 'charge':
        for (const o of [-0.22, 0, 0.22]) {
          const px = -t.tdy * o, py = t.tdx * o;
          this.trail('line', u.x + px - t.tdx * 0.2, u.y + py - t.tdy * 0.2, u.x + px - t.tdx * 1, u.y + py - t.tdy * 1, 0, 0, 0, null, 0.2, light, 2);
        }
        break;
      case 'breathe':
        for (let i = 0; i < 12 * n; i++) {
          const a = ang + (Math.random() - 0.5) * (Math.PI / 3), s = Math.max(1, Math.min(d, t.range)) / 0.24 * (0.6 + Math.random() * 0.4);
          this.particle(u.x + t.tdx * 0.3, u.y + t.tdy * 0.3, 0.25, Math.cos(a) * s, Math.sin(a) * s, 0, 0.4, 0.1 + Math.random() * 0.06, i % 3 ? main : light, 0);
        }
        sfx.play('whoosh');
        break;
      case 'lob':
        shot = this.shot(u.x, u.y, tid, tx, ty, light, 3, now, UNIT_RADIUS);
        if (shot) { shot.arc = Math.min(2.2, 0.8 + d * 0.25); shot.dur = Math.min(0.6, Math.max(0.3, d / 10)) }
        break;
      case 'cast':
        if (attack !== 'chain') {
          shot = this.shot(u.x, u.y, tid, tx, ty, light, 3, now, UNIT_RADIUS);
          if (shot) shot.orb = true;
        }
        this.particle(u.x, u.y, 0.9, 0, 0, 0.4, 0.3, 0.12, main, 2);
        break;
    }
    // Ranged units whose motion has no projectile of its own still throw something, so the hit
    // reads; breath and chain draw their own reach instead.
    if (!shot && t.ranged && d > 1.2 && attack !== 'breath' && attack !== 'chain' && t.motion !== 'breathe' && t.motion !== 'cast') {
      shot = this.shot(u.x, u.y, tid, tx, ty, light, 2, now, UNIT_RADIUS);
    }

    // Tier 1 quirks.
    if (splash) {
      if (shot) shot.splash = splash;
      else this.ring(tx, ty, 0.2, splash, 0.32, main, 3);
    }
    if (attack === 'breath') this.trail('cone', u.x, u.y, 0, 0, ang, Math.max(1, t.range), 0, null, 0.3, main, 0);
    if (attack === 'chain') {
      const pts: number[] = [];
      if (d > 1.2) this.jag(pts, u.x + t.tdx * 0.3, u.y + t.tdy * 0.3, tx, ty);
      else pts.push(tx, ty);
      const xs = q.chainXs ?? [], ys = q.chainYs ?? [];
      let lx = tx, ly = ty;
      for (let i = 0; i < xs.length && i < ys.length; i++) {
        this.jag(pts, lx, ly, xs[i], ys[i]);
        lx = xs[i]; ly = ys[i];
      }
      if (pts.length >= 4) this.trail('bolt', tx, ty, 0, 0, 0, 0, 0, pts, 0.3, el ? main : '#fff27a', 3);
      sfx.play('zap');
    }
    // A few element sparks where the hit lands (melee now; ranged when the shot arrives).
    if (el && !shot) {
      for (let i = 0; i < 3 * n; i++) {
        const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 1.5;
        this.particle(tx, ty, 0.3, Math.cos(a) * s, Math.sin(a) * s, 1.5, 0.3, 0.05, light, 2);
      }
    }
  }

  // Append a jagged path from (x0, y0) to (x1, y1), skipping the start point if it's already there.
  private jag(pts: number[], x0: number, y0: number, x1: number, y1: number): void {
    if (pts.length === 0) pts.push(x0, y0);
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    for (let i = 1; i < 4; i++) {
      const o = (Math.random() - 0.5) * 0.35;
      pts.push(x0 + (dx * i) / 4 + nx * o, y0 + (dy * i) / 4 + ny * o);
    }
    pts.push(x1, y1);
  }

  // Tier 2/3 status effects that emit while they last: flames while burning, dust behind a
  // charging unit, and a flash with sparks when a stun lands. Rates are per second.
  private statusFx(t: UTrack, q: DrawQuirks, now: number): void {
    const dt = this.dt, n = this.reduced ? 0.4 : 1;
    const z = t.trait === 'flying' ? 0.65 : 0.15;
    if ((q.burnT ?? 0) > 0) {
      t.burnAcc += dt * 14 * n;
      for (; t.burnAcc >= 1; t.burnAcc--) {
        const c = Math.random();
        this.particle(t.x + (Math.random() - 0.5) * 0.45, t.y + (Math.random() - 0.5) * 0.2, z + Math.random() * 0.2,
          (Math.random() - 0.5) * 0.3, 0, 1.6 + Math.random(), 0.4 + Math.random() * 0.2, 0.06 + Math.random() * 0.05,
          c < 0.4 ? '#ff5a1f' : c < 0.8 ? '#ff9a2a' : '#ffe08a', 0);
      }
    } else t.burnAcc = 0;
    if ((q.chargeDist ?? 0) >= 2 && t.moving > 0.3) {
      t.dustAcc += dt * 18 * n;
      const v = Math.hypot(t.vx, t.vy) || 1;
      for (; t.dustAcc >= 1; t.dustAcc--) {
        this.particle(t.x - (t.vx / v) * 0.35 + (Math.random() - 0.5) * 0.3, t.y - (t.vy / v) * 0.35, 0.04,
          -(t.vx / v) * (0.6 + Math.random() * 0.6), -(t.vy / v) * (0.6 + Math.random() * 0.6), 0.4, 0.45, 0.1 + Math.random() * 0.06, COLORS.dust, 0);
      }
    } else t.dustAcc = 0;
    if ((q.stunT ?? 0) > t.stunT + 0.05) {
      t.flashAt = now;
      for (let i = 0; i < 7 * n; i++) {
        const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 1.5;
        this.particle(t.x, t.y, z + 0.3, Math.cos(a) * s, Math.sin(a) * s, 2, 0.35, 0.05, i % 2 ? '#fff27a' : '#ffffff', 2);
      }
      sfx.play('stun');
    }
  }

  private nearSpawner(n: UTrack): boolean {
    for (const t of this.units.values()) {
      if (t.trait === 'spawner' && t.side === n.side && t.delay <= 0 && Math.hypot(t.x - n.x, t.y - n.y) < 1.6) return true;
    }
    return false;
  }

  // A spawner's minion appears: a puff of smoke and a small ring.
  private spawnPuff(t: UTrack, now: number): void {
    t.landedAt = now; // gets the landing squash
    const color = t.side === this.mySide ? COLORS.mineLight : COLORS.theirsLight;
    this.ring(t.x, t.y, 0.15, 0.75, 0.3, color, 2);
    const n = this.reduced ? 3 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5, s = 0.8 + Math.random() * 0.8;
      this.particle(t.x, t.y, 0.15, Math.cos(a) * s, Math.sin(a) * s, 0.5, 0.5, 0.14 + Math.random() * 0.08, i % 2 ? '#d9deef' : color, 0);
    }
    sfx.play('puff');
  }

  // death_burst: the unit explodes on death, out to the 1.5-tile damage radius.
  private burst(t: UTrack): void {
    const el = elementColors(t.element);
    const main = el?.[0] ?? '#ff8a2a', light = el?.[1] ?? '#ffe08a';
    this.ring(t.x, t.y, 0.3, 1.5, 0.4, light, 5);
    this.ring(t.x, t.y, 0.2, 1.2, 0.3, main, 3);
    const n = this.reduced ? 8 : 22;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
      this.particle(t.x, t.y, 0.3, Math.cos(a) * s, Math.sin(a) * s, 1 + Math.random() * 2, 0.4 + Math.random() * 0.3,
        0.12 + Math.random() * 0.12, i % 3 === 0 ? light : main, i % 4 === 0 ? 2 : 0);
    }
    if (!this.reduced) this.kick(5, 0.3);
    sfx.play('boom');
  }

  private kick(amp: number, dur: number): void {
    if (this.shakeUntil - this.now > 0 && this.shakeAmp > amp) return;
    this.shakeUntil = this.now + dur; this.shakeAmp = amp; this.shakeDur = dur;
  }

  private poof(t: UTrack): void {
    const color = t.side === this.mySide ? COLORS.mineLight : COLORS.theirsLight;
    const n = this.reduced ? 4 : 9;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 1.4;
      this.particle(t.x, t.y, 0.2, Math.cos(a) * s, Math.sin(a) * s, 0.6 + Math.random(), 0.5 + Math.random() * 0.25,
        0.16 + Math.random() * 0.12, i % 3 === 0 ? color : '#c9cfe3', 0);
    }
    if (!this.reduced) {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2, s = 2.5 + Math.random() * 2;
        this.particle(t.x, t.y, 0.3, Math.cos(a) * s, Math.sin(a) * s, 2, 0.3, 0.06, color, 2);
      }
    }
    this.ring(t.x, t.y, 0.2, 0.8, 0.25, 'rgba(255,255,255,0.7)', 2);
    sfx.play('death', t.kind);
  }

  private crumble(t: TTrack, now: number): void {
    t.downAt = now;
    const color = t.side === this.mySide ? '#24508a' : '#8a2a36';
    const n = this.reduced ? 10 : 26;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      this.particle(t.x + (Math.random() - 0.5) * 1.4, t.y + (Math.random() - 0.5) * 1.4, 0.6 + Math.random() * 0.8,
        Math.cos(a) * s, Math.sin(a) * s, 2 + Math.random() * 3, 0.8 + Math.random() * 0.5,
        0.16 + Math.random() * 0.2, i % 3 === 0 ? '#5d6278' : color, 1);
    }
    // Ice shards off the frosted walls: bright, quick and small.
    const ice = this.reduced ? 4 : 14;
    for (let i = 0; i < ice; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
      this.particle(t.x + Math.cos(a) * 0.6, t.y + Math.sin(a) * 0.6, 0.3 + Math.random() * 1.2,
        Math.cos(a) * s, Math.sin(a) * s, 3 + Math.random() * 2.5, 0.6 + Math.random() * 0.4,
        0.08 + Math.random() * 0.1, i % 2 ? '#dbe9f4' : '#9cc3e0', 1);
    }
    const m = this.reduced ? 4 : 12;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2, s = 1.5 + Math.random();
      this.particle(t.x, t.y, 0.2, Math.cos(a) * s, Math.sin(a) * s, 0.4, 0.9 + Math.random() * 0.4, 0.35 + Math.random() * 0.25, COLORS.dust, 0);
    }
    this.ring(t.x, t.y, 0.6, 3.2, 0.6, 'rgba(255,220,160,0.8)', 4);
    if (!this.reduced) { this.shakeUntil = now + 0.45; this.shakeAmp = 7; this.shakeDur = 0.45 }
    sfx.play('towerDown');
  }

  // ---------- target guesses (the sim's choice, approximately) ----------

  private nearestTarget(u: DrawUnit, v: View): { x: number; y: number; id: bigint | null } | null {
    const range = u.range ?? 1;
    const aggro = Math.max(5.5, range + 1);
    const e = this.nearestUnit(v.units, u.x, u.y, u.side, aggro);
    if (e) return e;
    let best = Infinity, bx = 0, by = 0, found = false;
    for (const t of v.towers) {
      if (t.side === u.side || t.hp <= 0) continue;
      const d = Math.hypot(t.x - u.x, t.y - u.y);
      if (d < best) { best = d; bx = t.x; by = t.y; found = true }
    }
    return found ? { x: bx, y: by, id: null } : null;
  }

  private nearestUnit(units: DrawUnit[], x: number, y: number, side: number, max = Infinity): { x: number; y: number; id: bigint } | null {
    let best = max, hit: DrawUnit | null = null;
    for (const e of units) {
      if (e.side === side || e.delay > 0 || e.hp <= 0) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < best) { best = d; hit = e }
    }
    return hit ? { x: hit.x, y: hit.y, id: hit.id } : null;
  }

  // ---------- pools ----------

  // Public so juice.ts can add to the same pooled particles and rings.
  particle(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string, kind: 0 | 1 | 2): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    const p = this.pool.pop() ?? ({} as Particle);
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.t0 = this.now; p.life = life; p.size = size; p.color = color; p.kind = kind; p.spin = Math.random() * 6;
    this.particles.push(p);
  }

  ring(x: number, y: number, r0: number, r1: number, dur: number, color: string, width: number): void {
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push({ x, y, t0: this.now, dur, r0, r1, color, width });
  }

  private shot(fx: number, fy: number, tid: bigint | null, tx: number, ty: number, color: string, width: number, now: number, startOffset: number): Shot | null {
    if (this.shots.length >= MAX_SHOTS) return null;
    const d = Math.hypot(tx - fx, ty - fy) || 1;
    // Start at the shooter's edge, not its centre.
    const sx = fx + ((tx - fx) / d) * startOffset, sy = fy + ((ty - fy) / d) * startOffset;
    const s: Shot = { fx: sx, fy: sy, tid, tx, ty, t0: now, dur: Math.min(0.32, Math.max(0.1, d / 24)), color, width, arc: 0, orb: false, splash: 0 };
    this.shots.push(s);
    return s;
  }

  private trail(kind: Trail['kind'], x: number, y: number, x2: number, y2: number, ang: number, len: number, dir: number, pts: number[] | null, dur: number, color: string, width: number): void {
    if (this.trails.length >= MAX_TRAILS) this.trails.shift();
    this.trails.push({ kind, x, y, x2, y2, ang, len, dir, pts, t0: this.now, dur, color, width });
  }

  private floater(key: unknown, x: number, y: number, amt: number, color: string, size: number): void {
    // Merge rapid hits on the same target into one number.
    for (const f of this.floaters) {
      if (f.key === key && this.now - f.t0 < 0.3) { f.amt += amt; f.t0 = this.now - 0.05; return }
    }
    if (this.floaters.length >= MAX_FLOATERS) this.floaters.shift();
    this.floaters.push({ x: x + (Math.random() - 0.5) * 0.4, y, t0: this.now, amt, color, key, size });
  }

  // ---------- simulation of the effects themselves ----------

  private step(dt: number): void {
    const now = this.now;
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (now - p.t0 > p.life) {
        this.pool.push(p);
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const drag = p.kind === 0 ? 3 : 1.2;
      p.vx -= p.vx * drag * dt; p.vy -= p.vy * drag * dt;
      if (p.kind === 0) p.vz -= p.vz * 2 * dt;
      else {
        p.vz -= 9 * dt;
        if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.3; p.vx *= 0.6; p.vy *= 0.6 }
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) if (now - this.rings[i].t0 > this.rings[i].dur) this.rings.splice(i, 1);
    for (let i = this.floaters.length - 1; i >= 0; i--) if (now - this.floaters[i].t0 > 0.8) this.floaters.splice(i, 1);
    for (let i = this.trails.length - 1; i >= 0; i--) if (now - this.trails[i].t0 > this.trails[i].dur) this.trails.splice(i, 1);
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const live = s.tid !== null ? this.units.get(s.tid) : undefined;
      if (live) { s.tx = live.x; s.ty = live.y } // home in on a moving target
      if (now - s.t0 > s.dur) {
        this.ring(s.tx, s.ty, 0.1, 0.45, 0.16, s.color, 2);
        if (s.splash) this.ring(s.tx, s.ty, 0.2, s.splash, 0.32, s.color, 3);
        this.shots.splice(i, 1);
      }
    }
  }

  // ---------- queries for the renderer ----------

  // Per-unit body animation; r is the unit's drawn radius. Reuses one object.
  anim(id: bigint, r: number): UnitAnim {
    const a = this.out;
    a.dx = 0; a.dy = 0; a.sx = 1; a.sy = 1; a.flash = 0; a.rot = 0; a.up = 0; a.glow = 0; a.smear = 0;
    const t = this.units.get(id);
    if (!t) return a;
    const now = this.now;
    const amp = this.reduced ? 0.4 : 1;
    const lift = (h: number) => { a.dy -= h; a.up += h };
    // Landing squash.
    if (t.landedAt >= 0) {
      const p = (now - t.landedAt) / 0.3;
      if (p >= 0 && p < 1) {
        const s = Math.sin(p * Math.PI) * (1 - p) * amp;
        a.sx += 0.4 * s; a.sy -= 0.35 * s;
      }
    }
    // Walking hop, with a little squash at each footfall; idle units breathe.
    if (t.moving > 0.05) {
      const hop = Math.abs(Math.sin(t.phase));
      lift(hop * r * 0.3 * t.moving * amp);
      const c = Math.pow(1 - hop, 4) * t.moving * amp;
      a.sx *= 1 + 0.1 * c; a.sy *= 1 - 0.1 * c;
      // Lean into the walk.
      const [vx] = this.screenDir(t.vx, t.vy);
      a.rot += Math.max(-0.2, Math.min(0.2, vx * 0.1)) * t.moving * amp;
    } else {
      a.sy *= 1 + 0.03 * Math.sin(now * 3 + t.seed);
    }

    const el = elementColors(t.element);
    a.glowColor = el?.[1] ?? '#ffe7a0';
    // Wind-up: the windup quirk shows its 0.8 s charge as a growing glow instead of a pose.
    let pre = 0;
    if (t.windup) {
      a.glow = t.windupFrac >= 0 ? t.windupFrac : anticipation(now, t.hitAt, t.interval, 0.8);
    } else if (t.moving < 0.3) {
      pre = anticipation(now, t.hitAt, t.interval) * amp;
    }
    const sp = t.hitAt >= 0 ? now - t.hitAt : 99; // seconds since the strike
    const [wx, wy] = this.screenDir(t.tdx, t.tdy);
    const sgn = wx >= 0 ? 1 : -1;
    const bump = (dur: number) => (sp < dur ? Math.sin((sp / dur) * Math.PI) * amp : 0);

    switch (t.motion) {
      case 'slash': {
        a.rot -= sgn * 0.45 * pre;
        a.dx -= wx * r * 0.1 * pre; a.dy -= wy * r * 0.1 * pre;
        if (sp < 0.24) {
          const q = sp / 0.24;
          const swing = q < 0.3 ? -0.45 + 0.9 * (q / 0.3) : 0.45 * (1 - (q - 0.3) / 0.7);
          a.rot += sgn * swing * amp;
          const k = bump(0.24) * 0.35;
          a.dx += wx * r * k; a.dy += wy * r * k;
        }
        break;
      }
      case 'smash': {
        lift(r * 0.5 * pre); a.sy *= 1 + 0.22 * pre; a.sx *= 1 - 0.12 * pre;
        if (sp < 0.3) {
          const q = sp / 0.3;
          lift(r * 0.5 * Math.max(0, 1 - q / 0.12) * amp);
          const sq = (q < 0.15 ? q / 0.15 : 1 - (q - 0.15) / 0.85) * amp;
          a.sx *= 1 + 0.35 * sq; a.sy *= 1 - 0.3 * sq;
          a.dx += wx * r * 0.2 * sq; a.dy += wy * r * 0.2 * sq;
        }
        break;
      }
      case 'stab': {
        a.dx -= wx * r * 0.35 * pre; a.dy -= wy * r * 0.35 * pre;
        if (sp < 0.18) {
          const q = sp / 0.18;
          const k = (q < 0.3 ? q / 0.3 : 1 - (q - 0.3) / 0.7) * 0.9 * amp;
          a.dx += wx * r * k; a.dy += wy * r * k;
        }
        break;
      }
      case 'shoot': {
        a.dx -= wx * r * 0.08 * pre; a.dy -= wy * r * 0.08 * pre;
        const k = bump(0.14) * 0.28;
        a.dx -= wx * r * k; a.dy -= wy * r * k;
        break;
      }
      case 'lob': {
        lift(-r * 0.12 * pre); a.sy *= 1 - 0.12 * pre; a.sx *= 1 + 0.06 * pre;
        const k = bump(0.2);
        lift(r * 0.2 * k); a.sy *= 1 + 0.1 * k;
        break;
      }
      case 'cast': {
        lift(r * 0.3 * pre);
        a.glow = Math.max(a.glow, pre);
        if (sp < 0.25) {
          const q = 1 - sp / 0.25;
          a.glow = Math.max(a.glow, q);
          lift(r * 0.3 * q * amp);
        }
        break;
      }
      case 'breathe': {
        a.dx -= wx * r * 0.3 * pre; a.dy -= wy * r * 0.3 * pre;
        lift(r * 0.15 * pre);
        a.sy *= 1 + 0.1 * pre;
        const k = bump(0.35) * 0.25;
        a.dx += wx * r * k; a.dy += wy * r * k;
        break;
      }
      case 'bite':
      case 'charge': {
        a.dx -= wx * r * 0.15 * pre; a.dy -= wy * r * 0.15 * pre;
        const k = bump(0.2);
        a.dx += wx * r * k; a.dy += wy * r * k;
        a.sx *= 1 + 0.12 * k; a.sy *= 1 - 0.08 * k;
        if (k > 0.05 && sp < 0.1) { a.smear = k; a.smx = -wx * r * 0.45; a.smy = -wy * r * 0.45 }
        break;
      }
      default: {
        // Generic lunge (melee) or recoil (ranged); the pose frame carries the look.
        if (t.ranged) {
          a.dx -= wx * r * 0.08 * pre; a.dy -= wy * r * 0.08 * pre;
          const k = bump(0.14) * 0.25;
          a.dx -= wx * r * k; a.dy -= wy * r * k;
        } else {
          a.dx -= wx * r * 0.12 * pre; a.dy -= wy * r * 0.12 * pre;
          const k = bump(0.2) * 0.65;
          a.dx += wx * r * k; a.dy += wy * r * k;
          a.sx *= 1 + 0.12 * k; a.sy *= 1 + 0.12 * k;
        }
      }
    }
    a.flash = Math.max(0, 1 - (now - t.flashAt) / 0.15);
    return a;
  }

  // Show the attack-pose frame now: just before and up to 200 ms after each strike.
  posing(id: bigint): boolean {
    const t = this.units.get(id);
    return !!t && t.delay <= 0 && inPose(this.now, t.hitAt, t.interval);
  }

  // The live effects, for pov.ts to draw in 3D. Read-only; the arrays are the pools themselves,
  // so don't keep them past the frame.
  live(): FxLive {
    const l = this.liveOut;
    l.now = this.now; l.particles = this.particles; l.rings = this.rings; l.shots = this.shots; l.trails = this.trails; l.floaters = this.floaters;
    return l;
  }
  private liveOut = {} as FxLive;

  towerFlash(key: unknown): number {
    const t = this.towers.get(key);
    return t ? Math.max(0, 1 - (this.now - t.flashAt) / 0.15) : 0;
  }

  shake(): [number, number] {
    const left = this.shakeUntil - this.now;
    if (left <= 0) return [0, 0];
    const a = this.shakeAmp * (left / this.shakeDur);
    return [Math.sin(this.now * 83) * a, Math.cos(this.now * 71) * a];
  }

  private screenDir(wx: number, wy: number): [number, number] {
    // As seen from your side of the board (yours at the bottom): side 0 flips y, side 1 flips x.
    return this.mySide === 0 ? [wx, -wy] : [-wx, wy];
  }

  // ---------- drawing ----------

  // Announcements: 3-2-1-FIGHT in the centre (nothing's on the board yet), and DOUBLE EMBERS,
  // OVERTIME and TIEBREAKER as a compact ribbon at the top, mid-match, so the river and bridges stay
  // clear. `top(w)` is the highest y a ribbon w px wide (centred on cx) can sit without covering HUD.
  drawBanners(g: CanvasRenderingContext2D, cx: number, cy: number, width: number, top: (w: number) => number): void {
    const now = this.now;
    const ct = now - this.countdownAt;
    if (ct >= 0 && ct < COUNT_STEP * 3 + 0.8) {
      const step = Math.floor(ct / COUNT_STEP);
      const local = step < 3 ? (ct - step * COUNT_STEP) / COUNT_STEP : (ct - 3 * COUNT_STEP) / 0.8;
      const text = step < 3 ? String(3 - step) : 'FIGHT!';
      const pop = 1 + Math.max(0, 0.35 - local) * 1.6;
      const alpha = local > 0.7 ? (1 - local) / 0.3 : 1;
      const size = Math.min(width * (step < 3 ? 0.3 : 0.2), step < 3 ? 110 : 84) * pop;
      this.bigText(g, text, cx, cy, size, step < 3 ? '#ffffff' : '#ffd27a', alpha);
    }
    const dt = now - this.banner.at;
    if (dt >= 0 && dt < 2.4) {
      const inn = Math.min(1, dt / 0.18), out = dt > 1.9 ? (2.4 - dt) / 0.5 : 1;
      const size = Math.min(width * 0.075, 28);
      g.font = `900 ${Math.round(size)}px 'Cinzel', Georgia, serif`;
      const titleW = g.measureText(this.banner.title).width;
      g.font = `700 ${Math.round(size * 0.46)}px 'Alegreya Sans', system-ui, sans-serif`;
      const w = Math.min(width * 0.94, Math.max(titleW, g.measureText(this.banner.sub).width) + size * 1.8), h = size * 1.9;
      const y = top(w) - (1 - inn) * (h * 0.6); // drops in from just above its spot
      g.globalAlpha = Math.min(inn, out);
      g.fillStyle = 'rgba(34,14,6,0.84)';
      roundRect(g, cx - w / 2, y, w, h, h / 2);
      g.fill();
      g.strokeStyle = COLORS.elixir;
      g.lineWidth = 2;
      g.stroke();
      g.globalAlpha = 1;
      this.bigText(g, this.banner.title, cx, y + size * 0.68, size, '#ffc58a', Math.min(inn, out));
      g.font = `700 ${Math.round(size * 0.46)}px 'Alegreya Sans', system-ui, sans-serif`;
      g.fillStyle = '#e8b892';
      g.globalAlpha = Math.min(inn, out);
      g.fillText(this.banner.sub, cx, y + size * 1.48);
      g.globalAlpha = 1;
    }
  }

  private bigText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, alpha: number): void {
    g.save();
    g.globalAlpha = Math.max(0, alpha);
    g.font = `900 ${Math.round(size)}px 'Cinzel', Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, size * 0.08);
    g.strokeStyle = 'rgba(8,10,20,0.9)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.restore();
  }
}

const COUNT_STEP = COUNTDOWN / 3; // one number per second

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

