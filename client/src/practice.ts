// Point-and-pinch practice, the last part of setup: three targets across the screen, one at a
// time; point at each and pinch to hit it. Only a real pinch counts (not the mouse or Space), so
// finishing shows the camera can see you aim and pinch. A meter shows how close thumb and finger
// are, and pinches that almost close (nearmiss.ts) get told to close all the way. Skip any time.
import type { InputController } from './input/controller';
import { pinchArt } from './input/handart';
import { NearMiss } from './input/nearmiss';
import { PINCH_DEFAULTS } from './input/pose';
import type { Pt } from './input/trail';
import { sfx } from './sfx';
import { logEvent } from './telemetry';

const DONE_KEY = 'arena.handPracticeDone';
// Where the targets sit, as fractions of the screen: upper left, right, lower middle, so aiming
// covers most of the range a match needs.
const SPOTS: [number, number][] = [[0.24, 0.42], [0.76, 0.5], [0.5, 0.74]];
const REACH = 70; // px from a target's middle that counts as on it
const OPEN = 0.95; // the meter is empty from this ratio up, full at PINCH_DEFAULTS.on

export function practiceDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1' } catch { return false }
}
function markDone() {
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* private mode */ }
}

export type PracticeEnd = 'done' | 'skipped';

export function initPractice(input: InputController): { run(): Promise<PracticeEnd> } {
  const el = document.getElementById('handPractice')!;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const field = q('.practiceField'), msg = q('[data-msg]'), count = q('[data-count]'), meter = q('.pinchMeter i');
  const art = q('[data-art="pinch"]');
  const near = new NearMiss({ count: 2, cooldownMs: 0, maxShows: Infinity });
  let target: HTMLElement | null = null;
  let hits = 0;
  let finish: ((how: PracticeEnd) => void) | null = null;
  let say = ''; // a message holding over the default one until sayUntil
  let sayUntil = 0;
  let seen = false; // a hand frame since the last "no hand"

  const center = (t: HTMLElement): Pt => {
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const on = (t: HTMLElement | null, p: Pt) => !!t && Math.hypot(p.x - center(t).x, p.y - center(t).y) <= REACH;

  function tell(text: string, ms: number) {
    say = text;
    sayUntil = performance.now() + ms;
    render();
  }

  function render() {
    const now = performance.now();
    msg.textContent = hits >= SPOTS.length ? 'All three hit. You’re set.'
      : now < sayUntil ? say
      : !seen ? 'Show your hand to the camera.'
      : 'Point at the target, then touch your thumb to any finger.';
    count.textContent = `${Math.min(hits + 1, SPOTS.length)} of ${SPOTS.length}`;
  }

  function place() {
    target?.remove();
    target = null;
    if (hits >= SPOTS.length) return;
    const [fx, fy] = SPOTS[hits];
    const t = document.createElement('div');
    t.className = 'pTarget';
    t.style.left = `${fx * 100}%`;
    t.style.top = `${fy * 100}%`;
    t.innerHTML = '<i></i>';
    field.appendChild(t);
    target = t;
  }

  function hit(t: HTMLElement) {
    hits++;
    t.classList.add('hit');
    target = null;
    setTimeout(() => t.remove(), 420);
    sfx.play(hits >= SPOTS.length ? 'shimmer' : 'chime');
    logEvent(`practice:hit${hits}`);
    render();
    if (hits >= SPOTS.length) {
      markDone();
      setTimeout(() => end('done'), 1100);
    } else setTimeout(place, 260);
  }

  function end(how: PracticeEnd) {
    if (!finish) return;
    logEvent(`practice:${how}`);
    el.hidden = true;
    target?.remove();
    target = null;
    const f = finish;
    finish = null;
    f(how);
  }

  input.listeners.signal.push(s => {
    if (!finish) return;
    if (s.kind === 'hand') {
      if (!s.visible) {
        seen = false;
        target?.classList.remove('on');
        meter.style.width = '0%';
        near.push(s.t, null, false);
        return render();
      }
      seen = true;
      target?.classList.toggle('on', on(target, s.cursor));
      const r = input.pinchRatio();
      const full = r === null ? 0 : Math.max(0, Math.min(1, (OPEN - r) / (OPEN - PINCH_DEFAULTS.on)));
      meter.style.width = `${full * 100}%`;
      meter.classList.toggle('shut', s.pinched);
      if (near.push(s.t, r, true)) {
        tell('Almost. Touch your thumb all the way to a finger.', 3500);
        art.classList.remove('nudge');
        void art.offsetWidth;
        art.classList.add('nudge');
      }
      render();
    } else if (s.kind === 'pinch') {
      if (target && on(target, s.aim)) hit(target);
      else if (target) {
        sfx.play('miss');
        tell('Pinch while the cursor is on the target.', 2000);
      }
    }
  });

  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (b?.dataset.act === 'skip') {
      b.blur();
      end('skipped');
    }
  });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && finish) end('skipped');
  });

  return {
    run() {
      finish?.('skipped');
      art.innerHTML = pinchArt();
      hits = 0;
      seen = input.pinchRatio() !== null;
      say = '';
      sayUntil = 0;
      near.reset();
      field.replaceChildren();
      el.hidden = false;
      logEvent('practice:start');
      place();
      render();
      return new Promise(res => (finish = res));
    },
  };
}
