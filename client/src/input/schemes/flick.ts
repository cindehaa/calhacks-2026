// Today's controls, exactly: the mic always listens; point with the index finger, flick the wrist
// down to send the words there; a fist, Esc or "cancel" clears them.
import { keysAndMouse } from './common';
import type { Pt, Scheme } from './types';

export const flick: Scheme = {
  id: 'flick',
  name: 'Flick',
  howTo: 'Say the troop, point, flick your wrist down to send it. Fist to clear.',
  needs: ['flick', 'fist', 'key', 'mouse', 'hand'],
  create(emit, ctx) {
    let hand: Pt | null = null;
    return {
      on(s) {
        if (s.kind === 'hand') hand = s.visible ? s.cursor : null;
        else if (s.kind === 'fist') {
          if (s.closed) emit({ kind: 'clear', why: 'fist' });
        } else if (s.kind === 'flick') {
          if (ctx.menus()) emit({ kind: 'uiActivate', at: s.aim });
          else emit({ kind: 'commit', t: s.t, by: 'flick', at: s.aim });
        } else keysAndMouse(s, emit, ctx, { menuAt: () => hand });
      },
    };
  },
};
