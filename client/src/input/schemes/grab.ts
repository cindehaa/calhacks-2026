// Hold and let go, the prototype alternative to pinch.ts: pinch closes to pick the troop up, the
// hand aims while it stays closed, and opening it places the troop there. Placing on release
// reads like putting something down, where firing on the close read like a click.
//
// Opening only counts after GRAB.openMs, so a frame or two of the pinch measure flickering open
// mid-drag doesn't drop early, and the troop lands where the hand was GRAB.aimBackMs before it
// started to open, since spreading thumb and finger moves the aim point. Losing the hand while
// holding places nothing. Menus still click on the close. Thumbs down works as in pinch.ts while
// nothing is held.
import { keysAndMouse, Pending } from './common';
import { THUMB_DOWN } from './pinch';
import type { Pt, Scheme } from './types';

export const GRAB = { openMs: 80, aimBackMs: 100, trailMs: 400 };

export const grab: Scheme = {
  id: 'grab',
  name: 'Hold and let go',
  howTo: 'Say it, pinch and hold to aim, let go to place. Thumbs down to cancel.',
  needs: ['hand', 'pinch', 'words', 'deploy', 'key', 'mouse'],
  create(emit, ctx) {
    const pending = new Pending();
    let tip: Pt | null = null;
    let held = false; // picked up by a pinch, not yet placed
    let openSince: number | null = null; // the held hand has read open since
    let trail: { t: number; p: Pt }[] = [];
    let pinchAt = -Infinity;
    let wasPinched = false;
    let downSince: number | null = null;
    let armed = true;
    const aimAt = (t: number): Pt | null => {
      let best: Pt | null = null;
      for (const s of trail) if (s.t <= t) best = s.p;
      return best ?? trail[0]?.p ?? null;
    };
    return {
      on(s) {
        pending.on(s);
        if (s.kind === 'hand') {
          tip = s.visible ? s.cursor : null;
          if (!s.visible) { held = false; openSince = null; trail = []; downSince = null; armed = true; wasPinched = false; return; }
          trail.push({ t: s.t, p: s.cursor });
          trail = trail.filter(x => s.t - x.t <= GRAB.trailMs);
          if (s.pinched && !wasPinched) pinchAt = s.t;
          wasPinched = s.pinched;
          if (held) {
            if (s.pinched) openSince = null;
            else {
              openSince ??= s.t;
              if (s.t - openSince >= GRAB.openMs) {
                held = false;
                const at = aimAt(openSince - GRAB.aimBackMs) ?? s.cursor;
                openSince = null;
                emit({ kind: 'commit', t: s.t, by: 'release', at });
              }
            }
            return;
          }
          const score = s.gestures.Thumb_Down;
          if (score < THUMB_DOWN.score) armed = true;
          const something = pending.any || ctx.waiting() !== '';
          const allowed = score >= THUMB_DOWN.score && something && !s.pinched && s.t - pinchAt >= THUMB_DOWN.afterPinchMs;
          if (!allowed) { downSince = null; return; }
          downSince ??= s.t;
          if (armed && s.t - downSince >= THUMB_DOWN.holdMs) {
            armed = false;
            emit(pending.any ? { kind: 'cancel', why: 'thumbsDown' } : { kind: 'clear', why: 'thumbsDown' });
          }
        } else if (s.kind === 'pinch') {
          pinchAt = s.t;
          downSince = null;
          if (ctx.menus()) emit({ kind: 'uiActivate', at: s.aim });
          else if (ctx.playing()) { held = true; openSince = null; }
        } else if (s.kind === 'words') {
          if (s.cancel && pending.any) emit({ kind: 'cancel', why: 'said' });
        } else keysAndMouse(s, emit, ctx, { menuAt: () => tip });
      },
      state: () => (held ? 'holding' : pending.any ? 'summoning' : 'ready'),
    };
  },
};
