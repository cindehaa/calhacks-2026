// Game feel: watches each frame's View, diffs it against the last one by id (hp, attackSeq,
// delay, which units exist) and turns the differences into short-lived effects and sounds.
// Pure client-side decoration; nothing here feeds back into the game.
import { COUNTDOWN, DOUBLE_ELIXIR_AT, TOWER_RADIUS, UNIT_RADIUS } from '../../shared/arena';
import type { DrawTower, DrawUnit, View } from './render';
import { sfx } from './sfx';

type ToScreen = (x: number, y: number) => [number, number];

const MAX_PARTICLES = 320;
const MAX_RINGS = 48;
const MAX_SHOTS = 96;
const MAX_FLOATERS = 20;

const COLORS = {
  mine: '#4aa3ff',
  theirs: '#ff5d6c',
  mineLight: '#a8d4ff',
  theirsLight: '#ffb0b8',
  tower: '#ffd27a',
  elixir: '#c56cf0',
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
  lungeAt: number;
  ldx: number; // world-space lunge direction (negative magnitude for ranged recoil)
  ldy: number;
  ranged: boolean;
  phase: number; // walk cycle, advances with distance walked
  moving: number; // 0..1, smoothed
}

interface TTrack { side: number; x: number; y: number; hp: number; seq: number; seen: number; flashAt: number; downAt: number }

interface Particle {
  x: number; y: number; z: number; // world tiles; z is height above the ground
  vx: number; vy: number; vz: number;
  t0: number; life: number; size: number; color: string;
  kind: 0 | 1 | 2; // 0 puff, 1 chunk (falls), 2 spark
  spin: number;
}
interface Ring { x: number; y: number; t0: number; dur: number; r0: number; r1: number; color: string; width: number }
interface Shot { fx: number; fy: number; tid: bigint | null; tx: number; ty: number; t0: number; dur: number; color: string; width: number }
interface Floater { x: number; y: number; t0: number; amt: number; color: string; key: unknown; size: number }

