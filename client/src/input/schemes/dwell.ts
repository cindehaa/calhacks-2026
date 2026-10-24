// Dwell to summon: the mic always listens; hold the pointing finger still for about 0.6 s with
// words waiting and the troop goes there, as a ring fills round the cursor. Move away and back to
// send again. A fist, Esc or "cancel" clears.
import { keysAndMouse } from './common';
import type { Pt, Scheme } from './types';

export const DWELL = { ms: 600, radiusPx: 28 };

export const dwell: Scheme = {
  id: 'dwell',
  name: 'Dwell',
  howTo: 'Say the troop, then hold your finger still where it goes. Fist to clear.',
  needs: ['hand', 'words', 'fist', 'key', 'mouse', 'tick'],
  create(emit, ctx) {
    let hand: Pt | null = null;
    let anchor: Pt | null = null, since = 0, spent = false;
    const armed = () => !!hand && !!ctx.waiting() && ctx.playing() && !ctx.menus();
    return {
      on(s) {
        if (s.kind === 'hand') {
          hand = s.visible ? s.cursor : null;
          if (!hand) return void (anchor = null);
          if (!anchor || Math.hypot(hand.x - anchor.x, hand.y - anchor.y) > DWELL.radiusPx) {
            anchor = hand;
            since = s.t;
            spent = false;
          }
        } else if (s.kind === 'tick') {
          if (!anchor || spent || !armed()) {
            if (!armed()) since = s.t; // the ring starts once there are words
            return;
          }
          if (s.t - since >= DWELL.ms) {
            spent = true;
            emit({ kind: 'commit', t: s.t, by: 'dwell', at: anchor });
          }
        } else if (s.kind === 'fist') {
          if (s.closed) emit({ kind: 'clear', why: 'fist' });
        } else keysAndMouse(s, emit, ctx, { menuAt: () => hand });
      },
      ring(t) {
        if (!anchor || spent || !armed()) return null;
        return { at: anchor, k: Math.min(1, (t - since) / DWELL.ms) };
      },
    };
  },
};
