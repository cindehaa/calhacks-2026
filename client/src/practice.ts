// Fitting the pinch to this player's hand by hand: a second pointing as they would to aim, then a
// pinch held; the thresholds go between the two (pose.ts fitPinch). Most players never need it:
// autofit.ts fits the pinch from how they pinch while playing. This is the ⋯ menu's "Fit pinch to
// my hand", and the first summon's "Pinch not working?" (onboard.ts). A meter shows how close
// thumb and finger are. Cancel any time.
import type { InputController } from './input/controller';
import { pinchArt, pointArt } from './input/handart';
import { fitPinch, median, PINCH_RANGE } from './input/pose';
import { sfx } from './sfx';
import { logEvent } from './telemetry';

const POINT_MS = 1000; // pointing held this long, hand in view throughout
const PINCH_MS = 600; // and the pinch held this long
const PINCH_WAIT_MS = 8000; // no pinch clearly tighter than the pointing hand by now: measure the pointing again

type Phase = 'point' | 'pinch' | 'fitted';

export type PracticeEnd = 'fitted' | 'skipped';

export function initPractice(input: InputController): { run(): Promise<PracticeEnd> } {
  const el = document.getElementById('handPractice')!;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const msg = q('[data-msg]'), count = q('[data-count]'), meter = q('.pinchMeter i'), art = q('[data-art="pinch"]');
  let finish: ((how: PracticeEnd) => void) | null = null;
  let say = ''; // a message holding over the default one until sayUntil
  let sayUntil = 0;
  let seen = false; // a hand frame since the last "no hand"
  let phase: Phase = 'point';
  let samples: number[] = []; // the measure over the hold so far
  let holdFrom = 0; // when the current hold began, 0 while not holding
  let phaseAt = 0;
  let pointing = 0; // the measure with the hand pointing, once taken

  function tell(text: string, ms: number) {
    say = text;
    sayUntil = performance.now() + ms;
    render();
  }

  function render() {
    if (phase === 'fitted') return void (msg.textContent = 'Pinch fitted to your hand.', count.textContent = '');
    msg.textContent = performance.now() < sayUntil ? say
      : !seen ? 'Show your hand to the camera.'
      : phase === 'point' ? 'Point at the screen the way you’ll aim, and hold still.'
      : 'Now pinch: thumb to any finger, and hold it.';
    count.textContent = phase === 'point' ? '1 of 2' : '2 of 2';
  }

  function enter(p: Phase) {
    phase = p;
    phaseAt = performance.now();
    samples = [];
    holdFrom = 0;
    art.innerHTML = p === 'point' ? pointArt() : pinchArt();
    render();
  }

  // One hand frame. A hold restarts if the hand leaves or, for the pinch, opens.
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
    logEvent('practice:fit', `on ${fit.on} off ${fit.off} (pointing ${pointing.toFixed(2)}, pinched ${pinched.toFixed(2)})`);
    sfx.play('chime');
    enter('fitted');
    setTimeout(() => end('fitted'), 900);
  }

  function end(how: PracticeEnd) {
    if (!finish) return;
    logEvent(`practice:${how}`);
    el.hidden = true;
    const f = finish;
    finish = null;
    f(how);
  }

  input.listeners.signal.push(s => {
    if (!finish || s.kind !== 'hand') return;
    if (!s.visible) {
      seen = false;
      meter.style.width = '0%';
      return render();
    }
    seen = true;
    meter.style.width = `${input.pinchProgress() * 100}%`;
    meter.classList.toggle('shut', s.pinched);
    if (phase !== 'fitted') fitFrame(s.t, input.pinchRatio());
    render();
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
      seen = input.pinchRatio() !== null;
      say = '';
      sayUntil = 0;
      el.hidden = false;
      logEvent('practice:fit-start');
      enter('point');
      return new Promise(res => (finish = res));
    },
  };
}
