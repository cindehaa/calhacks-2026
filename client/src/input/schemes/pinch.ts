// The controls. The mic always listens; the index fingertip aims, and touching the thumb to the
// middle finger fires whatever was said, aimed from ~100 ms before the pinch closed (the index
// barely moves when the middle finger does). A fist takes back a troop still being summoned,
// refunded, or else clears the words; "cancel" or Esc too. On menus a pinch clicks.
import { keysAndMouse, Pending } from './common';
import type { Pt, Scheme } from './types';

export const pinch: Scheme = {
  id: 'pinch',
  name: 'Pinch',
  howTo: 'Point with your index finger, say the troop, pinch thumb and middle finger to send it. Fist to cancel.',
  needs: ['hand', 'pinch', 'fist', 'words', 'deploy', 'key', 'mouse'],
  create(emit, ctx) {
    const pending = new Pending();
    let tip: Pt | null = null;
    return {
      on(s) {
        pending.on(s);
        if (s.kind === 'hand') tip = s.visible ? s.cursor : null;
        else if (s.kind === 'pinch') {
          if (ctx.menus()) emit({ kind: 'uiActivate', at: s.aim });
          else emit({ kind: 'commit', t: s.t, by: 'pinch', at: s.aim });
        } else if (s.kind === 'fist') {
          if (!s.closed) return;
          if (pending.any) emit({ kind: 'cancel', why: 'fist' });
          else emit({ kind: 'clear', why: 'fist' });
        } else if (s.kind === 'words') {
          if (s.cancel && pending.any) emit({ kind: 'cancel', why: 'said' });
        } else keysAndMouse(s, emit, ctx, { menuAt: () => tip });
      },
      state: () => (pending.any ? 'summoning' : 'ready'),
    };
  },
};
