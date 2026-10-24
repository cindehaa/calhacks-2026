// Polish on the core loop, layered over Fx: the cost reveal rolling like a slot reel when a troop
// lands, landing impact scaled by the troop's size, the name stamping in when the design arrives,
// a shimmer when late art replaces the token, the opponent's words in a bubble at their drop, a
// coin shattering for a refused troop, hit freeze and slow motion when a tower falls.
//
// Pure client-side decoration, like fx.ts. Freeze and slow motion bend only the clock the effects
// and animations run on (clock()); units still stand where the match says, and nothing here
// reaches step() or the server, so online matches stay in sync.
import { DEPLOY_DELAY } from '../../shared/arena';
import type { Fx } from './fx';
import { spriteImage, type DrawTroop, type View } from './render';
import { sfx } from './sfx';
import { deal, type Deal } from './value';

const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
};

// 0 for a bee, about 0.9 for a stone golem: total health on the board (health × count), on a
// square-root scale so swarms and tanks spread out.
export function impactSize(totalHp: number): number {
  return Math.max(0, Math.min(1, (Math.sqrt(Math.max(0, totalHp)) - 15) / 45));
}

// The cost reel: a run of numbers rolling up to the cost, the gaps between ticks growing.
export const ROLL_TICKS = 9;
export function rollDuration(cost: number): number { return 0.55 + 0.03 * Math.min(10, cost) }
// Which tick the reel is on, t seconds after landing: 0..ROLL_TICKS-1, the last one showing the cost.
export function rollIndex(t: number, cost: number): number {
  if (t <= 0) return 0;
  const k = Math.min(1, t / rollDuration(cost));
  return Math.min(ROLL_TICKS - 1, Math.floor((ROLL_TICKS - 1) * Math.pow(k, 1 / 1.8) + 1e-9));
}
// The number on the reel at tick i: counting up through 0..10 and ending on the cost.
export function rollValue(i: number, cost: number): number {
  const back = ROLL_TICKS - 1 - i;
  return (((cost - back) % 11) + 11) % 11;
}

interface Track {
  side: number;
  x: number; y: number; // centroid of its units
  size: number; // impactSize at landing
  firstSeen: number; // effect clock
  landedAt: number; // -1 while in the air
  minDelay: number;
  seen: number;
  hadArt: boolean;
  artAt: number;
  stampAt: number; // when the name stamped in, -10 if it never did (seen already landed)
  tick: number; // last reel tick played, -1 before
  settledAt: number; // when the reel stopped, -1 before
  deal: Deal;
  cost: number;
}

interface Shard { x: number; y: number; vx: number; vy: number; rot: number; vr: number; a0: number; a1: number }
interface Coin { x: number; y: number; t0: number; cost: string; shards: Shard[] | null }

export interface CostLabel { text: string; fill: string; stroke: string; ink: string; scale: number; glow: string | null }
export interface Stamp { scale: number; alpha: number }
export interface Airborne { side: number; x: number; y: number; frac: number; troopId: bigint }

const DEAL_COLORS: Record<Deal, { fill: string; stroke: string; ink: string; glow: string | null }> = {
  bargain: { fill: 'rgba(78,52,8,0.96)', stroke: '#ffd27a', ink: '#fff1c9', glow: 'rgba(255,190,70,0.9)' },
  fair: { fill: 'rgba(58,24,8,0.94)', stroke: '#ff8a3d', ink: '#ffe2c4', glow: null }, // embers amber
  pricey: { fill: 'rgba(88,14,24,0.96)', stroke: '#ff5d6c', ink: '#ffd0d5', glow: 'rgba(255,70,90,0.7)' },
};
const ROLLING = { fill: 'rgba(30,22,52,0.94)', stroke: '#8e96b3', ink: '#e8ebf5', glow: null };

const HEAVY_UNIT_HIT = 220; // hp lost in one frame that counts as a heavy hit
const HEAVY_TOWER_HIT = 200;
const FREEZE_GAP = 0.35; // s between freezes, so a brawl doesn't stutter
const SLOW_RATE = 0.3;
const SLOW_SECS = 0.5;
const SLOW_EASE = 0.2;
const BUBBLE_FONT = "'Alegreya Sans', system-ui, sans-serif";

