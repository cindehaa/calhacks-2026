// Point-and-pinch practice, the last part of setup. It starts by fitting the pinch to this
// player's hand: a second pointing as they would to aim, then a pinch held, and the thresholds go
// between the two (pose.ts fitPinch), since a pinch tuned to one hand misses on others. The ⋯
// menu's "Fit pinch to my hand" runs that part alone. Then three targets across the screen, one at a
// time; pinch, move onto each and let go to hit it. Only a real pinch counts (not the mouse or Space), so
// finishing shows the camera can see you aim and pinch. A meter shows how close thumb and finger
// are, and pinches that almost close (nearmiss.ts) get told to close all the way. Skip any time.
import type { InputController } from './input/controller';
import { pinchArt } from './input/handart';
import { NearMiss } from './input/nearmiss';
import { fitPinch, median, PINCH_RANGE } from './input/pose';
import type { Pt } from './input/trail';
import { sfx } from './sfx';
import { logEvent } from './telemetry';

const DONE_KEY = 'arena.handPracticeDone';
// Where the targets sit, as fractions of the screen: upper left, right, lower middle, so aiming
// covers most of the range a match needs.
const SPOTS: [number, number][] = [[0.24, 0.42], [0.76, 0.5], [0.5, 0.74]];
const REACH = 70; // px from a target's middle that counts as on it
const OPEN = 0.95; // the meter is empty from this ratio up (or a little past the release line), full at the pinch line
const POINT_MS = 1000; // pointing held this long, hand in view throughout
const PINCH_MS = 600; // and the pinch held this long
const PINCH_WAIT_MS = 8000; // no pinch clearly tighter than the pointing hand by now: measure the pointing again

type Phase = 'point' | 'pinch' | 'fitted' | 'targets'; // fitted: fit-only, closing

export function practiceDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1' } catch { return false }
}
function markDone() {
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* private mode */ }
}

export type PracticeEnd = 'done' | 'skipped' | 'fitted';

export function initPractice(input: InputController): { run(o?: { fitOnly?: boolean }): Promise<PracticeEnd> } {
  const el = document.getElementById('handPractice')!;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const field = q('.practiceField'), msg = q('[data-msg]'), count = q('[data-count]'), meter = q('.pinchMeter i');
  const art = q('[data-art="pinch"]'), title = q('#practiceTitle');
  const near = new NearMiss({ count: 2, cooldownMs: 0, maxShows: Infinity });
  let target: HTMLElement | null = null;
  let hits = 0;
  let finish: ((how: PracticeEnd) => void) | null = null;
  let say = ''; // a message holding over the default one until sayUntil
  let sayUntil = 0;
  let seen = false; // a hand frame since the last "no hand"
  let phase: Phase = 'targets';
  let fitOnly = false;
  let samples: number[] = []; // the measure over the hold so far
  let holdFrom = 0; // when the current hold began, 0 while not holding
  let phaseAt = 0;
  let pointing = 0; // the measure with the hand pointing, once taken

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
    title.textContent = phase === 'targets' ? 'Practice: point and pinch' : 'Fit the pinch to your hand';
    if (phase === 'fitted') return void (msg.textContent = 'Pinch fitted to your hand.', count.textContent = '');
    msg.textContent = hits >= SPOTS.length ? 'All three hit. You’re set.'
      : now < sayUntil ? say
      : !seen ? 'Show your hand to the camera.'
      : phase === 'point' ? 'Point at the screen the way you’ll aim, and hold still.'
      : phase === 'pinch' ? 'Now pinch: thumb to any finger, and hold it.'
      : 'Pinch, move onto the target, then let go.';
    count.textContent = phase === 'point' ? '1 of 2' : phase === 'pinch' ? '2 of 2' : `${Math.min(hits + 1, SPOTS.length)} of ${SPOTS.length}`;
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

  function enter(p: Phase) {
    phase = p;
    phaseAt = performance.now();
    samples = [];
    holdFrom = 0;
    render();
  }

  // One hand frame while fitting. A hold restarts if the hand leaves or, for the pinch, opens.
  function fitFrame(t: number, r: number | null) {
    const holding = r !== null && (phase === 'point' || r < pointing - PINCH_RANGE.minGap);
    if (!holding) {
      holdFrom = 0;
      samples = [];
      if (phase === 'pinch' && t - phaseAt > PINCH_WAIT_MS) {
        enter('point');
        tell('Let’s measure again. Point with your thumb up, away from your other fingers.', 4000);
      }
      return;
    }
    if (!holdFrom) holdFrom = t;
    samples.push(r);
    if (t - holdFrom < (phase === 'point' ? POINT_MS : PINCH_MS)) return;
    if (phase === 'point') {
      pointing = median(samples);
      return enter('pinch');
    }
    const pinched = median(samples), fit = fitPinch(pointing, pinched);
    if (!fit) {
      enter('point');
      return tell('Those looked too alike. Let’s try again.', 3000);
    }
    input.setPinch(fit);
    near.fit(fit);
    logEvent('practice:fit', `on ${fit.on} off ${fit.off} (pointing ${pointing.toFixed(2)}, pinched ${pinched.toFixed(2)})`);
    sfx.play('chime');
    if (fitOnly) {
      enter('fitted');
      setTimeout(() => end('fitted'), 900);
      return;
    }
    enter('targets');
    tell('Fitted to your hand. Now hit the targets.', 2500);
    setTimeout(place, 600);
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
      const { on: shut, off } = input.pinchThresholds, empty = Math.max(OPEN, off + 0.15);
      const full = r === null ? 0 : Math.max(0, Math.min(1, (empty - r) / (empty - shut)));
      meter.style.width = `${full * 100}%`;
      meter.classList.toggle('shut', s.pinched);
      if (phase !== 'targets') {
        if (phase !== 'fitted') fitFrame(s.t, r);
        return render();
      }
      if (near.push(s.t, r, true)) {
        tell('Almost. Touch your thumb all the way to a finger.', 3500);
        art.classList.remove('nudge');
        void art.offsetWidth;
        art.classList.add('nudge');
      }
      render();
    } else if (s.kind === 'release' && phase === 'targets') {
      if (target && on(target, s.aim)) hit(target);
      else if (target) {
        sfx.play('miss');
        tell('Let go while the cursor is on the target.', 2000);
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
    run(o = {}) {
      finish?.('skipped');
      fitOnly = !!o.fitOnly;
      q('[data-act="skip"]').textContent = fitOnly ? 'Cancel' : 'Skip practice';
      art.innerHTML = pinchArt();
      hits = 0;
      seen = input.pinchRatio() !== null;
      say = '';
      sayUntil = 0;
      near.fit(input.pinchThresholds);
      near.reset();
      field.replaceChildren();
      el.hidden = false;
      logEvent(fitOnly ? 'practice:fit-start' : 'practice:start');
      enter('point');
      return new Promise(res => (finish = res));
    },
  };
}
