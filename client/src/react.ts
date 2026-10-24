// Things react when you poke them, so the game feels alive: menu buttons squish and tick, home
// banners sway and puff embers, the wordmark flares, and on the board your troops hop, enemy
// troops flinch, towers shudder and shed frost, and the opponent's ground puffs snow. Hovering a
// unit (mouse or the hand's fingertip) lights it and shows its name and cost.
//
// Everything here only adds to a click; it never stops one (see pokes.ts). Each reaction has a
// tiny synth sound that goes through sfx's output, so M mutes it, and every motion is dropped
// under prefers-reduced-motion (the sound and a plain highlight stay).
import { sfx } from './sfx';
import { flameGlyph } from './pov';
import type { Fx } from './fx';
import type { DrawTower, DrawTroop, DrawUnit } from './render';
import { pokeReaction, type PokeHit, type Reaction } from './pokes';
import './react.css';

const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
};

// ---------- sounds ----------

export type Blip = 'hover' | 'press' | 'hop' | 'flinch' | 'frost' | 'puff' | 'flare' | 'sway';
const lastBlip = new Map<Blip, number>();
const BLIP_GAP: Partial<Record<Blip, number>> = { hover: 0.07, press: 0.04 };
let noiseBuf: AudioBuffer | null = null;

function tone(ac: AudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hiss(ac: AudioContext, out: AudioNode, t: number, dur: number, gain: number, type: BiquadFilterType, freq: number) {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate / 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noiseBuf;
  f.type = type;
  f.frequency.value = freq;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export function blip(name: Blip): void {
  const o = sfx.out();
  if (!o) return;
  const { ac, out } = o, t = ac.currentTime;
  const gap = BLIP_GAP[name];
  if (gap && t - (lastBlip.get(name) ?? -1) < gap) return;
  lastBlip.set(name, t);
  const r = 0.94 + Math.random() * 0.12; // a little wobble so repeats don't drone
  try {
    switch (name) {
      case 'hover': tone(ac, out, t, 'sine', 1500 * r, 1700 * r, 0.035, 0.06); break; // a breath of a tick
      case 'press': tone(ac, out, t, 'triangle', 420 * r, 260 * r, 0.06, 0.2); hiss(ac, out, t, 0.03, 0.08, 'bandpass', 2400); break; // soft thock
      case 'hop': tone(ac, out, t, 'sine', 520 * r, 1040 * r, 0.12, 0.13); break; // boing up
      case 'flinch': tone(ac, out, t, 'square', 330 * r, 200 * r, 0.07, 0.05); hiss(ac, out, t, 0.05, 0.08, 'highpass', 3000); break;
      case 'frost': // stone knock and ice tinkle
        tone(ac, out, t, 'sine', 180 * r, 90, 0.1, 0.18);
        for (const [i, f] of [2800, 3500, 2300].entries()) tone(ac, out, t + 0.03 + i * 0.04, 'triangle', f * r, f * 0.95 * r, 0.1, 0.035);
        break;
      case 'puff': hiss(ac, out, t, 0.18, 0.12, 'lowpass', 1400 * r); break; // packed snow
      case 'flare': hiss(ac, out, t, 0.35, 0.07, 'bandpass', 900); tone(ac, out, t, 'sine', 660 * r, 990 * r, 0.3, 0.06); break; // a fire catching
      case 'sway': hiss(ac, out, t, 0.25, 0.06, 'bandpass', 600 * r); break; // cloth in the wind
    }
  } catch { /* no audio, no problem */ }
}

// ---------- menus and HUD: squish, tilt, tick ----------

// Buttons squish on press and brighten or tilt on hover (react.css); this adds the sounds.
export function menuReactions(): void {
  let over: Element | null = null;
  addEventListener('pointerover', e => {
    const b = (e.target as HTMLElement).closest?.('button:not(:disabled)') ?? null;
    if (b && b !== over && (e as PointerEvent).pointerType === 'mouse') blip('hover');
    over = b;
  }, { passive: true });
  addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest?.('button:not(:disabled)')) blip('press');
  }, { passive: true, capture: true });
}

// ---------- home: banners sway, embers puff, the wordmark flares ----------