export class Juice {
  private troops = new Map<bigint, Track>();
  private unitHp = new Map<bigint, number>();
  private towerHp = new Map<unknown, number>();
  private groups = new Map<bigint, { n: number; sx: number; sy: number; hp: number; minDelay: number; side: number }>();
  private frame = 0;
  private reduced = reducedMotion();
  private mySide = 0;
  // Clocks: real seconds in, effect seconds out (slower during slow motion).
  private lastReal = -1;
  private virt = 0;
  private rate = 1;
  private freezeUntil = 0;
  private lastFreeze = -10;
  private slowAt = -10;
  // Camera shake, in tiles, decaying.
  private shakeAmp = 0;
  private shakeDecay = 4;
  private coins: Coin[] = [];
  private lastFire = 0; // newest deploy flash seen (performance.now ms), for the camera nudge
  private nudgeAt = -10;
  private refusedSeen: string[] = [];
  private air: Airborne[] = [];
  private flagWant: { words: string; at: number } | null = null;

  constructor() {
    try {
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => (this.reduced = reducedMotion()));
    } catch { /* old browsers */ }
  }

  // The player flagged the troop with these words as not what they asked for.
  flag(words: string): void {
    this.flagWant = { words: words.trim().toLowerCase(), at: this.lastReal };
  }

  // ---------- clocks ----------

  // Effect time for this frame. Runs at SLOW_RATE for half a second after a tower falls, easing back.
  clock(real: number): number {
    if (this.lastReal < 0) { this.lastReal = real; this.virt = real }
    const dt = Math.max(0, Math.min(0.1, real - this.lastReal));
    this.lastReal = real;
    const s = real - this.slowAt;
    this.rate = s < 0 || s > SLOW_SECS + SLOW_EASE ? 1 : s < SLOW_SECS ? SLOW_RATE : SLOW_RATE + (1 - SLOW_RATE) * ((s - SLOW_SECS) / SLOW_EASE);
    this.virt += dt * this.rate;
    // Shake decays in real time, so a slow-motion shake still ends.
    this.shakeAmp *= Math.exp(-this.shakeDecay * dt);
    if (this.shakeAmp < 0.002) this.shakeAmp = 0;
    return this.virt;
  }

  get timeRate(): number { return this.rate }

  // A heavy hit holds the frame for a few tens of ms: the renderer skips drawing while true.
  frozen(real: number): boolean { return real < this.freezeUntil }

  // Camera offsets in tiles (x, y) and a roll in radians. Nothing under reduced motion.
  shake(real: number): [number, number, number] {
    if (this.reduced || this.shakeAmp <= 0) return [0, 0, 0];
    const a = this.shakeAmp;
    return [
      a * (Math.sin(real * 61) * 0.6 + Math.sin(real * 97 + 1.3) * 0.4),
      a * (Math.sin(real * 73 + 2.1) * 0.6 + Math.sin(real * 113) * 0.4),
      a * 0.05 * Math.sin(real * 47 + 0.7),
    ];
  }

  // Field of view change in degrees: a small push in while the slow motion runs.
  fovKick(real: number): number {
    if (this.reduced) return 0;
    const s = real - this.slowAt;
    if (s < 0 || s > SLOW_SECS + 0.5) return 0;
    const k = s < 0.12 ? s / 0.12 : Math.max(0, 1 - (s - 0.12) / (SLOW_SECS + 0.38));
    return -5 * k;
  }

  // A small dip of the head toward the board when you fire (flick, click or Space), in radians.
  pitchNudge(real: number): number {
    const s = real - this.nudgeAt;
    if (this.reduced || s < 0 || s > 0.35) return 0;
    return -0.018 * Math.sin((s / 0.35) * Math.PI) * (1 - s / 0.35);
  }

  private kick(amp: number, decay: number): void {
    if (amp > this.shakeAmp) { this.shakeAmp = amp; this.shakeDecay = decay }
  }

  private freeze(real: number, ms: number): void {
    if (real - this.lastFreeze < FREEZE_GAP) return;
    this.lastFreeze = real;
    this.freezeUntil = real + ms / 1000;
  }

  // ---------- observing ----------

  observe(v: View, t: number, real: number, fx: Fx): void {
    this.frame++;
    this.mySide = v.mySide;
    for (const f of v.input?.flashes ?? []) {
      if (f.kind === 'deploy' && f.t > this.lastFire) { this.lastFire = f.t; this.nudgeAt = real }
    }
    const live = v.status === undefined || v.status === 'playing';

    // The troops on the board this frame, by troop: centroid, health, how long until they land.
    const G = this.groups;
    for (const g of G.values()) g.n = 0;
    for (const u of v.units) {
      let g = G.get(u.troopId);
      if (!g) G.set(u.troopId, (g = { n: 0, sx: 0, sy: 0, hp: 0, minDelay: 0, side: u.side }));
      if (g.n === 0) { g.sx = g.sy = g.hp = 0; g.minDelay = Infinity; g.side = u.side }
      g.n++; g.sx += u.x; g.sy += u.y; g.hp += u.maxHp; g.minDelay = Math.min(g.minDelay, u.delay);
    }
    this.air.length = 0;
    for (const [id, g] of G) {
      if (g.n === 0) { G.delete(id); continue }
      const troop = v.troops.get(id);
      const x = g.sx / g.n, y = g.sy / g.n, inAir = g.minDelay > 0;
      let tr = this.troops.get(id);
      if (!tr) {
        tr = {
          side: g.side, x, y, size: impactSize(g.hp), firstSeen: t, landedAt: inAir ? -1 : t - 10, minDelay: g.minDelay, seen: this.frame,
          hadArt: artReady(troop), artAt: -10, stampAt: inAir ? t : -10, tick: inAir ? -1 : ROLL_TICKS, settledAt: inAir ? -1 : t - 10,
          deal: deal(troop?.cost ?? 0, troop?.value), cost: troop?.cost ?? 0,
        };
        this.troops.set(id, tr);
        if (live && inAir) sfx.play('stamp');
      }
      tr.seen = this.frame;
      tr.x = x; tr.y = y; tr.minDelay = g.minDelay;
      if (troop) { tr.cost = troop.cost; tr.deal = deal(troop.cost, troop.value) }
      if (inAir) {
        tr.size = impactSize(g.hp);
        this.air.push({ side: g.side, x, y, frac: Math.max(0, Math.min(1, 1 - g.minDelay / DEPLOY_DELAY)), troopId: id });
      } else if (tr.landedAt < 0) {
        tr.landedAt = t;
        if (live) this.impact(tr, fx);
      }
      // The reel: a tick per number, a chime when it stops on the cost.
      if (tr.landedAt >= 0 && tr.settledAt < 0) {
        const i = rollIndex(t - tr.landedAt, tr.cost);
        if (i > tr.tick) {
          tr.tick = i;
          if (i === ROLL_TICKS - 1) {
            tr.settledAt = t;
            if (live) sfx.play('chime', undefined, tr.deal === 'bargain' ? 1.25 : tr.deal === 'pricey' ? 0.8 : 1);
          } else if (live) sfx.play('tick', undefined, 0.9 + 0.04 * i);
        }
      }
      // Late art: the token swaps for the sprite with a shimmer.
      if (!tr.hadArt && artReady(troop)) {
        tr.hadArt = true;
        if (live && t - tr.firstSeen > 0.15) {
          tr.artAt = t;
          this.sparkle(fx, x, y, g.side);
          sfx.play('shimmer');
        }
      }
    }
    for (const [id, tr] of this.troops) if (tr.seen !== this.frame) this.troops.delete(id);
    // "That's wrong": a ring of gold motes rises off the newest of your troops with those words.
    if (this.flagWant && real - this.flagWant.at < 1) {
      let hit: Track | null = null;
      for (const [id, tr] of this.troops) {
        if (tr.side === v.mySide && v.troops.get(id)?.description?.trim().toLowerCase() === this.flagWant.words) hit = tr;
      }
      if (hit) {
        this.flagWant = null;
        fx.ring(hit.x, hit.y, 0.3, 1.6, 0.6, 'rgba(255,210,122,0.9)', 2);
        const n = this.reduced ? 6 : 16;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          fx.particle(hit.x + Math.cos(a) * 0.5, hit.y + Math.sin(a) * 0.5, 0.4, Math.cos(a) * 0.25, Math.sin(a) * 0.25, 1.6 + Math.random(),
            0.8 + Math.random() * 0.4, 0.05 + Math.random() * 0.03, i % 2 ? '#ffd27a' : '#fff1c9', 2);
        }
      }
    } else this.flagWant = null;

    // Heavy hits freeze the frame for a moment.
    let heavy = 0;
    const seenUnits = this.unitHp;
    for (const u of v.units) {
      const before = seenUnits.get(u.id);
      if (before !== undefined && u.delay <= 0) heavy = Math.max(heavy, before - u.hp >= HEAVY_UNIT_HIT ? before - u.hp : 0);
      seenUnits.set(u.id, u.hp);
    }
    if (seenUnits.size > v.units.length * 2 + 64) {
      const ids = new Set(v.units.map(u => u.id));
      for (const id of seenUnits.keys()) if (!ids.has(id)) seenUnits.delete(id);
    }
    v.towers.forEach((tw, i) => {
      const key = tw.id ?? i;
      const before = this.towerHp.get(key);
      this.towerHp.set(key, tw.hp);
      if (before === undefined || !live) return;
      if (before > 0 && tw.hp <= 0) this.towerFall(tw.x, tw.y, real, fx);
      else if (before - tw.hp >= HEAVY_TOWER_HIT) heavy = Math.max(heavy, before - tw.hp);
    });
    if (live && heavy > 0) this.freeze(real, 40 + Math.min(20, heavy / 30));
  }

  private impact(tr: Track, fx: Fx): void {
    const k = tr.size, mine = tr.side === this.mySide;
    this.kick(0.012 + 0.3 * k * k, 7 - 3 * k);
    fx.ring(tr.x, tr.y, 0.3, 0.9 + 3 * k, 0.32 + 0.3 * k, 'rgba(225,238,255,0.95)', Math.min(3.9, 3 + 2 * k)); // under 4: pov.ts flashes rings of 4+ as explosions
    if (k > 0.25) fx.ring(tr.x, tr.y, 0.2, 0.6 + 2 * k, 0.5 + 0.3 * k, mine ? 'rgba(74,163,255,0.8)' : 'rgba(255,93,108,0.8)', 2);
    const n = Math.round((this.reduced ? 2 : 4) + (this.reduced ? 8 : 22) * k);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, s = (1.4 + Math.random() * 1.6) * (0.7 + k);
      fx.particle(tr.x + Math.cos(a) * 0.25, tr.y + Math.sin(a) * 0.25, 0.05, Math.cos(a) * s, Math.sin(a) * s, 0.4 + Math.random() * (0.6 + k),
        0.45 + Math.random() * 0.35, 0.18 + 0.2 * k + Math.random() * 0.1, i % 3 ? '#e6efff' : '#b9c8e8', 0);
    }
    const chunks = Math.round(10 * k * (this.reduced ? 0.4 : 1));
    for (let i = 0; i < chunks; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2.2;
      fx.particle(tr.x, tr.y, 0.1, Math.cos(a) * s, Math.sin(a) * s, 2.5 + Math.random() * 2.5, 0.7 + Math.random() * 0.3, 0.08 + Math.random() * 0.08, '#f2f6ff', 1);
    }
    sfx.play('thud', undefined, 1.7 - 1.15 * k);
  }

  private sparkle(fx: Fx, x: number, y: number, side: number): void {
    const n = this.reduced ? 5 : 12;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.3 + Math.random() * 0.8;
      fx.particle(x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, 0.3 + Math.random() * 1.2, Math.cos(a) * s, Math.sin(a) * s, 0.8 + Math.random(),
        0.5 + Math.random() * 0.4, 0.05 + Math.random() * 0.04, i % 2 ? '#fff3c4' : side === this.mySide ? '#cfe6ff' : '#ffd0d5', 2);
    }
  }

  private towerFall(x: number, y: number, real: number, fx: Fx): void {
    this.freezeUntil = real + 0.06;
    this.lastFreeze = real;
    this.slowAt = real + 0.06;
    this.kick(0.55, 2.6);
    // More debris on top of Fx's crumble: big stone blocks thrown high, and a snow cloud.
    const n = this.reduced ? 8 : 22;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5;
      fx.particle(x + (Math.random() - 0.5), y + (Math.random() - 0.5), 1 + Math.random() * 2, Math.cos(a) * s, Math.sin(a) * s, 4 + Math.random() * 4,
        1.1 + Math.random() * 0.6, 0.22 + Math.random() * 0.22, i % 2 ? '#3a4060' : '#5d6278', 1);
    }
    for (let i = 0; i < (this.reduced ? 4 : 12); i++) {
      const a = (i / 12) * Math.PI * 2, s = 2 + Math.random() * 1.5;
      fx.particle(x, y, 0.3, Math.cos(a) * s, Math.sin(a) * s, 0.8, 1.2 + Math.random() * 0.5, 0.5 + Math.random() * 0.3, '#dfe8fb', 0);
    }
    fx.ring(x, y, 0.8, 5, 0.9, 'rgba(255,236,190,0.9)', 5);
  }

  // ---------- queries for the renderer ----------

  // The cost pill once the troop has landed: rolling, then settled and tinted. Null while it's
  // still in the air (the renderer shows the drop countdown) or for a troop it hasn't seen.
  costLabel(troopId: bigint, t: number): CostLabel | null {
    const tr = this.troops.get(troopId);
    if (!tr || tr.landedAt < 0) return null;
    const out = this.labelOut;
    if (tr.settledAt < 0) {
      const i = rollIndex(t - tr.landedAt, tr.cost);
      Object.assign(out, ROLLING);
      out.text = String(rollValue(i, tr.cost));
      out.scale = 1.05 + 0.15 * (i / (ROLL_TICKS - 1));
      return out;
    }
    Object.assign(out, DEAL_COLORS[tr.deal]);
    out.text = String(tr.cost);
    const s = t - tr.settledAt;
    out.scale = s < 0.35 ? 1 + 0.55 * Math.exp(-s * 9) * Math.cos(s * 22) : 1;
    if (out.glow && s > 1.6) out.glow = null; // the glow is the reveal; the tint stays
    return out;
  }
  private labelOut: CostLabel = { text: '', fill: '', stroke: '', ink: '', scale: 1, glow: null };

  // The name slamming in when the design arrives: big and faint, down to size, a small bounce.
  stamp(troopId: bigint, t: number): Stamp {
    const out = this.stampOut;
    out.scale = 1; out.alpha = 1;
    const tr = this.troops.get(troopId);
    if (!tr || tr.stampAt < 0 || this.reduced) return out;
    const p = (t - tr.stampAt) / 0.16;
    if (p < 1) { out.scale = 2.6 - 1.6 * p * p; out.alpha = Math.min(1, 0.25 + p) }
    else if (p < 2.5) out.scale = 1 + 0.12 * Math.sin((p - 1) * Math.PI / 1.5) * (1 - (p - 1) / 1.5);
    return out;
  }
  private stampOut: Stamp = { scale: 1, alpha: 1 };

  // Squash and stretch for a unit of this troop: stretched as it drops, a size-scaled squash and
  // wobble on landing. Multiplies Fx's own body animation.
  squash(troopId: bigint, delay: number, t: number): [number, number] {
    const tr = this.troops.get(troopId);
    if (!tr) return ONE;
    const amp = this.reduced ? 0.3 : 1;
    if (delay > 0) {
      if (delay > 0.3) return ONE;
      const s = (1 - delay / 0.3) * 0.22 * amp;
      return this.sq(1 - s * 0.5, 1 + s);
    }
    const p = t - tr.landedAt;
    if (tr.landedAt < 0 || p > 0.6) return ONE;
    const a = (0.12 + 0.35 * tr.size) * amp;
    const w = Math.exp(-p * 7) * Math.cos(p * 24);
    return this.sq(1 + a * w, 1 - a * w);
  }
  private sqOut: [number, number] = [1, 1];
  private sq(x: number, y: number): [number, number] { this.sqOut[0] = x; this.sqOut[1] = y; return this.sqOut }

  // 0..1 brightening when late art lands on the troop.
  shimmer(troopId: bigint, t: number): number {
    const tr = this.troops.get(troopId);
    if (!tr) return 0;
    const p = (t - tr.artAt) / 0.6;
    return p >= 0 && p < 1 ? (1 - p) * (0.6 + 0.4 * Math.sin(p * 30)) : 0;
  }

  // Troops still in the air this frame, with how far through the deploy wait they are.
  airborne(): readonly Airborne[] { return this.air }

  // ---------- 2D overlay: bubbles and coins ----------

  drawOverlay(g: CanvasRenderingContext2D, v: View, project: (x: number, y: number, h: number) => [number, number] | null, t: number, real: number): void {
    this.drawBubbles(g, v, project, t);
    this.drawCoins(g, v, project, real);
  }

  // The opponent's words over their drop: "…" while they're still talking it in, then what they
  // said (the troop's description) from the moment the design lands until shortly after it does.
  private drawBubbles(g: CanvasRenderingContext2D, v: View, project: (x: number, y: number, h: number) => [number, number] | null, t: number): void {
    for (const p of v.pendings) {
      if (p.side === v.mySide) continue;
      const q = project(p.x, p.y, 2.3);
      if (q) this.bubble(g, q[0], q[1], '', Math.min(1, p.age * 4), t);
    }
    for (const [id, tr] of this.troops) {
      if (tr.side === v.mySide) continue;
      const words = v.troops.get(id)?.description?.trim();
      if (!words) continue;
      const since = tr.landedAt < 0 ? 0 : t - tr.landedAt;
      if (since > 2.6) continue;
      const fadeIn = Math.min(1, (t - tr.firstSeen) * 6), fadeOut = since > 2.1 ? 1 - (since - 2.1) / 0.5 : 1;
      const lift = tr.landedAt < 0 ? 5.7 : 4.3; // over the name and the cost pill
      const q = project(tr.x, tr.y, lift);
      if (q) this.bubble(g, q[0], q[1], words, Math.max(0, Math.min(fadeIn, fadeOut)), t);
    }
  }

  private bubble(g: CanvasRenderingContext2D, x: number, y: number, words: string, alpha: number, t: number): void {
    if (alpha <= 0.01) return;
    g.save();
    g.globalAlpha = alpha;
    const size = 14, pad = 9, maxW = 210;
    g.font = `italic 600 ${size}px ${BUBBLE_FONT}`;
    const lines = words ? wrap(g, `“${words}”`, maxW, 2) : [];
    const w = words ? Math.max(...lines.map(l => g.measureText(l).width)) + pad * 2 : 46;
    const h = words ? lines.length * (size + 3) + pad * 1.4 : 24;
    const bx = Math.round(x - w / 2), by = Math.max(6, Math.round(y - h - 10)); // kept on screen for far drops
    y = by + h + 10;
    // Body and tail, cut like the menus' chamfered slabs.
    const c = 6;
    g.beginPath();
    g.moveTo(bx + c, by); g.lineTo(bx + w - c, by); g.lineTo(bx + w, by + c); g.lineTo(bx + w, by + h - c); g.lineTo(bx + w - c, by + h);
    g.lineTo(x + 7, by + h); g.lineTo(x, by + h + 9); g.lineTo(x - 7, by + h);
    g.lineTo(bx + c, by + h); g.lineTo(bx, by + h - c); g.lineTo(bx, by + c); g.closePath();
    g.fillStyle = 'rgba(232,235,245,0.96)';
    g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 8; g.shadowOffsetY = 2;
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = 2;
    g.strokeStyle = '#ff5d6c';
    g.stroke();
    g.fillStyle = '#171b2e';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (words) {
      lines.forEach((l, i) => g.fillText(l, x, by + pad * 0.7 + (size + 3) * (i + 0.5) + 1));
    } else {
      for (let i = 0; i < 3; i++) {
        const k = 0.5 + 0.5 * Math.sin(t * 7 - i * 0.9);
        g.globalAlpha = alpha * (0.35 + 0.65 * k);
        g.beginPath(); g.arc(x - 10 + i * 10, by + h / 2 - k * 2, 3, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }

  // A refused troop: a gold coin with what it would have cost pops up and cracks apart.
  private drawCoins(g: CanvasRenderingContext2D, v: View, project: (x: number, y: number, h: number) => [number, number] | null, real: number): void {
    for (const d of v.drops ?? []) {
      if (d.phase !== 'refused' || d.age > 400) continue;
      const key = `${d.x.toFixed(2)},${d.y.toFixed(2)},${d.text}`;
      if (this.refusedSeen.includes(key)) continue;
      this.refusedSeen.push(key);
      if (this.refusedSeen.length > 12) this.refusedSeen.shift();
      const q = project(d.x, d.y, 2.6);
      const n = /would cost (\d+)/.exec(d.sub)?.[1];
      if (q && n) this.coins.push({ x: q[0], y: q[1], t0: real, cost: n, shards: null });
    }
    const R = 22, BREAK = 0.32;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i], age = real - c.t0;
      if (age > 1.3) { this.coins.splice(i, 1); continue }
      g.save();
      if (age < BREAK) {
        const pop = age < 0.12 ? age / 0.12 : 1;
        const spin = Math.cos(age * 26); // a coin flipping
        g.translate(c.x, c.y - 30 * pop);
        g.scale(Math.max(0.15, Math.abs(spin)) * (0.6 + 0.4 * pop), 0.6 + 0.4 * pop);
        coinFace(g, R, c.cost);
        if (age > BREAK - 0.08) { // cracks spreading just before it breaks
          g.strokeStyle = 'rgba(40,20,0,0.85)'; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(-R * 0.7, -R * 0.3); g.lineTo(-R * 0.1, R * 0.05); g.lineTo(R * 0.25, -R * 0.4); g.moveTo(-R * 0.1, R * 0.05); g.lineTo(R * 0.15, R * 0.75); g.stroke();
        }
      } else {
        if (!c.shards) {
          c.shards = [];
          const n = 7;
          for (let k = 0; k < n; k++) {
            const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, mid = (a0 + a1) / 2, s = 120 + Math.random() * 130;
            c.shards.push({ x: c.x, y: c.y - 30, vx: Math.cos(mid) * s, vy: Math.sin(mid) * s - 160, rot: 0, vr: (Math.random() - 0.5) * 14, a0, a1 });
          }
          sfx.play('shatter');
        }
        const dt = age - BREAK, fade = Math.max(0, 1 - dt / (1.3 - BREAK));
        g.globalAlpha = fade;
        for (const s of c.shards) {
          const sx = s.x + s.vx * dt, sy = s.y + s.vy * dt + 520 * dt * dt;
          g.save();
          g.translate(sx, sy);
          g.rotate(s.vr * dt);
          g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, s.a0, s.a1); g.closePath();
          g.fillStyle = '#e8b54a'; g.fill();
          g.strokeStyle = '#8a5a12'; g.lineWidth = 1.5; g.stroke();
          g.restore();
        }
      }
      g.restore();
    }
  }
}

