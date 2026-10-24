// Canvas drawing. World units are tiles; the board is rotated so your side is at the bottom.
import {
  ARENA_H, ARENA_W, BRIDGE_HALF, BRIDGE_X, DEPLOY_DELAY, KING_LANE, MID_Y, RIVER_HALF, UNIT_RADIUS, deployZones, towerRadius, type Side,
} from '../../shared/arena';
import { keyBackground } from './chroma';
import type { DropView } from './drops';
import { drawInput, type InputView } from './input/draw';
import { Fx, quirks, roundRect, towerKey } from './fx';
import { poseFrame } from './sprites';
import { glyphImage, sizeScale, tinted, troopGlyph } from './tokens';

export interface DrawUnit {
  id: bigint;
  troopId: bigint;
  side: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  delay: number;
  attackSeq?: number; // bumps on every hit; drives lunges and shots
  range?: number; // > 1 shoots projectiles
}
// Troop quirks and look the renderer reads, under SimUnit's names. Optional, so feeds without
// them still draw (motion 'other', element 'none'). Kept off DrawUnit so MatchUnit can carry the
// strict enum types; read them through quirks(u).
export interface DrawQuirks {
  attack?: string; // single | splash | breath | chain
  targets?: string; // any | buildings
  trait?: string; // 'flying' draws higher
  motion?: string;
  element?: string;
  windup?: boolean;
  windupT?: number; // seconds charged toward the current hit, 0..0.8
  attackSpeed?: number; // hits per second, for predicting the next hit
  onHit?: string; // none | burn | slow | stun
  burnT?: number; // status timers, seconds left; > 0 while active
  slowT?: number;
  stunT?: number;
  shield?: number; // shield hp left, of maxShield
  maxShield?: number;
  chargeDist?: number; // tiles moved since the last hit; charged at 2
  lastTargetX?: number; // where the latest hit landed
  lastTargetY?: number;
  chainXs?: number[]; // extra chain hops of the latest hit
  chainYs?: number[];
}
export interface DrawTower { side: number; lane?: number; x: number; y: number; hp: number; maxHp: number; id?: bigint | number; attackSeq?: number }
export interface DrawTroop { name: string; cost: number; spriteUrl: string; description?: string; battleCry?: string; voiceStyle?: string; flavor?: string }
export interface DrawPending { side: number; x: number; y: number; age: number }

export interface View {
  mySide: Side;
  units: DrawUnit[];
  towers: DrawTower[];
  troops: Map<bigint, DrawTroop>;
  pendings: DrawPending[];
  aim: [number, number] | null; // world coords, own half only
  lock: [number, number] | null;
  input?: InputView; // hand cursor, pinch / voice lock and transcript, in screen px
  drops?: DropView[]; // your released drops still waiting on words or stats, world coords
  // Optional match state, for banners and stingers (3-2-1, double elixir, win/lose).
  time?: number; // match seconds elapsed
  status?: string; // 'lobby' | 'playing' | 'done'
  winner?: number; // 0, 1, -1 draw
}

// One name label per troop, placed after all units are drawn. The lead unit (lowest id) carries the pill.
interface Group {
  troopId: bigint;
  side: number;
  n: number;
  sumX: number;
  minY: number;
  maxY: number;
  r: number;
  delay: number;
  leadId: bigint;
  lx: number;
  ly: number;
  lr: number;
  buildings: boolean;
}

const C = {
  bg: '#0d1020',
  myHalf: '#121834',
  theirHalf: '#1a1426',
  pocket: 'rgba(74,163,255,0.10)',
  river: '#14304a',
  riverEdge: '#2a5a82',
  bridge: '#3a3550',
  bridgeEdge: '#5a5478',
  mine: '#4aa3ff',
  theirs: '#ff5d6c',
  text: '#e8ebf5',
  muted: '#8e96b3',
  mineDark: '#1d4a82',
  theirsDark: '#7d2431',
  mineLight: '#cfe6ff',
  theirsLight: '#ffd0d5',
  elixir: '#c56cf0',
};
const FONT = 'system-ui, sans-serif';

