// What one frame of the game is, as the board draws it (units, towers, troops, drops, aim and
// match state), and the troop sprite art: loaded, keyed if need be and cached once per URL.
import type { Side } from '../../shared/arena';
import { keyBackground } from './chroma';
import type { DropView } from './drops';
import type { InputView } from './input/draw';

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

// Only the api's own art: a troop's URL comes from whichever player deployed it.
const SPRITE_URL = /^\/api\/(sprite|pose)\/[0-9a-f]{20}(\.key)?\.png(\?key)?$/;

// Null until the image has loaded, so the placeholder token shows meanwhile. A '?key' URL is
// art whose background removal timed out: key it here once, into a canvas.
const sprites = new Map<string, { img: HTMLImageElement; out: CanvasImageSource | null }>();
export function spriteImage(url: string): CanvasImageSource | null {
  if (!SPRITE_URL.test(url)) return null;
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

