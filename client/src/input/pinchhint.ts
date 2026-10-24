// The in-match pinch guide: when pinches keep almost closing (nearmiss.ts), a small card next to
// the virtual hand shows how for a few seconds, then fades. It sits in the corner, never over the
// middle of the board, takes no clicks and pauses nothing.
import { pinchArt } from './handart';

const SHOW_MS = 5500;
let el: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showPinchHint(): void {
  if (!el) {
    el = document.createElement('div');
    el.id = 'pinchHint';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="phArt">${pinchArt()}</div><div class="phText"><b>Pinch not closing</b><span>Touch your thumb all the way to your index finger, then let go.</span></div>`;
  el.hidden = false;
  el.classList.remove('in');
  void el.offsetWidth; // restart the entrance
  el.classList.add('in');
  clearTimeout(timer);
  timer = setTimeout(hidePinchHint, SHOW_MS);
}

export function hidePinchHint(): void {
  clearTimeout(timer);
  if (el) el.hidden = true;
}
