// Canvas drawing. World units are tiles; the board is rotated so your side is at the bottom.
import { ARENA_H, ARENA_W, DEPLOY_DELAY, LANE_X, MID_Y, TOWER_RADIUS, UNIT_RADIUS, type Side } from '../../shared/arena';

export interface DrawUnit {
  id: bigint;
  troopId: bigint;
  side: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  delay: number;
}
export interface DrawTower { side: number; x: number; y: number; hp: number; maxHp: number }
export interface DrawTroop { name: string; cost: number; spriteUrl: string }
export interface DrawPending { side: number; x: number; y: number; age: number }

export interface View {
  mySide: Side;
  units: DrawUnit[];
  towers: DrawTower[];
  troops: Map<bigint, DrawTroop>;
  pendings: DrawPending[];
  aim: [number, number] | null; // world coords, own half only
  lock: [number, number] | null;
}

const C = {
  bg: '#0d1020',
  myHalf: '#121834',
  theirHalf: '#1a1426',
  lane: 'rgba(255,255,255,0.035)',
  mid: '#2a3050',
  mine: '#4aa3ff',
  theirs: '#ff5d6c',
  text: '#e8ebf5',
  muted: '#8e96b3',
};

export class Board {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tile = 20;
  private ox = 0;
  private oy = 0;
  private mySide: Side = 0;
  private sprites = new Map<string, HTMLImageElement>();

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
    g.fillStyle = C.bg;
    g.fillRect(0, 0, innerWidth, innerHeight);

    // Halves, lanes, midline.
    const [, myTop] = this.toScreen(0, MID_Y);
    g.fillStyle = C.theirHalf;
    g.fillRect(this.ox, this.oy, ARENA_W * T, myTop - this.oy);
    g.fillStyle = C.myHalf;
    g.fillRect(this.ox, myTop, ARENA_W * T, ARENA_H * T - (myTop - this.oy));
    g.fillStyle = C.lane;
    for (const lx of LANE_X) {
      const [sx] = this.toScreen(lx, 0);
      g.fillRect(sx - T, this.oy, 2 * T, ARENA_H * T);
    }
    g.fillStyle = C.mid;
    g.fillRect(this.ox, myTop - 1, ARENA_W * T, 2);

    for (const tw of v.towers) this.drawTower(tw, tw.side === v.mySide);

    // Pending locks: where a troop is about to land.
    for (const p of v.pendings) {
      const [sx, sy] = this.toScreen(p.x, p.y);
      g.save();
      g.setLineDash([4, 4]);
      g.strokeStyle = p.side === v.mySide ? C.mine : C.theirs;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, sy, T * 0.9, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      this.label(`${Math.max(0, DEPLOY_DELAY - p.age).toFixed(1)}`, sx, sy + 4, 12, C.muted);
    }

    // Units. Label one unit per troop.
    const labelled = new Set<bigint>();
    for (const u of v.units) {
      const mine = u.side === v.mySide;
      const [sx, sy] = this.toScreen(u.x, u.y);
      const r = UNIT_RADIUS * T;
      const troop = v.troops.get(u.troopId);
      g.globalAlpha = u.delay > 0 ? 0.35 : 1;
      const img = troop?.spriteUrl ? this.sprite(troop.spriteUrl) : null;
      if (img) {
        g.drawImage(img, sx - r * 1.6, sy - r * 1.6, r * 3.2, r * 3.2);
      } else {
        g.fillStyle = mine ? C.mine : C.theirs;
        g.beginPath();
        g.arc(sx, sy, r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      const first = !labelled.has(u.troopId);
      labelled.add(u.troopId);
      if (u.delay > 0) {
        if (first) this.label(u.delay.toFixed(1), sx, sy - r - 4, 11, C.muted);
      } else if (u.hp < u.maxHp) {
        this.bar(sx - r, sy - r - 5, 2 * r, 3, u.hp / u.maxHp, mine ? C.mine : C.theirs);
      }
      if (troop && first) this.label(`${troop.name} · ${troop.cost}`, sx, sy + r + 12, 11, C.text);
    }

    // Aim cursor and locked spot.
    if (v.lock) this.ring(v.lock, C.mine, 2);
    if (v.aim) this.ring(v.aim, 'rgba(255,255,255,0.5)', 1);
  }

  private drawTower(tw: DrawTower, mine: boolean): void {
    const g = this.ctx, T = this.tile;
    const [sx, sy] = this.toScreen(tw.x, tw.y);
    const s = TOWER_RADIUS * T;
    g.fillStyle = tw.hp > 0 ? (mine ? '#24508a' : '#8a2a36') : '#2a2d3d';
    g.fillRect(sx - s, sy - s, 2 * s, 2 * s);
    g.strokeStyle = mine ? C.mine : C.theirs;
    g.lineWidth = 2;
    g.strokeRect(sx - s, sy - s, 2 * s, 2 * s);
    if (tw.hp > 0) this.bar(sx - s, sy - s - 7, 2 * s, 4, tw.hp / tw.maxHp, mine ? C.mine : C.theirs);
    this.label(tw.hp > 0 ? String(Math.ceil(tw.hp)) : 'down', sx, sy + 4, 11, C.text);
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

  private sprite(url: string): HTMLImageElement | null {
    let img = this.sprites.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      this.sprites.set(url, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }
}
