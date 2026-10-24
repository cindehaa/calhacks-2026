// The controls. The mic always listens; the index fingertip aims, and touching the thumb to the
// middle or index finger fires whatever was said, aimed from ~100 ms before the pinch closed. A
// thumbs down takes back a troop still being summoned, refunded; "cancel" or Esc too, and Esc also
// clears the words. On menus a pinch clicks.
//
// Thumbs down replaced a fist, which misfired: curling the fingers into a pinch looks like one. It
// is gated so a pinch can never trigger it: only while a drop is pending, only once the score has
// held THUMB_DOWN.score for THUMB_DOWN.holdMs, never while pinched, and never within
// THUMB_DOWN.afterPinchMs of a pinch closing.
import { keysAndMouse, Pending } from './common';
import type { Pt, Scheme } from './types';

export const THUMB_DOWN = { score: 0.7, holdMs: 250, afterPinchMs: 400 };

export const pinch: Scheme = {
  id: 'pinch',
  name: 'Pinch',
  howTo: 'Point, say it, pinch to summon. Thumbs down to cancel.',
  needs: ['hand', 'pinch', 'words', 'deploy', 'key', 'mouse'],
  create(emit, ctx) {
    const pending = new Pending();
    let tip: Pt | null = null;
    let pinchAt = -Infinity; // when the last pinch closed
    let wasPinched = false;
    let downSince: number | null = null; // thumbs down held (and allowed) since
    let armed = true; // one cancel per thumbs down: lower the thumb before the next
    return {
      on(s) {
        pending.on(s);
        if (s.kind === 'hand') {
          tip = s.visible ? s.cursor : null;
          if (!s.visible) { downSince = null; armed = true; wasPinched = false; return; }
          if (s.pinched && !wasPinched) pinchAt = s.t;
          wasPinched = s.pinched;
          const score = s.gestures.Thumb_Down;
          if (score < THUMB_DOWN.score) armed = true;
          const allowed = score >= THUMB_DOWN.score && pending.any && !s.pinched && s.t - pinchAt >= THUMB_DOWN.afterPinchMs;
          if (!allowed) { downSince = null; return; }
          downSince ??= s.t;
          if (armed && s.t - downSince >= THUMB_DOWN.holdMs) {
            armed = false;
            emit({ kind: 'cancel', why: 'thumbsDown' });
          }
        } else if (s.kind === 'pinch') {
          pinchAt = s.t;
          downSince = null;
          if (ctx.menus()) emit({ kind: 'uiActivate', at: s.aim });
          else emit({ kind: 'commit', t: s.t, by: 'pinch', at: s.aim });
        } else if (s.kind === 'words') {
          if (s.cancel && pending.any) emit({ kind: 'cancel', why: 'said' });
        } else keysAndMouse(s, emit, ctx, { menuAt: () => tip });
      },
      state: () => (pending.any ? 'summoning' : 'ready'),
    };
  },
};