export class Board {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tile = 20;
  private ox = 0;
  private oy = 0;
  private mySide: Side = 0;
  readonly fx = new Fx();
  private toScreenFn = (x: number, y: number) => this.toScreen(x, y);
  private order: DrawUnit[] = [];
  private groups = new Map<bigint, Group>();
  private groupPool: Group[] = [];
  private glist: Group[] = [];
  private widths = new Map<string, number>();
  private glyphs = new Map<bigint, { name: string; glyph: string }>();
  private labelBoxes: number[] = []; // x0, y0, x1, y1 per placed pill or name
  private boxOwner: number[] = []; // group index for a pill box, -1 for names

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    addEventListener('resize', () => this.resize());
    const dock = document.getElementById('dock');
    if (dock) new ResizeObserver(() => this.resize()).observe(dock);
    this.resize();
  }

  resize(): void {
    const dpr = devicePixelRatio || 1;
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Leave room for the HUD on top and the dock at the bottom.
    const top = 52, bottom = (document.getElementById('dock')?.offsetHeight ?? 130) + 20;
    this.tile = Math.max(8, Math.min((innerWidth - 32) / ARENA_W, (innerHeight - top - bottom) / ARENA_H));
    this.ox = (innerWidth - ARENA_W * this.tile) / 2;
    this.oy = top;
  }

  // World → screen. Side 0 owns low y, so flip y for them; side 1 is rotated 180°.
  toScreen(x: number, y: number): [number, number] {
    const sx = this.mySide === 0 ? x : ARENA_W - x;
    const sy = this.mySide === 0 ? ARENA_H - y : y;
    return [this.ox + sx * this.tile, this.oy + sy * this.tile];
  }

  toWorld(px: number, py: number): [number, number] {
    const sx = (px - this.ox) / this.tile, sy = (py - this.oy) / this.tile;
    return this.mySide === 0 ? [sx, ARENA_H - sy] : [ARENA_W - sx, sy];
  }

  draw(v: View): void {
    this.mySide = v.mySide;
    const g = this.ctx, T = this.tile;
    this.fx.observe(v, performance.now() / 1000);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, innerWidth, innerHeight);
    const [shx, shy] = this.fx.shake();
    g.save();
    g.translate(shx, shy);

    // Halves, the pockets you've opened, the river and its two bridges.
    const [, myTop] = this.toScreen(0, MID_Y);
    g.fillStyle = C.theirHalf;
    g.fillRect(this.ox, this.oy, ARENA_W * T, myTop - this.oy);
    g.fillStyle = C.myHalf;
    g.fillRect(this.ox, myTop, ARENA_W * T, ARENA_H * T - (myTop - this.oy));
    if (v.status === 'playing') this.drawPockets(v);
    this.drawRiver();

    v.towers.forEach((tw, i) => this.drawTower(tw, tw.side === v.mySide, this.fx.towerFlash(towerKey(tw, i)), sleeping(tw, v.towers)));
    this.fx.drawGround(g, this.toScreenFn, T);

    // Pending locks: where a troop is about to land.
    const now = performance.now() / 1000;
    for (const p of v.pendings) this.drawPending(p, p.side === v.mySide, now);
    for (const d of v.drops ?? []) this.drawDrop(d, now);

    this.drawUnits(v);
    this.fx.drawAir(g, this.toScreenFn, T);
    this.drawLabels(v);

    // Aim cursor and locked spot.
    if (v.lock) this.ring(v.lock, C.mine, 2);
    if (v.aim) this.ring(v.aim, 'rgba(255,255,255,0.5)', 1);
    g.restore();

    const [, midY] = this.toScreen(0, MID_Y);
    this.fx.drawBanners(g, this.ox + (ARENA_W * T) / 2, midY, ARENA_W * T);
    if (v.input) drawInput(g, v.input);
  }

  // Water across the middle; the bridges are the only way over.
  private drawRiver(): void {
    const g = this.ctx, T = this.tile;
    const [, y0] = this.toScreen(0, MID_Y + RIVER_HALF);
    const [, y1] = this.toScreen(0, MID_Y - RIVER_HALF);
    const top = Math.min(y0, y1), h = Math.abs(y1 - y0);
    g.fillStyle = C.river;
    g.fillRect(this.ox, top, ARENA_W * T, h);
    g.fillStyle = C.riverEdge;
    g.fillRect(this.ox, top, ARENA_W * T, 1.5);
    g.fillRect(this.ox, top + h - 1.5, ARENA_W * T, 1.5);
    // A few slow ripples so it reads as water.
    const t = performance.now() / 1000;
    g.save();
    g.beginPath();
    g.rect(this.ox, top, ARENA_W * T, h);
    g.clip();
    g.strokeStyle = 'rgba(120,180,230,0.18)';
    g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const x = this.ox + ((i * 3.1 + t * 0.6) % ARENA_W) * T;
      const y = top + h * (0.3 + 0.4 * ((i * 0.37) % 1));
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + T * 0.9, y);
      g.stroke();
    }
    g.restore();
    for (const bx of BRIDGE_X) {
      const [sx] = this.toScreen(bx, 0);
      const w = BRIDGE_HALF * T;
      g.fillStyle = C.bridge;
      g.fillRect(sx - w, top - T * 0.25, 2 * w, h + T * 0.5);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; // planks
      for (let k = 1; k < 5; k++) {
        const py = top - T * 0.25 + ((h + T * 0.5) * k) / 5;
        g.beginPath();
        g.moveTo(sx - w, py);
        g.lineTo(sx + w, py);
        g.stroke();
      }
      g.fillStyle = C.bridgeEdge; // rails
      g.fillRect(sx - w, top - T * 0.25, 2, h + T * 0.5);
      g.fillRect(sx + w - 2, top - T * 0.25, 2, h + T * 0.5);
    }
  }

  // Taking a princess tower opens that side of their half for your drops.
  private drawPockets(v: View): void {
    const g = this.ctx;
    for (const z of deployZones(v.mySide, v.towers.map(t => ({ side: t.side, lane: t.lane ?? -1, hp: t.hp }))).slice(1)) {
      const [ax, ay] = this.toScreen(z.x0, z.y0);
      const [bx, by] = this.toScreen(z.x1, z.y1);
      const x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.abs(bx - ax), h = Math.abs(by - ay);
      g.fillStyle = C.pocket;
      g.fillRect(x, y, w, h);
      g.save();
      g.setLineDash([6, 5]);
      g.strokeStyle = 'rgba(74,163,255,0.45)';
      g.lineWidth = 1.5;
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      g.restore();
    }
  }

  private drawTower(tw: DrawTower, mine: boolean, flash: number, asleep: boolean): void {
    const g = this.ctx, T = this.tile;
    const [sx, sy] = this.toScreen(tw.x, tw.y);
    const king = tw.lane === KING_LANE;
    const s = towerRadius(tw.lane ?? 0) * T;
    const col = mine ? C.mine : C.theirs;
    if (tw.hp > 0) {
      g.fillStyle = mine ? '#24508a' : '#8a2a36';
      g.fillRect(sx - s, sy - s, 2 * s, 2 * s);
      if (flash > 0) {
        g.fillStyle = `rgba(255,255,255,${(flash * 0.8).toFixed(2)})`;
        g.fillRect(sx - s, sy - s, 2 * s, 2 * s);
      }
      g.strokeStyle = col;
      g.lineWidth = king ? 3 : 2;
      g.strokeRect(sx - s, sy - s, 2 * s, 2 * s);
      g.fillStyle = 'rgba(255,255,255,0.12)'; // a lighter top edge reads as a roof
      g.fillRect(sx - s + 2, sy - s + 2, 2 * s - 4, s * 0.35);
      if (king) this.crown(sx, sy - s * 0.35, s * 0.55, asleep ? 'rgba(232,235,245,0.35)' : '#ffd166');
      if (asleep) {
        g.fillStyle = 'rgba(13,16,32,0.35)';
        g.fillRect(sx - s, sy - s, 2 * s, 2 * s);
        this.label('z z', sx + s * 0.7, sy - s * 0.6, 10, C.muted);
      }
      this.bar(sx - s, sy - s - 7, 2 * s, 4, tw.hp / tw.maxHp, col);
      this.label(String(Math.ceil(tw.hp)), sx, sy + (king ? s * 0.45 : 4), 11, C.text);
    } else {
      // Rubble: a squat dark slab with a dashed outline.
      g.fillStyle = '#23263a';
      g.fillRect(sx - s * 0.8, sy - s * 0.35, s * 1.6, s * 0.7);
      g.fillStyle = '#31354d';
      g.fillRect(sx - s * 0.5, sy - s * 0.55, s * 0.55, s * 0.4);
      g.fillRect(sx + s * 0.1, sy - s * 0.1, s * 0.6, s * 0.35);
      g.save();
      g.setLineDash([3, 3]);
      g.strokeStyle = 'rgba(142,150,179,0.5)';
      g.lineWidth = 1.5;
      g.strokeRect(sx - s, sy - s, 2 * s, 2 * s);
      g.restore();
    }
  }

  // A drop in flight: ground shadow that grows, a converging ring, a countdown. Opponent drops
  // are tagged INCOMING so they can't be missed.
  private drawPending(p: DrawPending, mine: boolean, now: number): void {
    const g = this.ctx, T = this.tile;
    const [sx, sy] = this.toScreen(p.x, p.y);
    const color = mine ? C.mine : C.theirs;
    const frac = Math.max(0, Math.min(1, p.age / DEPLOY_DELAY));
    const left = DEPLOY_DELAY - p.age;
    g.save();
    g.fillStyle = `rgba(0,0,0,${(0.12 + 0.3 * frac).toFixed(2)})`;
    g.beginPath();
    g.ellipse(sx, sy + T * 0.15, T * (0.3 + 0.55 * frac), T * (0.3 + 0.55 * frac) * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    // Converging ring.
    g.globalAlpha = 0.25 + 0.5 * frac;
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(sx, sy, T * (0.9 + 1.5 * (1 - frac)), 0, Math.PI * 2);
    g.stroke();
    // Dashed target ring that slowly turns, plus a progress arc.
    g.globalAlpha = 1;
    g.setLineDash([4, 4]);
    g.lineDashOffset = -now * 14;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(sx, sy, T * 0.9, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(sx, sy, T * 0.9, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    g.stroke();
    g.restore();
    const text = left > 0.05 ? left.toFixed(1) : '…';
    this.outlined(text, sx, sy + 4, 12, mine ? C.text : C.theirsLight);
    if (!mine) this.pill('INCOMING', sx, sy - T * 0.9 - 14, 10, '#7d2431', C.theirs, '#ffffff');
  }

  // Your drop between letting go and the troop appearing: a pulsing silhouette inside the
  // pending ring, the words you said above it, and "designing…" (then the name) over those.
  private drawDrop(d: DropView, now: number): void {
    const g = this.ctx, T = this.tile;
    const [sx, sy] = this.toScreen(d.x, d.y);
    const refused = d.phase === 'refused';
    const fade = refused ? Math.max(0, 1 - d.age / 1400) : 1;
    g.save();
    if (!refused) {
      // Silhouette: head and shoulders, breathing while it waits.
      const pulse = 0.5 + 0.5 * Math.sin(now * 6);
      const k = T * (0.62 + 0.05 * pulse);
      g.globalAlpha = 0.28 + 0.22 * pulse;
      g.fillStyle = C.mineLight;
      g.beginPath();
      g.arc(sx, sy - k * 0.55, k * 0.3, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(sx - k * 0.55, sy + k * 0.5);
      g.quadraticCurveTo(sx - k * 0.55, sy - k * 0.2, sx, sy - k * 0.22);
      g.quadraticCurveTo(sx + k * 0.55, sy - k * 0.2, sx + k * 0.55, sy + k * 0.5);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = fade;
    const top = sy - T * 0.9 - 14;
    this.pill(d.text, sx, top, 11, 'rgba(13,16,32,0.9)', refused ? C.theirs : C.mine, refused ? C.theirsLight : C.text);
    if (d.sub) this.outlined(d.sub, sx, top - 14, 11, refused ? C.theirsLight : d.phase === 'designing' && d.sub !== 'designing…' ? C.mineLight : C.text);
    g.restore();
  }

  private drawUnits(v: View): void {
    const g = this.ctx, T = this.tile, now = performance.now() / 1000;
    const order = this.order;
    order.length = 0;
    for (const u of v.units) order.push(u);
    // Painter's order: farther up the screen first; units still in the air go on top.
    const flip = this.mySide === 0 ? -1 : 1;
    order.sort((a, b) => (a.delay > 0 ? 1e4 : 0) + a.y * flip - ((b.delay > 0 ? 1e4 : 0) + b.y * flip));
    for (const gr of this.groups.values()) this.groupPool.push(gr);
    this.groups.clear();
    const k = Math.min(3, devicePixelRatio || 1);

    for (const u of order) {
      const mine = u.side === v.mySide;
      const troop = v.troops.get(u.troopId);
      const [sx, sy] = this.toScreen(u.x, u.y);
      const r = UNIT_RADIUS * T * sizeScale(u.maxHp);
      const air = u.delay > 0;
      // Hover height and fade: units wait in the air, then drop in the last 0.3 s.
      const lift = air ? T * 1.1 * (u.delay > 0.3 ? 1 : (u.delay / 0.3) ** 2) + (u.delay > 0.3 ? Math.sin(now * 5 + Number(u.id % 7n)) * T * 0.06 : 0) : 0;
      const alpha = air ? (u.delay > 0.3 ? 0.45 : 0.45 + 0.55 * (1 - u.delay / 0.3)) : 1;
      const a = this.fx.anim(u.id, r);
      const team = mine ? C.mine : C.theirs;

      // Flying units hover a body-height up and bob; their shadow stays small and soft on the ground.
      const q = quirks(u);
      const flying = !air && q.trait === 'flying';
      const fly = flying ? r * 1.1 + Math.sin(now * 3 + Number(u.id % 11n)) * r * 0.1 : 0;

      // Ground shadow (stays put while the body hops).
      if (air) {
        // Landing mark: a tinted pad that firms up as the drop nears.
        const k2 = 1 - Math.min(1, u.delay / DEPLOY_DELAY);
        g.fillStyle = mine ? `rgba(74,163,255,${(0.1 + 0.2 * k2).toFixed(2)})` : `rgba(255,93,108,${(0.1 + 0.2 * k2).toFixed(2)})`;
        g.strokeStyle = team;
        g.globalAlpha = 0.35 + 0.5 * k2;
        g.lineWidth = 1.5;
        g.beginPath();
        g.ellipse(sx, sy + r * 0.5, r * (0.8 + 0.5 * k2), r * (0.8 + 0.5 * k2) * 0.5, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.globalAlpha = 1;
      } else if (flying) {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.beginPath();
        g.ellipse(sx, sy + r * 0.72, r * 0.6, r * 0.22, 0, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = 'rgba(0,0,0,0.32)';
        g.beginPath();
        g.ellipse(sx + a.dx * 0.5, sy + r * 0.72, r * 0.95 * (0.9 + 0.1 * a.sx), r * 0.36, 0, 0, Math.PI * 2);
        g.fill();
      }

      const bx = sx + a.dx, by = sy + a.dy - lift - fly;
      // Charge glow (cast, windup) behind the body.
      if (a.glow > 0.02) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = a.glowColor;
        g.globalAlpha = 0.18 * a.glow;
        g.beginPath(); g.arc(bx, by, r * (1.3 + 0.5 * a.glow), 0, Math.PI * 2); g.fill();
        g.globalAlpha = 0.3 * a.glow;
        g.beginPath(); g.arc(bx, by, r * (1.05 + 0.2 * a.glow), 0, Math.PI * 2); g.fill();
        g.restore();
      }
      // Dash smear: two faint ghosts trailing behind.
      if (a.smear > 0) {
        for (let i = 2; i >= 1; i--) this.drawBody(u, troop, mine, bx + a.smx * i, by + a.smy * i, r, a.sx, a.sy, a.rot, alpha * 0.22 * a.smear, 0, k);
      }
      this.drawBody(u, troop, mine, bx, by, r, a.sx, a.sy, a.rot, alpha, a.flash, k);
      if (!air) this.drawStatus(q, bx, by, r, now, Number(u.id % 13n));

      if (!air && u.hp < u.maxHp) this.bar(sx - r, sy - r - 6 + a.dy * 0.5 - fly, 2 * r, 3, u.hp / u.maxHp, team);
      const top = lift + fly;

      // Feed the label pass.
      let gr = this.groups.get(u.troopId);
      if (!gr) {
        gr = this.groupPool.pop() ?? ({} as Group);
        gr.troopId = u.troopId; gr.side = u.side; gr.n = 0; gr.sumX = 0; gr.minY = Infinity; gr.maxY = -Infinity;
        gr.r = 0; gr.delay = u.delay; gr.leadId = u.id; gr.lx = sx; gr.ly = sy - top; gr.lr = r;
        gr.buildings = q.targets === 'buildings';
        this.groups.set(u.troopId, gr);
      }
      gr.n++;
      gr.sumX += sx;
      if (sy - top - r < gr.minY) gr.minY = sy - top - r;
      if (sy - top + r > gr.maxY) gr.maxY = sy - top + r;
      if (r > gr.r) gr.r = r;
      if (u.delay < gr.delay) gr.delay = u.delay;
      if (u.id < gr.leadId) { gr.leadId = u.id; gr.lx = sx; gr.ly = sy - top; gr.lr = r }
    }
  }

  // One unit's body at (x, y): its sprite with a team ring, or the placeholder disc and glyph.
  private drawBody(u: DrawUnit, troop: DrawTroop | undefined, mine: boolean, x: number, y: number, r: number,
    scx: number, scy: number, rot: number, alpha: number, flash: number, k: number): void {
    const g = this.ctx;
    const team = mine ? C.mine : C.theirs;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    if (rot) g.rotate(rot);
    g.scale(scx, scy);
    const base = troop?.spriteUrl ? this.sprite(troop.spriteUrl) : null;
    // Motion layer 2: once the base sprite is in, ask for the attack-pose frame (one request per
    // troop description, cached) and swap it in around each strike.
    const pose = base && troop?.description ? poseFrame(troop.description, troop.flavor ?? '') : null;
    const img = pose && this.fx.posing(u.id) ? pose : base;
    const slowed = (quirks(u).slowT ?? 0) > 0;
    if (img) {
      g.strokeStyle = team;
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(0, r * 0.75, r * 0.95, r * 0.38, 0, 0, Math.PI * 2);
      g.stroke();
      // Fit the longer side to the sprite box, feet on the same line, so a wide pose doesn't stretch.
      const s = r * 2.9;
      const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || 1;
      const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || 1;
      const w = s * iw / Math.max(iw, ih), h = s * ih / Math.max(iw, ih);
      const x0 = -w / 2, y0 = s * 0.38 - h;
      g.drawImage(img, x0, y0, w, h);
      if (slowed) {
        g.globalAlpha = alpha * 0.45;
        g.drawImage(tinted(img, '#4f9dff'), x0, y0, w, h);
        g.globalAlpha = alpha;
      }
      if (flash > 0) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = alpha * flash * 0.9;
        g.drawImage(img, x0, y0, w, h);
      }
    } else {
      g.fillStyle = mine ? C.mineDark : C.theirsDark;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.beginPath();
      g.arc(-r * 0.2, -r * 0.25, r * 0.7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = team;
      g.lineWidth = Math.max(1.5, r * 0.16);
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
      const glyph = this.glyphFor(u.troopId, troop);
      const c = glyphImage(glyph, r * 1.3);
      const w = c.width / k;
      g.drawImage(c, -w / 2, -w / 2, w, w);
      if (slowed) {
        g.globalAlpha = alpha * 0.4;
        g.fillStyle = '#4f9dff';
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = alpha;
      }
      if (flash > 0) {
        g.globalAlpha = alpha * flash * 0.85;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }

  // Status overlays on a landed unit's body at (x, y): the shield ring (its arc is the shield
  // left) and stun stars circling the head. Flames, dust and the heal pulse come from Fx.
  private drawStatus(q: DrawQuirks, x: number, y: number, r: number, now: number, seed: number): void {
    const g = this.ctx;
    const max = q.maxShield ?? 0, sh = q.shield ?? 0;
    if (max > 0 && sh > 0) {
      const R = r * 1.28, frac = Math.min(1, sh / max);
      g.save();
      g.strokeStyle = '#bfe8ff';
      g.lineWidth = 2;
      g.globalAlpha = 0.25;
      g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 0.9;
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.beginPath(); g.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
      g.restore();
    }
    if ((q.stunT ?? 0) > 0) {
      g.save();
      g.fillStyle = '#fff27a';
      const hy = y - r * 1.15;
      for (let i = 0; i < 3; i++) {
        const a = now * 6 + seed + (i / 3) * Math.PI * 2;
        const sx = x + Math.cos(a) * r * 0.7, sy = hy + Math.sin(a) * r * 0.22;
        const s = Math.max(2.5, r * 0.22) * (0.8 + 0.2 * Math.sin(a));
        g.globalAlpha = 0.65 + 0.35 * Math.sin(a);
        g.beginPath(); // four-point sparkle
        g.moveTo(sx, sy - s);
        g.quadraticCurveTo(sx, sy, sx + s, sy);
        g.quadraticCurveTo(sx, sy, sx, sy + s);
        g.quadraticCurveTo(sx, sy, sx - s, sy);
        g.quadraticCurveTo(sx, sy, sx, sy - s);
        g.fill();
      }
      g.restore();
    }
  }

  // Cost pills on each troop's lead unit, and one name per troop that dodges the others.
  private drawLabels(v: View): void {
    const g = this.ctx;
    const boxes = this.labelBoxes;
    boxes.length = 0;
    const left = this.ox + 2, right = this.ox + ARENA_W * this.tile - 2;
    const list = this.glist;
    list.length = 0;
    for (const gr of this.groups.values()) list.push(gr);
    list.sort((a, b) => b.n - a.n || (a.troopId < b.troopId ? -1 : 1));
    const owner = this.boxOwner;
    owner.length = 0;
    // Pass 1: pills, which names then steer around.
    list.forEach((gr, i) => {
      const troop = v.troops.get(gr.troopId);
      if (!troop) return;
      const mine = gr.side === v.mySide;
      const air = gr.delay > 0;
      // Pill: the countdown while it's falling, the cost once it has landed. Cost stays hidden until then.
      const px = gr.lx + gr.lr * 0.8, py = gr.ly + gr.lr * 0.72;
      if (air) this.pill(gr.delay.toFixed(1), px, py, 10, 'rgba(13,16,32,0.9)', mine ? C.mine : C.theirs, C.text);
      else {
        const age = this.fx.landedAge(gr.leadId);
        const pop = age >= 0 && age < 0.25 ? 1 + (0.25 - age) * 2.4 : 1;
        this.pill(String(troop.cost), px, py, 10 * pop, 'rgba(48,16,76,0.94)', C.elixir, '#f3dcff');
      }
      boxes.push(px - 10, py - 8, px + 10, py + 8);
      owner.push(i);
    });
    // Pass 2: one name per troop, biggest swarms first.
    g.font = `600 11px ${FONT}`;
    list.forEach((gr, i) => {
      const troop = v.troops.get(gr.troopId);
      if (!troop) return;
      const mine = gr.side === v.mySide;
      let name = troop.name;
      if (name.length > 16) name = name.slice(0, 15) + '…';
      const icon = gr.buildings ? 12 : 0; // a small tower before the name: it only chases buildings
      const w = this.textWidth(name) + icon;
      const cx = Math.max(left + w / 2, Math.min(right - w / 2, gr.sumX / gr.n));
      const gap = gr.r * 0.2;
      const tries = [gr.maxY + 14 + gap, gr.minY - 9 - gap, gr.maxY + 27 + gap, gr.minY - 22 - gap];
      for (const y of tries) {
        if (this.boxFree(cx - w / 2 - 2, y - 10, cx + w / 2 + 2, y + 3, i)) {
          boxes.push(cx - w / 2 - 2, y - 10, cx + w / 2 + 2, y + 3);
          owner.push(-1);
          this.outlined(name, cx + icon / 2, y, 11, mine ? C.mineLight : C.theirsLight);
          if (icon) this.towerIcon(cx - w / 2 + 4, y - 4, mine ? C.mineLight : C.theirsLight);
          break;
        }
      }
    });
  }

  // Free of every placed box except the group's own pill.
  private boxFree(x0: number, y0: number, x1: number, y1: number, self: number): boolean {
    const b = this.labelBoxes, o = this.boxOwner;
    for (let i = 0; i < b.length; i += 4) {
      if (o[i / 4] === self) continue;
      if (x0 < b[i + 2] && x1 > b[i] && y0 < b[i + 3] && y1 > b[i + 1]) return false;
    }
    return true;
  }

  private textWidth(s: string): number {
    let w = this.widths.get(s);
    if (w === undefined) {
      w = this.ctx.measureText(s).width;
      if (this.widths.size > 200) this.widths.clear();
      this.widths.set(s, w);
    }
    return w;
  }

  private glyphFor(id: bigint, troop: DrawTroop | undefined): string {
    const name = troop?.name ?? '?';
    const hit = this.glyphs.get(id);
    if (hit && hit.name === name) return hit.glyph;
    const glyph = troopGlyph(name, troop?.description);
    this.glyphs.set(id, { name, glyph });
    return glyph;
  }

  // Small rounded tag centred on (x, y).
  private pill(text: string, x: number, y: number, size: number, fill: string, stroke: string, ink: string): void {
    const g = this.ctx;
    g.font = `800 ${size.toFixed(1)}px ${FONT}`;
    const w = g.measureText(text).width + size * 0.9, h = size * 1.35;
    roundRect(g, x - w / 2, y - h / 2, w, h, h / 2);
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = stroke;
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x, y + size * 0.05);
    g.textBaseline = 'alphabetic';
  }

  // Text with a dark halo so it reads over any unit or lane.
  private outlined(s: string, x: number, y: number, size: number, color: string): void {
    const g = this.ctx;
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = 'center';
    g.lineJoin = 'round';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(8,10,20,0.85)';
    g.strokeText(s, x, y);
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  // A tiny crenellated tower, about 8 px, centred on (x, y).
  private towerIcon(x: number, y: number, color: string): void {
    const g = this.ctx;
    g.fillStyle = 'rgba(8,10,20,0.85)';
    g.fillRect(x - 5, y - 6, 10, 12);
    g.fillStyle = color;
    g.fillRect(x - 3.5, y - 2, 7, 6.5);
    g.fillRect(x - 3.5, y - 4.5, 2, 2.5);
    g.fillRect(x - 1, y - 4.5, 2, 2.5);
    g.fillRect(x + 1.5, y - 4.5, 2, 2.5);
  }

  private ring([x, y]: [number, number], color: string, width: number): void {
    const g = this.ctx;
    const [sx, sy] = this.toScreen(x, y);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.arc(sx, sy, this.tile * 0.9, 0, Math.PI * 2);
    g.stroke();
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, color: string): void {
    const g = this.ctx;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(x, y, w, h);
    g.fillStyle = color;
    g.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  private label(s: string, x: number, y: number, size: number, color: string): void {
    const g = this.ctx;
    g.font = `600 ${size}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  private crown(cx: number, cy: number, w: number, color: string): void {
    const g = this.ctx, h = w * 0.6;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(cx - w / 2, cy + h / 2);
    g.lineTo(cx - w / 2, cy - h / 2);
    g.lineTo(cx - w / 4, cy);
    g.lineTo(cx, cy - h / 2);
    g.lineTo(cx + w / 4, cy);
    g.lineTo(cx + w / 2, cy - h / 2);
    g.lineTo(cx + w / 2, cy + h / 2);
    g.closePath();
    g.fill();
  }

  private sprite(url: string): CanvasImageSource | null {
    return spriteImage(url);
  }
}

// Null until the image has loaded, so the placeholder token shows meanwhile. A '?key' URL is
// art whose background removal timed out: key it here once, into a canvas. Shared by both views.
const sprites = new Map<string, { img: HTMLImageElement; out: CanvasImageSource | null }>();
export function spriteImage(url: string): CanvasImageSource | null {
  let s = sprites.get(url);
  if (!s) {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // the api sends CORS headers; keeps the canvas readable
    const entry: { img: HTMLImageElement; out: CanvasImageSource | null } = { img, out: null };
    img.onload = () => (entry.out = /[?&]key\b/.test(url) ? keyed(img) : img);
    img.src = url;
    sprites.set(url, (s = entry));
  }
  return s.out;
}

function keyed(img: HTMLImageElement): CanvasImageSource {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return img;
  g.drawImage(img, 0, 0);
  try {
    const px = g.getImageData(0, 0, c.width, c.height);
    keyBackground(px.data, c.width, c.height);
    g.putImageData(px, 0, 0);
  } catch {
    return img; // tainted after all: better a square than nothing
  }
  return c;
}

// Same rule as the sim: the king sleeps until it is hit or loses a princess tower.
function sleeping(tw: DrawTower, all: DrawTower[]): boolean {
  if (tw.lane !== KING_LANE || tw.hp <= 0 || tw.hp < tw.maxHp) return false;
  return !all.some(o => o.side === tw.side && o.lane !== undefined && o.lane !== KING_LANE && o.hp <= 0);
}
