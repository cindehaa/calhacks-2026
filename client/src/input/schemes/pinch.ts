// The controls. The mic always listens. Pinching (thumb to any finger) picks the troop up; the
// hand aims while it stays pinched, and opening it places whatever was said there, aimed from just
// before the hand began to open (the controller's 'release' signal). Placing on the release reads
// like putting something down, where firing on the close read like a click. On menus the release
// clicks. A thumbs down takes back a troop still being summoned, refunded, and before that clears
// the words said so far; "cancel" or Esc too, and Esc also clears the words. Losing the hand while
// holding places nothing.
//
// Thumbs down replaced a fist, which misfired: curling the fingers into a pinch looks like one. It
// is gated so a pinch can never trigger it: only with a drop pending or words waiting, only once
// the score has held THUMB_DOWN.score for THUMB_DOWN.holdMs, never while pinched, and never within
// THUMB_DOWN.afterPinchMs of a pinch closing.
import { keysAndMouse, Pending } from './common';
import type { Pt, Scheme } from './types';

export const THUMB_DOWN = { score: 0.7, holdMs: 250, afterPinchMs: 400 };

export const pinch: Scheme = {
  id: 'pinch',
  name: 'Pinch',
  howTo: 'Say it, pinch and hold to aim, let go to place. Thumbs down to cancel.',
  needs: ['hand', 'pinch', 'words', 'deploy', 'key', 'mouse'],
  create(emit, ctx) {
    const pending = new Pending();
    let tip: Pt | null = null;
    let pinchAt = -Infinity; // when the last pinch closed
    let wasPinched = false;
    let downSince: number | null = null; // thumbs down held (and allowed) since
    let armed = true; // one cancel per thumbs down: lower the thumb before the next
    let held = false; // pinched, not yet let go
    return {
      on(s) {
        pending.on(s);
        if (s.kind === 'hand') {
          tip = s.visible ? s.cursor : null;
          if (!s.visible) { downSince = null; armed = true; wasPinched = false; held = false; return; }
          if (s.pinched && !wasPinched) pinchAt = s.t;
          wasPinched = s.pinched;
          const score = s.gestures.Thumb_Down;
          if (score < THUMB_DOWN.score) armed = true;
          const something = pending.any || ctx.waiting() !== '';
          const allowed = score >= THUMB_DOWN.score && something && !held && !s.pinched && s.t - pinchAt >= THUMB_DOWN.afterPinchMs;
          if (!allowed) { downSince = null; return; }
          downSince ??= s.t;
          if (armed && s.t - downSince >= THUMB_DOWN.holdMs) {
            armed = false;
            emit(pending.any ? { kind: 'cancel', why: 'thumbsDown' } : { kind: 'clear', why: 'thumbsDown' });
          }
        } else if (s.kind === 'pinch') {
          pinchAt = s.t;
          downSince = null;
          held = true;
        } else if (s.kind === 'release') {
          if (!held) return;
          held = false;
          if (ctx.menus()) emit({ kind: 'uiActivate', at: s.aim });
          else emit({ kind: 'commit', t: s.t, by: 'release', at: s.aim });
        } else if (s.kind === 'words') {
          if (s.cancel && pending.any) emit({ kind: 'cancel', why: 'said' });
        } else keysAndMouse(s, emit, ctx, { menuAt: () => tip });
      },
      state: () => (held ? 'holding' : pending.any ? 'summoning' : 'ready'),
    };
  },
};