let sparkLayer: HTMLElement | null = null;
function embers(x: number, y: number, n: number, colors = ['#ffb02e', '#ffd27a', '#ff7a3d']): void {
  if (reduced()) return;
  if (!sparkLayer) {
    sparkLayer = document.createElement('div');
    sparkLayer.className = 'reactSparks';
    document.body.appendChild(sparkLayer);
  }
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    const size = 3 + Math.random() * 4;
    s.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${colors[i % colors.length]}`;
    sparkLayer.appendChild(s);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, d = 30 + Math.random() * 70;
    const dx = Math.cos(a) * d, dy = Math.sin(a) * d - 30;
    s.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.3)`, opacity: 0 },
    ], { duration: 600 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => s.remove();
  }
}

function swing(el: HTMLElement, deg: number): void {
  if (reduced()) return;
  el.animate([{ rotate: '0deg' }, { rotate: `${deg}deg` }, { rotate: `${-deg * 0.6}deg` }, { rotate: `${deg * 0.3}deg` }, { rotate: '0deg' }],
    { duration: 1100, easing: 'ease-out', composite: 'add' });
}

function flare(el: HTMLElement): void {
  el.classList.remove('reactFlare');
  void el.offsetWidth; // restart the animation
  el.classList.add('reactFlare');
}

export function homeReactions(): void {
  const on = (sel: string, f: (el: HTMLElement, e: PointerEvent) => void) => {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) el.addEventListener('pointerdown', e => f(el, e), { passive: true });
  };
  // Hung things swing from the top, away from where they were struck.
  on('.tapestry, .plaque, .result .banner', (el, e) => {
    const r = el.getBoundingClientRect();
    swing(el, (e.clientX < r.left + r.width / 2 ? 1 : -1) * (2.5 + Math.random()));
    embers(e.clientX, e.clientY, 10);
    blip('sway');
  });
  on('.wordmark', (el, e) => {
    flare(el);
    embers(e.clientX, e.clientY, 18);
    blip('flare');
  });
  on('.islandWrap, .moon', (_el, e) => {
    embers(e.clientX, e.clientY, 8);
    blip('puff');
  });
  // The big slabs throw a few embers too.
  on('.home .slab', (_el, e) => embers(e.clientX, e.clientY, 6));
}

// ---------- the board ----------

export type BoardHit =
  | { kind: 'unit'; unit: DrawUnit; troop?: DrawTroop; mine: boolean }
  | { kind: 'tower'; key: unknown; tower: DrawTower };

// What reactions on the board need from the renderer (PovBoard implements it).
export interface PokeBoard {
  readonly canvas: HTMLCanvasElement;
  readonly react: BoardReactions;
  pick(px: number, py: number): BoardHit | null;
  toWorld(px: number, py: number): [number, number];
}

interface Pop { text: string; x: number; y: number; id: bigint | null; t0: number; color: string; emote: boolean }
interface Jolt { kind: 'hop' | 'flinch'; t0: number }
const EMOTES = ['!', '♪', '♥', '★', '?!', '☺'];
const NAME_CHEERS = ['', '!', ' ready', ' here'];
const HOP = 0.42, FLINCH = 0.32, SHUDDER = 0.5;

export class BoardReactions {
  private jolts = new Map<bigint, Jolt>();
  private shudders = new Map<unknown, number>();
  private pops: Pop[] = [];
  private hoverId: bigint | null = null;
  private hover: { unit: DrawUnit; troop?: DrawTroop; mine: boolean } | null = null;
  private now = 0;
  private queued: { hit: BoardHit | null; reaction: Reaction; x: number; y: number; side: number }[] = [];
  private flip = 0;

  constructor(private fx: Fx) {}

  // From the click listener; applied on the next frame, on the board's clock.
  queue(hit: BoardHit | null, reaction: Reaction, x: number, y: number, side: number): void {
    if (reaction) this.queued.push({ hit, reaction, x, y, side });
  }

  // Once a frame, before the units and towers are placed.
  step(now: number, hover: BoardHit | null): void {
    this.now = now;
    for (const q of this.queued.splice(0)) this.apply(q.hit, q.reaction, q.x, q.y, now);
    const id = hover?.kind === 'unit' ? hover.unit.id : null;
    if (id !== null && id !== this.hoverId) blip('hover');
    this.hoverId = id;
    this.hover = hover?.kind === 'unit' ? hover : null;
    this.pops = this.pops.filter(p => now - p.t0 < 1.1);
  }

