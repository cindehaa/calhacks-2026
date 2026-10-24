// Fist to summon: the mic always listens; the palm centre aims (it holds still while the hand
// closes), and closing the hand sends the words where the palm was just before. "Cancel" or Esc
// clears.
import { CursorHistory } from '../trail';
import { keysAndMouse } from './common';
import type { Pt, Scheme } from './types';

const BEFORE_MS = 220; // the fist counts ~120 ms after it closes; aim from a little before it began

export const fist: Scheme = {
  id: 'fist',
  name: 'Fist',
  howTo: 'Say the troop, aim with your palm, close your fist to send it. Esc or "cancel" clears.',
  needs: ['hand', 'fist', 'key', 'mouse'],
  create(emit, ctx) {
    const trail = new CursorHistory();
    let palm: Pt | null = null;
    return {
      on(s) {
        if (s.kind === 'hand') {
          palm = s.visible ? s.palm : null;
          if (palm) trail.push(s.t, palm);
          else trail.clear();
          emit({ kind: 'aim', at: palm });
        } else if (s.kind === 'fist') {
          if (!s.closed) return;
          const at = trail.at(s.t - BEFORE_MS) ?? palm;
          if (ctx.menus()) emit({ kind: 'uiActivate', at });
          else if (at) emit({ kind: 'commit', t: s.t, by: 'fist', at });
        } else keysAndMouse(s, emit, ctx, { menuAt: () => palm });
      },
    };
  },
};
