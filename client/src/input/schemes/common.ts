// Space fires (or clicks a menu), Esc clears, a click on the board with words waiting fires there,
// and the deploys still pending (cancel refunds them).
import type { Intent, Pt, SchemeCtx, Signal } from './types';

type Emit = (i: Intent) => boolean | void;

// Space, Esc and the mouse, as today. True if the signal was one of them.
export function keysAndMouse(s: Signal, emit: Emit, ctx: SchemeCtx, o: { menuAt?: () => Pt | null } = {}): boolean {
  if (s.kind === 'key') {
    if (s.key === 'Escape') emit({ kind: 'clear', why: 'key' });
    else if (!s.repeat) {
      if (ctx.menus()) emit({ kind: 'uiActivate', at: o.menuAt ? o.menuAt() : null, fallback: true });
      else {
        const at = ctx.cursor();
        if (at) emit({ kind: 'commit', t: s.t, by: 'key', at });
      }
    }
    return true;
  }
  if (s.kind === 'mouse') {
    if (s.phase === 'down' && ctx.waiting()) emit({ kind: 'commit', t: s.t, by: 'mouse', at: s.at });
    return true;
  }
  return false;
}

// Nonces between begin_deploy and deploy_troop: what a cancel can still take back for free.
export class Pending {
  private set = new Set<number>();
  on(s: Signal): void {
    if (s.kind !== 'deploy') return;
    if (s.phase === 'pending') this.set.add(s.nonce);
    else this.set.delete(s.nonce);
  }
  get any(): boolean {
    return this.set.size > 0;
  }
}