  private apply(hit: BoardHit | null, reaction: Reaction, x: number, y: number, now: number): void {
    const few = reduced();
    if (reaction === 'hop' && hit?.kind === 'unit') {
      this.jolts.set(hit.unit.id, { kind: 'hop', t0: now });
      const name = hit.troop?.name;
      // Alternate a little emote and the troop calling its name.
      const emote = !name || this.flip++ % 2 === 0;
      const text = emote ? EMOTES[Math.floor(Math.random() * EMOTES.length)] : `${name}${NAME_CHEERS[Math.floor(Math.random() * NAME_CHEERS.length)]}`;
      this.pops.push({ text, x: hit.unit.x, y: hit.unit.y, id: hit.unit.id, t0: now, color: '#ffd27a', emote });
      for (let i = 0; i < (few ? 2 : 6); i++) {
        const a = Math.random() * Math.PI * 2;
        this.fx.particle(hit.unit.x, hit.unit.y, 0.05, Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0.6, 0.4, 0.12, '#e6efff', 0);
      }
      blip('hop');
    } else if (reaction === 'flinch' && hit?.kind === 'unit') {
      this.jolts.set(hit.unit.id, { kind: 'flinch', t0: now });
      this.pops.push({ text: '!', x: hit.unit.x, y: hit.unit.y, id: hit.unit.id, t0: now, color: '#ff8d98', emote: true });
      blip('flinch');
    } else if (reaction === 'shudder' && hit?.kind === 'tower') {
      this.shudders.set(hit.key, now);
      const { x: tx, y: ty } = hit.tower;
      for (let i = 0; i < (few ? 5 : 16); i++) {
        const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 1.4;
        this.fx.particle(tx + Math.cos(a) * 0.8, ty + Math.sin(a) * 0.8, 2.4 + Math.random() * 1.2, Math.cos(a) * s, Math.sin(a) * s, 0.5 + Math.random(),
          0.7 + Math.random() * 0.4, 0.06 + Math.random() * 0.06, i % 3 ? '#dbe9f4' : '#9cc3e0', 1);
      }
      for (let i = 0; i < (few ? 3 : 9); i++) {
        const a = Math.random() * Math.PI * 2;
        this.fx.particle(tx + Math.cos(a) * 0.4, ty + Math.sin(a) * 0.4, 2.6 + Math.random() * 0.8, Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0.3, 1 + Math.random() * 0.4, 0.4 + Math.random() * 0.2, '#eef5ff', 0);
      }
      blip('frost');
    } else if (reaction === 'puff') {
      this.fx.ring(x, y, 0.15, 1.1, 0.4, 'rgba(225,238,255,0.8)', 2);
      for (let i = 0; i < (few ? 4 : 12); i++) {
        const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 1.2;
        this.fx.particle(x, y, 0.05, Math.cos(a) * s, Math.sin(a) * s, 0.5 + Math.random() * 0.8, 0.5 + Math.random() * 0.3, 0.14 + Math.random() * 0.12, i % 2 ? '#e6efff' : '#c8d6f0', 0);
      }
      // The red side's ground smoulders: a few embers rise with the snow.
      for (let i = 0; i < (few ? 2 : 6); i++) {
        const a = Math.random() * Math.PI * 2;
        this.fx.particle(x, y, 0.1, Math.cos(a) * 0.4, Math.sin(a) * 0.4, 1.2 + Math.random() * 1.2, 0.8 + Math.random() * 0.5, 0.05 + Math.random() * 0.04, i % 2 ? '#ffb02e' : '#ff7a3d', 2);
      }
      blip('puff');
    }
  }

  // Body offsets for a unit this frame, in tiles: lift, sideways, squash, and extra brightness.
  private out = { up: 0, dx: 0, sx: 1, sy: 1, glow: 0 };
  unit(id: bigint, now: number): { up: number; dx: number; sx: number; sy: number; glow: number } {
    const o = this.out;
    o.up = o.dx = 0;
    o.sx = o.sy = 1;
    o.glow = id === this.hoverId ? 0.35 + 0.1 * Math.sin(now * 8) : 0;
    const j = this.jolts.get(id);
    if (!j) return o;
    const k = (now - j.t0) / (j.kind === 'hop' ? HOP : FLINCH);
    if (k >= 1 || k < 0) {
      this.jolts.delete(id);
      return o;
    }
    if (j.kind === 'flinch') o.glow += 0.8 * (1 - k); // a pale flash even with motion off
    if (reduced()) return o;
    if (j.kind === 'hop') {
      o.up = Math.sin(k * Math.PI) * 0.7;
      const s = k < 0.15 ? Math.sin((k / 0.15) * Math.PI) * 0.15 : k > 0.85 ? Math.sin(((k - 0.85) / 0.15) * Math.PI) * 0.18 : 0;
      o.sx = 1 + s;
      o.sy = 1 - s;
    } else {
      o.dx = Math.sin(k * Math.PI * 6) * 0.12 * (1 - k);
      o.sx = 1 - 0.1 * (1 - k);
      o.sy = 1 - 0.12 * (1 - k);
    }
    return o;
  }

