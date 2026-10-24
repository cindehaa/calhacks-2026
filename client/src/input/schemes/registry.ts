// Every control scheme, and which one this session plays. Adding a scheme: write one file in this
// folder exporting a Scheme, and list it in SCHEMES.
import { dwell } from './dwell';
import { fist } from './fist';
import { flick } from './flick';
import { keys } from './keys';
import { pinch } from './pinch';
import { talk } from './talk';
import type { Scheme } from './types';

export const SCHEMES: Scheme[] = [flick, talk, pinch, fist, dwell, keys];

// What a new session is randomly given, for comparing schemes on real players.
export const AB_POOL: string[] = ['flick', 'talk', 'pinch'];

export const schemeById = (id: string | null | undefined): Scheme | undefined => SCHEMES.find(s => s.id === id);

// ?scheme= wins, then a choice made this session (the picker), then a random pick from the pool.
export function pickScheme(query: string | null, chosen: string | null, rand = Math.random): { scheme: Scheme; how: 'url' | 'picked' | 'random' } {
  const q = schemeById(query);
  if (q) return { scheme: q, how: 'url' };
  const c = schemeById(chosen);
  if (c) return { scheme: c, how: 'picked' };
  const pool = AB_POOL.map(schemeById).filter((s): s is Scheme => !!s);
  return { scheme: pool[Math.floor(rand() * pool.length)] ?? flick, how: 'random' };
}
