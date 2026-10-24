// The post-match "Controls felt: 👍 / 👎", for A/B comparing control schemes. Answer by clicking,
// resting the hand cursor on a button (the menus' dwell), or saying "good" or "bad". Logged with
// the scheme; asked once per round, and it goes when the result screen does.
import type { InputController } from './input/controller';
import { logControlsFeedback } from './telemetry';

const GOOD = /^(good|great|yes|thumbs up|nice|fine|ok(ay)?)$/i;
const BAD = /^(bad|no|thumbs down|awful|terrible|hard)$/i;

export function initControlsFeedback(input: InputController): { ask(): void } {
  const el = document.createElement('div');
  el.id = 'controlsFeedback';
  el.hidden = true;
  el.innerHTML = `<span>Controls felt:</span><button data-v="up" aria-label="Good">👍</button><button data-v="down" aria-label="Bad">👎</button><span class="cfThanks" hidden>thanks!</span>`;
  const style = document.createElement('style');
  style.textContent = `
    #controlsFeedback { position: relative; align-self: center;
      display: flex; gap: 10px; align-items: center; padding: 8px 14px; border-radius: 14px;
      background: rgba(20, 16, 12, 0.82); color: #f5ead6; font: 600 15px/1.2 system-ui, sans-serif; }
    #controlsFeedback button { font-size: 22px; min-width: 54px; min-height: 44px; border-radius: 10px; cursor: pointer; }
    #controlsFeedback[data-done] button { opacity: 0.45; }
    #controlsFeedback[hidden] { display: none; }`;
  document.head.appendChild(style);
  // Part of the result screen's layout, under its buttons, so it can never float over another screen.
  const col = document.querySelector('#result .resultCol');
  (col ?? document.getElementById('result') ?? document.body).appendChild(el);
  let open = false;

  const answer = (good: boolean, how: string) => {
    if (!open) return;
    open = false;
    logControlsFeedback(input.scheme.id, good, how);
    el.dataset.done = '1';
    el.querySelector<HTMLElement>('.cfThanks')!.hidden = false;
    setTimeout(() => (el.hidden = true), 1200);
  };
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    // A hand press dispatches a pen pointer; mark it so the logs can tell dwell/flick from a click.
    if (b) answer(b.dataset.v === 'up', b.classList.contains('handPress') ? 'hand' : 'click');
  });
  input.listeners.signal.push(s => {
    if (!open || s.kind !== 'words') return;
    const t = s.text.trim().replace(/[.,!?]/g, '');
    if (GOOD.test(t)) answer(true, 'voice');
    else if (BAD.test(t)) answer(false, 'voice');
  });
  // Gone with the result screen (it lives inside it, but closing it also ends the question).
  const watch = () => {
    if (open && document.getElementById('result')?.hidden) {
      el.hidden = true;
      open = false;
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);

  return {
    ask() {
      open = true;
      delete el.dataset.done;
      el.querySelector<HTMLElement>('.cfThanks')!.hidden = true;
      el.hidden = false;
    },
  };
}
