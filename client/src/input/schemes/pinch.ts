// Pinch to summon. The mic always listens; the index knuckle aims (it barely moves when the
// fingers close), and the pinch itself fires the moment it starts, aimed from ~100 ms before.
// Thumb against the index or the middle finger, whichever is closer. A flick or a fist while the
// troop is still being summoned takes it back, refunded; "cancel" or Esc too.
import { keysAndMouse, Pending } from './common';
import type { Pt, Scheme } from './types';

export const pinch: Scheme = {
  id: 'pinch',
  name: 'Pinch',
  howTo: 'Point, say it, pinch to summon. Fist to cancel.',
  needs: ['hand', 'pinch', 'fist', 'flick', 'words', 'deploy', 'key', 'mouse'],
  create(emit, ctx) {
    const pending = new Pending();
    let knuckle: Pt | null = null;
    const takeBack = (why: string) => {
      if (pending.any) emit({ kind: 'cancel', why });
      else if (why === 'fist') emit({ kind: 'clear', why });
    };
    return {
      on(s) {
        pending.on(s);
        if (s.kind === 'hand') {
          knuckle = s.visible ? s.knuckle : null;
          emit({ kind: 'aim', at: knuckle });
        } else if (s.kind === 'pinch') {
          if (ctx.menus()) emit({ kind: 'uiActivate', at: s.aim });
          else emit({ kind: 'commit', t: s.t, by: 'pinch', at: s.aim });
        } else if (s.kind === 'fist') {
          if (s.closed) takeBack('fist');
        } else if (s.kind === 'flick') {
          if (ctx.menus()) emit({ kind: 'uiActivate', at: knuckle });
          else takeBack('flick');
        } else if (s.kind === 'words') {
          if (s.cancel && pending.any) emit({ kind: 'cancel', why: 'said' });
        } else keysAndMouse(s, emit, ctx, { menuAt: () => knuckle });
      },
      state: () => (pending.any ? 'summoning' : 'ready'),
    };
  },
};
