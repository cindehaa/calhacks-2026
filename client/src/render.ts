// What one frame of the game is, as the board draws it (units, towers, troops, drops, aim and
// match state), and the troop sprite art: fetched, keyed and cached once per URL.
import type { Side } from '../../shared/arena';
import { chromaKey } from './chroma';
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
export interface DrawTower { side: number; lane?: number; x: number; y: number; hp: number; maxHp: number; id?: bigint | number; attackSeq?: number }
export interface DrawTroop { name: string; cost: number; spriteUrl: string; description?: string }
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
  // Optional match state, for banners and stingers (3-2-1, double elixir, win/lose).
  time?: number; // match seconds elapsed
  status?: string; // 'lobby' | 'playing' | 'done'
  winner?: number; // 0, 1, -1 draw
}

const art = new Map<string, HTMLCanvasElement | null>(); // null while loading or if it failed

// A troop's sprite, keyed and cropped, once it has loaded; null until then (draw the glyph).
export function spriteArt(url: string): HTMLCanvasElement | null {
  if (!art.has(url)) {
    art.set(url, null);
    if (SPRITE_HOST.test(url)) loadSprite(url).then(c => art.set(url, c), e => console.warn('sprite failed', url, e));
  }
  return art.get(url) ?? null;
}

// Only fal's CDN: a troop's URL comes from whichever player deployed it.
const SPRITE_HOST = /^https:\/\/[a-z0-9.-]+\.fal\.media\//;
const KEY_SIZE = 256; // keyed at half the generated size; plenty for a unit on screen

// Keys out a generated sprite's background and crops it to a square with the troop centred and
// standing on the bottom edge, which is where drawUnits puts its feet.
async function loadSprite(url: string): Promise<HTMLCanvasElement | null> {
  const img = new Image();
  img.crossOrigin = 'anonymous'; // fal's CDN sends CORS headers, so the pixels stay readable
  img.src = url;
  await img.decode();
  const src = document.createElement('canvas');
  src.width = src.height = KEY_SIZE;
  const sg = src.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(img, 0, 0, KEY_SIZE, KEY_SIZE);
  const px = sg.getImageData(0, 0, KEY_SIZE, KEY_SIZE);
  const box = chromaKey(px);
  if (!box) return null;
  sg.putImageData(px, 0, 0);
  const side = Math.max(box.w, box.h);
  const out = document.createElement('canvas');
  out.width = out.height = side;
  out.getContext('2d')!.drawImage(src, box.x, box.y, box.w, box.h, (side - box.w) / 2, side - box.h, box.w, box.h);
  return out;
}
