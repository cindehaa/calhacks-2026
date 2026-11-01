// Home's "How it works": after a while on the home screen with nothing happening (no mouse, key,
// touch or hand moving), a small card with the whole move on a loop (handart.ts loopArt) fades in
// above the buttons. Anything at all hides it and starts the wait over. For someone walking up to
// a laptop left on the home screen, and for anyone who skipped setup.
import { loopArt } from './input/handart';
import type { Pt } from './input/trail';

const IDLE_MS = 20_000;
const HAND_MOVE_PX = 40; // the hand moving this far counts as activity

export function initHowItWorks(handPoint: () => Pt | null): void {
  const el = document.getElementById('howItWorks'), lobby = document.getElementById('lobby');
  if (!el || !lobby) return;
  el.querySelector('[data-art="loop"]')!.innerHTML = loopArt();
  let lastActive = performance.now();
  let hand: Pt | null = null;
  const active = () => {
    lastActive = performance.now();
    el.hidden = true;
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(ev, active, { passive: true });
  setInterval(() => {
    const p = handPoint();
    if (p && (!hand || Math.hypot(p.x - hand.x, p.y - hand.y) > HAND_MOVE_PX)) {
      hand = p;
      active();
    }
    // Only on home itself, with no dialog over it.
    const home = !lobby.hidden && !document.querySelector('.overlay:not([hidden])');
    if (!home) lastActive = performance.now();
    el.hidden = !home || performance.now() - lastActive < IDLE_MS;
  }, 250);
}
