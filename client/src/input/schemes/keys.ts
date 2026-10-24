// Mouse and keyboard only: the camera is ignored. Say or type the troop, click the board or press
// Space to send it, Esc clears.
import { keysAndMouse } from './common';
import type { Pt, Scheme } from './types';

export const keys: Scheme = {
  id: 'keys',
  name: 'Mouse & keys',
  howTo: 'Say or type the troop, click where it goes (or Space). Esc to clear.',
  needs: ['key', 'mouse'],
  create(emit, ctx) {
    let mouse: Pt | null = null;
    return {
      on(s) {
        if (s.kind === 'mouse') mouse = s.at;
        keysAndMouse(s, emit, ctx, { fireAt: () => mouse, menuAt: () => mouse });
      },
    };
  },
};
