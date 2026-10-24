// The hand cursor works the menus: hovering a button with the fingertip lights it like the mouse
// does (snapping to the nearest button within a small radius), and the fire action (a pinch, or
// Space) clicks it, with the same squish and sound. MENU_DWELL turns on clicking by resting on a
// button for a second; off, since a pinch is the one way to click.
//
// Everything that clicks a menu goes through activateUi(), so a future fire gesture only has to
// call that. In a match, only the corner tools (pause, sound, help) take the hand; the deploy
// gesture is left alone.
import { blip } from '../react';
import { boxDistance, Dwell, nearestBox, SNAP_PX, type Box } from './menupick';
import type { Pt } from './trail';

export const MENU_DWELL = false; // true turns on dwell-to-click
export const DWELL_MS = 1000;

const TARGETS = 'button:not(:disabled), input[type=checkbox]:not(:disabled)';
const MATCH_TARGETS = '#tools button:not(:disabled)'; // all the hand can reach mid-match
// Dialogs over a match: while one is open the hand works menus, not the board.
const DIALOGS = ['pause', 'forfeitAsk', 'tutorial', 'setup', 'raven'];
const PRESS_MS = 140;

const shown = (id: string) => {
  const el = document.getElementById(id);
  return !!el && !el.hidden;
};

// True when the hand should work menus rather than aim troops.
export function menuMode(playing: boolean): boolean {
  return !playing || DIALOGS.some(shown);
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cv = (el as HTMLElement).checkVisibility;
  return cv ? cv.call(el, { checkOpacity: true, checkVisibilityCSS: true } as CheckVisibilityOptions) : true;
}

// Not covered by something on top (another screen, a dialog's backdrop): hit-test its middle.
function onTop(el: Element, r: DOMRect): boolean {
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!top) return false;
  return el === top || el.contains(top) || !!top.closest('label')?.contains(el);
}

// The button the cursor is on: the one under it, or the nearest within SNAP_PX.
export function targetAt(at: Pt, inMatch = false): HTMLElement | null {
  const sel = inMatch ? MATCH_TARGETS : TARGETS;
  const hit = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>(sel);
  if (hit && visible(hit) && (!inMatch || hit.matches(sel))) return hit;
  const near: HTMLElement[] = [], boxes: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const r = el.getBoundingClientRect();
    if (boxDistance(at.x, at.y, r) > SNAP_PX || !visible(el) || !onTop(el, r)) continue;
    near.push(el);
    boxes.push(r);
  }
  const i = nearestBox(at.x, at.y, boxes);
  return i < 0 ? null : near[i];
}

// What Space falls back on with nothing under the cursor: a focused button, else the screen's main
// one (marked data-primary in index.html), whichever isn't covered.
function fallbackTarget(): HTMLElement | null {
  const f = document.activeElement;
  if (f instanceof HTMLElement && f.matches(TARGETS) && visible(f)) return f;
  for (const el of document.querySelectorAll<HTMLElement>('[data-primary]')) {
    if (el.matches(TARGETS) && visible(el) && onTop(el, el.getBoundingClientRect())) return el;
  }
  return null;
}

// The button the mouse is over, if any (the browser already shows its hover).
function mouseTarget(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`:is(${TARGETS}):hover`);
  return all.length ? all[all.length - 1] : null;
}

// Click el as a press would: the squish (CSS .handPress, dropped under reduced motion like
// :active), the press tick (react.ts listens for pointerdown), then the click itself.
function press(el: HTMLElement, at: Pt | null): void {
  const r = el.getBoundingClientRect();
  const x = at?.x ?? r.left + r.width / 2, y = at?.y ?? r.top + r.height / 2;
  el.classList.add('handPress');
  setTimeout(() => el.classList.remove('handPress'), PRESS_MS);
  const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, pointerType: 'pen', isPrimary: true };
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
  } catch {
    blip('press'); // no PointerEvent constructor: at least the tick
  }
  el.click();
}

// Hover state and dwell for the hand cursor, updated every frame by the controller.
class MenuPointer {
  hovered: HTMLElement | null = null;
  private dwell = new Dwell<HTMLElement>(DWELL_MS);
  private dwellOn = false; // dwell applies to what's hovered (menus, or the corner tools mid-match)

  update(now: number, hand: Pt | null, playing: boolean): void {
    const menus = menuMode(playing);
    const t = hand ? targetAt(hand, !menus) : null;
    if (t !== this.hovered) {
      this.hovered?.classList.remove('handHover');
      t?.classList.add('handHover');
      if (t) blip('hover');
      this.hovered = t;
    }
    this.dwellOn = MENU_DWELL && !!t;
    if (!MENU_DWELL) return;
    const done = this.dwell.update(now, t);
    if (done) {
      if (document.contains(done)) press(done, hand);
    }
  }

  dwellProgress(now: number): number {
    return this.dwellOn ? this.dwell.progress(now) : 0;
  }

  // A pinch or Space clicked the hovered button: don't dwell-click it as well.
  spend(): void {
    this.dwell.spend();
  }
}

export const menuPointer = new MenuPointer();

// Click whatever menu element is at `at` (snapping to the nearest within reach). With `fallback`
// (Space), use the button under the mouse, the focused one or the screen's main one when there's
// nothing at `at`. True if something was clicked. The one entry point for menu activation, so a
// future fire gesture can call it too.
export function activateUi(at: Pt | null, opts: { fallback?: boolean; playing?: boolean } = {}): boolean {
  const inMatch = !menuMode(opts.playing ?? false);
  let t = at ? targetAt(at, inMatch) : null;
  if (!t && opts.fallback) t = mouseTarget() ?? (inMatch ? null : fallbackTarget());
  if (!t) return false;
  if (t === menuPointer.hovered) menuPointer.spend();
  press(t, at);
  return true;
}

// Esc goes back: close the dialog on top, or leave the result screen. The pause menu and the
// how-to card handle Esc themselves.
export function menuBack(): boolean {
  if (shown('tutorial') || shown('pause')) return false;
  const click = (sel: string) => {
    const b = document.querySelector<HTMLElement>(sel);
    if (!b) return false;
    press(b, null);
    return true;
  };
  if (shown('setup')) return click('#setup [data-act="skip"]');
  if (shown('forfeitAsk')) return click('#keepBtn');
  if (shown('raven')) return click('#ravenClose');
  if (shown('result')) return click('#lobbyBtn');
  return false;
}