const ONE: [number, number] = [1, 1];

function artReady(troop: DrawTroop | undefined): boolean {
  return !!troop?.spriteUrl && !!spriteImage(troop.spriteUrl);
}

function coinFace(g: CanvasRenderingContext2D, r: number, text: string): void {
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2);
  g.fillStyle = '#b8862b'; g.fill();
  g.beginPath(); g.arc(0, 0, r * 0.84, 0, Math.PI * 2);
  g.fillStyle = '#ffd27a'; g.fill();
  g.beginPath(); g.arc(0, 0, r * 0.84, Math.PI * 0.15, Math.PI * 1.15); // lit and shadow facet
  g.fillStyle = 'rgba(255,176,46,0.55)'; g.fill();
  g.fillStyle = '#7a1622';
  g.font = `800 ${Math.round(r * 1.05)}px 'Cinzel', Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 0, r * 0.06);
}

// Words into at most `max` lines of width w, the last one cut with an ellipsis.
function wrap(g: CanvasRenderingContext2D, s: string, w: number, max: number): string[] {
  const words = s.split(/\s+/), lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (g.measureText(next).width <= w || !cur) cur = next;
    else { lines.push(cur); cur = word }
  }
  if (cur) lines.push(cur);
  if (lines.length > max) {
    lines.length = max;
    let last = lines[max - 1];
    while (last.length > 1 && g.measureText(last + '…”').width > w) last = last.slice(0, -1);
    lines[max - 1] = last.replace(/[\s”]+$/, '') + '…”';
  }
  return lines;
}
