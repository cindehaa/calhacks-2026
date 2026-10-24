// What a click or tap on the board reacts with, decided apart from the renderer so it can be
// tested. Reactions only ever add to a click: the existing handlers (fire the words waiting, or
// pick the typing spot) still run, so a click that could deploy always deploys.
import { ARENA_H, ARENA_W, MID_Y } from '../../shared/arena';

export type PokeHit = 'mine' | 'theirs' | 'tower' | null; // what the pointer landed on, if anything
export type Reaction = 'hop' | 'flinch' | 'shudder' | 'puff' | null;

export interface PokeInput {
  hit: PokeHit;
  x: number; // board coords under the pointer
  y: number;
  mySide: number;
  deployable: boolean; // canDeploy at (x, y) for you
}

export interface PokeResult {
  reaction: Reaction;
  deploy: boolean; // the click goes on to the deploy handlers; always equal to `deployable`
}

export const onBoard = (x: number, y: number): boolean => x >= 0 && x <= ARENA_W && y >= 0 && y <= ARENA_H;
// Side 0 holds the low half (y < MID_Y), side 1 the high half.
export const theirHalf = (y: number, mySide: number): boolean => (mySide === 0 ? y > MID_Y : y < MID_Y);

export function pokeReaction(p: PokeInput): PokeResult {
  const deploy = p.deployable;
  if (p.hit === 'mine') return { reaction: 'hop', deploy };
  if (p.hit === 'theirs') return { reaction: 'flinch', deploy };
  if (p.hit === 'tower') return { reaction: 'shudder', deploy };
  // Empty ground: only the opponent's half, where you couldn't deploy anyway, puffs.
  if (!deploy && onBoard(p.x, p.y) && theirHalf(p.y, p.mySide)) return { reaction: 'puff', deploy };
  return { reaction: null, deploy };
}