  // A tower's sideways shudder this frame, in tiles.
  tower(key: unknown, now = this.now): number {
    const t0 = this.shudders.get(key);
    if (t0 === undefined) return 0;
    const k = (now - t0) / SHUDDER;
    if (k >= 1 || k < 0) {
      this.shudders.delete(key);
      return 0;
    }
    return reduced() ? 0 : Math.sin(k * Math.PI * 9) * 0.09 * (1 - k);
  }

  // Name pops and the hover label. `head` gives the screen point just above a unit, by id.
  drawOverlay(g: CanvasRenderingContext2D, head: (id: bigint) => [number, number] | null, ground: (x: number, y: number, h: number) => [number, number] | null, font: string, quiet = false): void {
    // quiet: a failure message is up (notice slab or "didn't catch that"), so labels wait: one message at a time.
    if (quiet) return;
    const now = this.now, still = reduced();
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const p of this.pops) {
      const k = (now - p.t0) / 1.1;
      const at = (p.id !== null && head(p.id)) || ground(p.x, p.y, 1.6);
      if (!at) continue;
      const rise = still ? 0 : 18 * Math.min(1, k * 3) + 10 * k;
      const pop = still ? 1 : k < 0.12 ? 0.6 + (k / 0.12) * 0.55 : k < 0.22 ? 1.15 - ((k - 0.12) / 0.1) * 0.15 : 1;
      g.globalAlpha = k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
      const size = (p.emote ? 20 : 14) * pop;
      g.font = `800 ${size.toFixed(1)}px ${font}`;
      const x = at[0], y = at[1] - 36 - rise;
      if (p.emote) {
        g.beginPath();
        g.arc(x, y, size * 0.8, 0, Math.PI * 2);
        g.fillStyle = 'rgba(13,16,32,0.85)';
        g.fill();
        g.strokeStyle = p.color;
        g.lineWidth = 1.5;
        g.stroke();
      } else {
        g.lineWidth = 3.5;
        g.strokeStyle = 'rgba(8,10,20,0.9)';
        g.strokeText(p.text, x, y);
      }
      g.fillStyle = p.color;
      g.fillText(p.text, x, y + (p.emote ? 1 : 0));
    }
    g.globalAlpha = 1;
    const h = this.hover;
    const at = h && head(h.unit.id);
    if (h && at && h.troop) {
      const name = h.troop.name, cost = String(h.troop.cost);
      g.font = `700 12px ${font}`;
      const nw = g.measureText(name).width;
      const cw = 22, w = nw + cw + 20, ht = 20, x = at[0] - w / 2, y = at[1] - 62 - ht / 2;
      g.fillStyle = 'rgba(13,16,32,0.88)';
      g.strokeStyle = h.mine ? '#4aa3ff' : '#ff5d6c';
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(x, y, w, ht, ht / 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#e8ebf5';
      g.textAlign = 'left';
      g.fillText(name, x + 9, y + ht / 2 + 1);
      // The cost after a small flame, like the cost pills: paid in embers.
      const gx = x + w - cw / 2 - 6, gy = y + ht / 2;
      flameGlyph(g, gx - 5, gy, 13, '#ff8a3d');
      g.fillStyle = '#ffe2c4';
      g.textAlign = 'center';
      g.font = `800 11px ${font}`;
      g.fillText(cost, gx + 5, gy + 1);
    }
    g.restore();
  }
}

// Hook the board's clicks up. Listens alongside the deploy handlers and never stops the event.
export function boardReactions(board: PokeBoard, opts: { playing: () => boolean; mySide: () => number; canDeploy: (x: number, y: number) => boolean }): void {
  board.canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !opts.playing()) return;
    const hit = board.pick(e.clientX, e.clientY);
    const [x, y] = board.toWorld(e.clientX, e.clientY);
    const kind: PokeHit = !hit ? null : hit.kind === 'tower' ? 'tower' : hit.mine ? 'mine' : 'theirs';
    const { reaction } = pokeReaction({ hit: kind, x, y, mySide: opts.mySide(), deployable: opts.canDeploy(x, y) });
    board.react.queue(hit, reaction, x, y, opts.mySide());
  }, { passive: true });
}
