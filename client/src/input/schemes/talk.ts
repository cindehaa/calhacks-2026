// Talk to summon: no fire gesture. Point at your half and speak; the spot locks where you were
// pointing as you started, and the troop goes when you stop talking (about 0.6 s of quiet, longer
// if the last word leaves the sentence hanging: "a giant with…"). Speech while the hand is down
// or pointing elsewhere is ignored. A fist or a flick while the troop is being summoned takes it
// back, refunded; "cancel" works too. Space sends now, Esc clears.
import { keysAndMouse, Pending } from './common';
import type { Pt, Scheme } from './types';

export const TALK = {
  silenceMs: 600, // quiet this long after speech sends it
  hangingMs: 1300, // ...or this long when the last word is unfinished
  giveUpMs: 2500, // quiet this long with no words heard: drop the lock
  startMs: 60, // loud this long starts an utterance (like the VAD's own start)
};

// Words a sentence doesn't end on: wait longer for the rest.
const HANGING = new Set(['a', 'an', 'the', 'with', 'and', 'of', 'to', 'that', 'but', 'or', 'my', 'some', 'in', 'on', 'for', 'like', 'who', 'very', 'really', 'plus']);

export function hanging(text: string): boolean {
  const w = text.trim().toLowerCase().replace(/[.,!?…-]+$/g, '').split(/\s+/).pop() ?? '';
  return HANGING.has(w);
}

export const talk: Scheme = {
  id: 'talk',
  name: 'Talk',
  howTo: 'Point at your side and say it. It summons when you stop talking. Fist to cancel.',
  needs: ['hand', 'level', 'voice', 'words', 'fist', 'flick', 'deploy', 'key', 'mouse', 'tick'],
  create(emit, ctx) {
    const pending = new Pending();
    let hand: { at: Pt; overHalf: boolean } | null = null;
    let state: 'idle' | 'listening' = 'idle';
    let from = 0, lockAt: Pt | null = null, lastLoud = 0, loudSince: number | null = null;
    let heard = ''; // words since the lock
    // Hand up and pointing at your half, on the board. Without a camera, the mouse stands in.
    const gate = (): Pt | null => {
      if (!ctx.playing() || ctx.menus()) return null;
      if (ctx.camera()) return hand?.overHalf ? hand.at : null;
      const c = ctx.cursor();
      return c && ctx.canDeployAt(c) ? c : null;
    };
    const start = (t: number) => {
      const at = gate();
      if (state !== 'idle' || !at) return;
      state = 'listening';
      from = t;
      lockAt = at;
      lastLoud = t;
      heard = '';
      emit({ kind: 'lock', at, t });
    };
    const reset = () => {
      state = 'idle';
      lockAt = null;
      heard = '';
    };
    const takeBack = (why: string) => {
      if (pending.any) emit({ kind: 'cancel', why });
      else if (why === 'fist' && (state === 'listening' || ctx.waiting())) {
        reset();
        emit({ kind: 'clear', why });
      }
    };
    return {
      on(s) {
        pending.on(s);
        switch (s.kind) {
          case 'hand':
            hand = s.visible ? { at: s.cursor, overHalf: s.overHalf } : null;
            return;
          case 'voice':
            if (s.phase === 'start') start(s.t);
            return;
          case 'level':
            if (s.loud) {
              lastLoud = s.t;
              loudSince ??= s.t;
              if (s.t - loudSince >= TALK.startMs) start(loudSince);
            } else loudSince = null;
            return;
          case 'words':
            if (s.cancel) {
              if (pending.any) emit({ kind: 'cancel', why: 'said' });
              reset();
            } else if (state === 'listening' && s.text) heard = s.waiting;
            return;
          case 'tick': {
            if (state !== 'listening') return;
            const quiet = s.t - lastLoud;
            if (heard && quiet >= (hanging(heard) ? TALK.hangingMs : TALK.silenceMs)) {
              const at = lockAt!, f = from;
              reset();
              emit({ kind: 'commit', t: s.t, by: 'talk', at, from: f });
            } else if (!heard && quiet >= TALK.giveUpMs) reset();
            return;
          }
          case 'fist':
            if (s.closed) takeBack('fist');
            return;
          case 'flick':
            if (ctx.menus()) emit({ kind: 'uiActivate', at: s.aim });
            else takeBack('flick');
            return;
          case 'key':
            if (s.key === 'Escape') reset();
            keysAndMouse(s, emit, ctx, { fireAt: () => lockAt, from: () => (state === 'listening' ? from : undefined), menuAt: () => hand?.at ?? null });
            if (s.key === 'Space') reset();
            return;
          default:
            keysAndMouse(s, emit, ctx, { fireAt: () => lockAt, menuAt: () => hand?.at ?? null });
        }
      },
      locked: () => lockAt,
      state: () => (pending.any ? `summoning · ${state}` : state === 'listening' ? `listening: ${heard || '…'}` : gate() ? 'ready: speak' : 'closed: point at your side'),
    };
  },
};