export interface UnitAnim { dx: number; dy: number; sx: number; sy: number; flash: number }

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
  private shakeUntil = 0;
  private shakeAmp = 0;
  private status: string | undefined;
  private prevTime = -1;
  private countdownAt = -10;
  private countStep = -1;
  private doubleAt = -10;
  private pendingCount = [0, 0];
  private reduced = reducedMotion();
  private out: UnitAnim = { dx: 0, dy: 0, sx: 1, sy: 1, flash: 0 };

  constructor() {
    try {
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => (this.reduced = reducedMotion()));
    } catch { /* old browsers */ }
  }

  // ---------- observing ----------

  observe(v: View, now: number): void {
    const dt = Math.min(0.05, Math.max(0, now - this.now));
    this.now = now;
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
        sfx.play(v.winner === -1 ? 'lose' : v.winner === v.mySide ? 'win' : 'lose');
        this.countdownAt = -10;
      }
      this.status = v.status;
    }
    // 3, 2, 1, FIGHT!
    const step = Math.floor((now - this.countdownAt) / COUNT_STEP);
    if (step >= 0 && step <= 3 && step !== this.countStep) {
      this.countStep = step;
      sfx.play(step === 3 ? 'fight' : 'count');
    }
    if (v.status === 'playing' && this.prevTime >= 0 && this.prevTime < DOUBLE_ELIXIR_AT && time >= DOUBLE_ELIXIR_AT) {
      this.doubleAt = now;
      sfx.play('double');
    }
    this.prevTime = v.status === 'playing' ? time : -1;
  }

  private observeUnits(v: View, now: number, live: boolean): void {
    for (const u of v.units) {
      let t = this.units.get(u.id);
      if (!t) {
        t = {
          side: u.side, x: u.x, y: u.y, hp: u.hp, seq: u.attackSeq ?? 0, delay: u.delay, range: u.range ?? 1,
          seen: this.frame, seed: Number(u.id % 997n), landedAt: u.delay > 0 ? -1 : now - 10, flashAt: -10,
          lungeAt: -10, ldx: 0, ldy: 0, ranged: (u.range ?? 1) > 1, phase: 0, moving: 0,
        };
        this.units.set(u.id, t);
        continue;
      }
      if (live) {
        if (t.delay > 0 && u.delay <= 0) this.land(t, now);
        if (u.hp < t.hp - 0.01) this.hurt(u.id, t, t.hp - u.hp, u.side === v.mySide, now);
        if (u.attackSeq !== undefined && u.attackSeq > t.seq && u.delay <= 0) this.attack(t, u, v, now);
      }
      const d = Math.hypot(u.x - t.x, u.y - t.y);
      t.phase += d * 5.5;
      const target = d > 0.0015 ? 1 : 0;
      t.moving += (target - t.moving) * 0.2;
      t.x = u.x; t.y = u.y; t.hp = u.hp; t.delay = u.delay;
      if (u.attackSeq !== undefined) t.seq = u.attackSeq;
      if (u.range !== undefined) { t.range = u.range; t.ranged = u.range > 1 }
      t.seen = this.frame;
    }
    for (const [id, t] of this.units) {
      if (t.seen === this.frame) continue;
      if (live && t.delay <= 0) this.poof(t);
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
    sfx.play('land');
  }

  private hurt(id: bigint, t: UTrack, amt: number, mine: boolean, now: number): void {
    t.flashAt = now;
    this.floater(id, t.x, t.y, amt, mine ? COLORS.theirsLight : '#ffffff', 9);
  }

  private attack(t: UTrack, u: DrawUnit, v: View, now: number): void {
    const tgt = this.nearestTarget(u, v);
    if (!tgt) return;
    const dx = tgt.x - u.x, dy = tgt.y - u.y;
    const d = Math.hypot(dx, dy) || 1;
    t.lungeAt = now;
    if (t.ranged) {
      t.ldx = -dx / d; t.ldy = -dy / d; // small recoil
      const color = u.side === this.mySide ? COLORS.mineLight : COLORS.theirsLight;
      this.shot(u.x, u.y, tgt.id, tgt.x, tgt.y, color, 2, now, UNIT_RADIUS);
    } else {
      t.ldx = dx / d; t.ldy = dy / d;
    }
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
    sfx.play('death');
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
    const m = this.reduced ? 4 : 12;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2, s = 1.5 + Math.random();
      this.particle(t.x, t.y, 0.2, Math.cos(a) * s, Math.sin(a) * s, 0.4, 0.9 + Math.random() * 0.4, 0.35 + Math.random() * 0.25, COLORS.dust, 0);
    }
    this.ring(t.x, t.y, 0.6, 3.2, 0.6, 'rgba(255,220,160,0.8)', 4);
    if (!this.reduced) { this.shakeUntil = now + 0.45; this.shakeAmp = 7 }
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

  private particle(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string, kind: 0 | 1 | 2): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    const p = this.pool.pop() ?? ({} as Particle);
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.t0 = this.now; p.life = life; p.size = size; p.color = color; p.kind = kind; p.spin = Math.random() * 6;
    this.particles.push(p);
  }

  private ring(x: number, y: number, r0: number, r1: number, dur: number, color: string, width: number): void {
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push({ x, y, t0: this.now, dur, r0, r1, color, width });
  }

  private shot(fx: number, fy: number, tid: bigint | null, tx: number, ty: number, color: string, width: number, now: number, startOffset: number): void {
    if (this.shots.length >= MAX_SHOTS) return;
    const d = Math.hypot(tx - fx, ty - fy) || 1;
    // Start at the shooter's edge, not its centre.
    const sx = fx + ((tx - fx) / d) * startOffset, sy = fy + ((ty - fy) / d) * startOffset;
    this.shots.push({ fx: sx, fy: sy, tid, tx, ty, t0: now, dur: Math.min(0.32, Math.max(0.1, d / 24)), color, width });
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
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const live = s.tid !== null ? this.units.get(s.tid) : undefined;
      if (live) { s.tx = live.x; s.ty = live.y } // home in on a moving target
      if (now - s.t0 > s.dur) {
        this.ring(s.tx, s.ty, 0.1, 0.45, 0.16, s.color, 2);
        this.shots.splice(i, 1);
      }
    }
  }

  // ---------- queries for the renderer ----------

  // Per-unit body animation in screen pixels; r is the unit's drawn radius. Reuses one object.
  anim(id: bigint, r: number): UnitAnim {
    const a = this.out;
    a.dx = 0; a.dy = 0; a.sx = 1; a.sy = 1; a.flash = 0;
    const t = this.units.get(id);
    if (!t) return a;
    const now = this.now;
    const amp = this.reduced ? 0.4 : 1;
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
      a.dy -= hop * r * 0.3 * t.moving * amp;
      const c = Math.pow(1 - hop, 4) * t.moving * amp;
      a.sx *= 1 + 0.1 * c; a.sy *= 1 - 0.1 * c;
    } else {
      a.sy *= 1 + 0.03 * Math.sin(now * 3 + t.seed);
    }
    // Lunge toward the target (melee) or recoil (ranged).
    const lp = (now - t.lungeAt) / (t.ranged ? 0.14 : 0.2);
    if (lp >= 0 && lp < 1) {
      const k = Math.sin(lp * Math.PI) * (t.ranged ? 0.25 : 0.65) * (this.reduced ? 0.6 : 1);
      const [wx, wy] = this.screenDir(t.ldx, t.ldy);
      a.dx += wx * r * k; a.dy += wy * r * k;
      if (!t.ranged) { a.sx *= 1 + 0.12 * k; a.sy *= 1 + 0.12 * k }
    }
    a.flash = Math.max(0, 1 - (now - t.flashAt) / 0.15);
    return a;
  }

  landedAge(id: bigint): number {
    const t = this.units.get(id);
    return t && t.landedAt >= 0 ? this.now - t.landedAt : -1;
  }

  towerFlash(key: unknown): number {
    const t = this.towers.get(key);
    return t ? Math.max(0, 1 - (this.now - t.flashAt) / 0.15) : 0;
  }

  shake(): [number, number] {
    const left = this.shakeUntil - this.now;
    if (left <= 0) return [0, 0];
    const a = this.shakeAmp * (left / 0.45);
    return [Math.sin(this.now * 83) * a, Math.cos(this.now * 71) * a];
  }

  private screenDir(wx: number, wy: number): [number, number] {
    // Matches Board.toScreen: side 0 flips y, side 1 flips x.
    return this.mySide === 0 ? [wx, -wy] : [-wx, wy];
  }

  // ---------- drawing ----------

  // Under the units: impact rings.
  drawGround(g: CanvasRenderingContext2D, toScreen: ToScreen, T: number): void {
    const now = this.now;
    for (const r of this.rings) {
      const p = (now - r.t0) / r.dur;
      const e = 1 - (1 - p) * (1 - p);
      const [sx, sy] = toScreen(r.x, r.y);
      g.globalAlpha = Math.max(0, 1 - p);
      g.strokeStyle = r.color;
      g.lineWidth = r.width * (1 - p * 0.6);
      g.beginPath();
      g.ellipse(sx, sy, (r.r0 + (r.r1 - r.r0) * e) * T, (r.r0 + (r.r1 - r.r0) * e) * T * 0.8, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  // Over the units: shots, particles, damage numbers.
  drawAir(g: CanvasRenderingContext2D, toScreen: ToScreen, T: number): void {
    const now = this.now;
    g.lineCap = 'round';
    for (const s of this.shots) {
      const p = Math.min(1, (now - s.t0) / s.dur);
      const hx = s.fx + (s.tx - s.fx) * p, hy = s.fy + (s.ty - s.fy) * p;
      const q = Math.max(0, p - 0.3);
      const tx = s.fx + (s.tx - s.fx) * q, ty = s.fy + (s.ty - s.fy) * q;
      const [ax, ay] = toScreen(tx, ty), [bx, by] = toScreen(hx, hy);
      // A little arc so shots read as thrown, not lasers.
      const lift = Math.sin(p * Math.PI) * T * 0.35, liftT = Math.sin(q * Math.PI) * T * 0.35;
      g.strokeStyle = s.color;
      g.globalAlpha = 0.55;
      g.lineWidth = s.width + 2;
      g.beginPath(); g.moveTo(ax, ay - liftT); g.lineTo(bx, by - lift); g.stroke();
      g.globalAlpha = 1;
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(1, s.width - 1);
      g.beginPath(); g.moveTo((ax + bx) / 2, (ay - liftT + by - lift) / 2); g.lineTo(bx, by - lift); g.stroke();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(bx, by - lift, s.width * 0.9 + 0.5, 0, Math.PI * 2); g.fill();
    }
    g.lineCap = 'butt';

    for (const p of this.particles) {
      const age = (now - p.t0) / p.life;
      const [sx, sy] = toScreen(p.x, p.y);
      const y = sy - p.z * T;
      g.fillStyle = p.color;
      if (p.kind === 0) {
        g.globalAlpha = 0.55 * (1 - age);
        g.beginPath();
        g.arc(sx, y, p.size * T * (1 + age * 1.6), 0, Math.PI * 2);
        g.fill();
      } else if (p.kind === 1) {
        g.globalAlpha = age > 0.7 ? (1 - age) / 0.3 : 1;
        const s = p.size * T;
        g.save();
        g.translate(sx, y);
        g.rotate(p.spin + age * 6);
        g.fillRect(-s / 2, -s / 2, s, s);
        g.restore();
      } else {
        g.globalAlpha = 1 - age;
        g.beginPath();
        g.arc(sx, y, Math.max(1, p.size * T), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;

    g.textAlign = 'center';
    g.lineJoin = 'round';
    for (const f of this.floaters) {
      const age = (now - f.t0) / 0.8;
      const rise = (1 - (1 - age) * (1 - age)) * 0.9 * T;
      const [sx, sy] = toScreen(f.x, f.y);
      const pop = age < 0.12 ? 1 + (0.12 - age) * 3 : 1;
      g.globalAlpha = age > 0.6 ? (1 - age) / 0.4 : 1;
      g.font = `800 ${Math.round(f.size * pop)}px system-ui, sans-serif`;
      const text = String(Math.round(f.amt));
      const y = sy - T * 0.55 - rise;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(8,10,20,0.85)';
      g.strokeText(text, sx, y);
      g.fillStyle = f.color;
      g.fillText(text, sx, y);
    }
    g.globalAlpha = 1;
  }

  // Centre-screen announcements: 3-2-1-FIGHT and DOUBLE ELIXIR.
  drawBanners(g: CanvasRenderingContext2D, cx: number, cy: number, width: number): void {
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
    const dt = now - this.doubleAt;
    if (dt >= 0 && dt < 2.4) {
      const inn = Math.min(1, dt / 0.18), out = dt > 1.9 ? (2.4 - dt) / 0.5 : 1;
      const size = Math.min(width * 0.1, 40) * (0.8 + 0.2 * inn);
      g.globalAlpha = Math.min(inn, out);
      const w = Math.min(width * 0.9, size * 9), h = size * 2.2;
      g.fillStyle = 'rgba(20,10,34,0.82)';
      roundRect(g, cx - w / 2, cy - h / 2, w, h, h / 2);
      g.fill();
      g.strokeStyle = COLORS.elixir;
      g.lineWidth = 2;
      g.stroke();
      g.globalAlpha = 1;
      this.bigText(g, 'DOUBLE ELIXIR', cx, cy - size * 0.12, size, '#e7b6ff', Math.min(inn, out));
      g.font = `600 ${Math.round(size * 0.36)}px system-ui, sans-serif`;
      g.fillStyle = '#c9b3d9';
      g.globalAlpha = Math.min(inn, out);
      g.fillText('last 30 seconds', cx, cy + size * 0.62);
      g.globalAlpha = 1;
    }
  }

  private bigText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, alpha: number): void {
    g.save();
    g.globalAlpha = Math.max(0, alpha);
    g.font = `900 ${Math.round(size)}px system-ui, sans-serif`;
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

