// First visit: camera and mic on (asked for the moment setup opens), and the hand in frame, with
// live advice from framing.ts and a ghost hand on the camera feed showing where to hold it. Once
// the camera sees a well-placed hand and the mic is on, it moves on by itself to the first summon
// (onboard.ts), which teaches the rest by doing. Done or skipped once (remembered in localStorage);
// after that the controller turns the camera and mic back on by itself. "Run setup again" in the
// ⋯ menu reopens it, first summon and all; the camera button on home opens it just to sort the
// camera out.
import { TOUCH, type InputController } from './input/controller';
import { ADVICE_TEXT } from './input/framing';
import { loopArt } from './input/handart';
import { initPractice } from './practice';
import { logEvent } from './telemetry';

const DONE_KEY = 'arena.setupDone';
const AUTO_MS = 1000; // camera and mic on and the hand well placed this long: on to the first summon

export function setupDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1' } catch { return false }
}
function markDone() {
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* private mode */ }
}

// Where setup leads: the first summon, back to whatever was showing, or (skipped) the how-to card.
export type SetupNext = 'onboard' | 'back' | 'skipped';

export function initSetup(input: InputController, onClose: (next: SetupNext) => void): { open(tour?: boolean): void } {
  const el = document.getElementById('setup')!;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  input.attachPreview(q<HTMLCanvasElement>('.setupCam canvas'), { c: q<HTMLCanvasElement>('.setupSeen canvas'), label: q('[data-seen]') });
  // Which hand aims (the other may be holding the mic), as three buttons: remembered with the
  // input prefs. Either: the game picks (handpick.ts).
  const markHand = () => el.querySelectorAll<HTMLButtonElement>('[data-hand]').forEach(b => {
    const on = b.dataset.hand === input.handPref;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  markHand();
  let raf = 0;
  let asking = false; // waiting on the browser's permission prompt
  let tour = false; // opened as the first visit (or "Run setup again"): on to the first summon after
  let framedAt = 0; // when the hand was last placed well with everything on, 0 if not now
  const practice = initPractice(input);

  function open(asTour = false) {
    el.hidden = false;
    tour = asTour;
    framedAt = 0;
    q('[data-art="loop"]').innerHTML = loopArt();
    q('[data-act="skip"]').textContent = TOUCH ? 'Skip, I’ll type' : 'Skip, use mouse and keys';
    q('[data-act="skip"]').hidden = !tour;
    q('[data-act="done"]').textContent = tour ? 'Continue' : 'Done';
    cancelAnimationFrame(raf);
    render();
    // Entering from the title is a click or a key, so the browser's prompt can come straight up.
    if (tour) {
      logEvent('setup:open');
      const s = input.setupState();
      if (!s.mic || (!TOUCH && !s.camera)) void turnOn();
    }
  }

  function close(how: string) {
    logEvent(`setup:${how}`);
    el.hidden = true;
    cancelAnimationFrame(raf);
    markDone();
    onClose(how === 'skip' ? 'skipped' : tour ? 'onboard' : 'back');
  }

  // One prompt for both instead of two back to back; each device is then started on its own.
  // Phones only get the mic: nobody aims a phone's camera at their own hand.
  async function turnOn() {
    if (TOUCH) return input.setMic(true);
    asking = true;
    try {
      (await navigator.mediaDevices.getUserMedia({ video: true, audio: true })).getTracks().forEach(t => t.stop());
    } catch { /* the per-device starts below report what failed */ }
    asking = false;
    await Promise.all([input.setCamera(true), input.setMic(true)]);
  }

  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    b.blur();
    const act = b.dataset.act;
    if (b.dataset.hand) {
      input.setHandPref(b.dataset.hand as 'auto' | 'left' | 'right');
      markHand();
    } else if (act === 'devices') void turnOn();
    else if (act === 'skip') {
      input.setMouseKeys(true);
      close('skip');
    } else if (act === 'done') close('done');
  });

  function step(name: string, done: boolean, msg: string) {
    const li = q(`[data-step="${name}"]`);
    li.classList.toggle('done', done);
    li.querySelector('[data-msg]')!.textContent = msg;
  }

  function render() {
    raf = requestAnimationFrame(render);
    const s = input.setupState();
    const starting = s.camera && !s.cameraReady;
    const errors = [s.camStatus, s.micStatus].filter(m => m.includes('failed'));

    step('devices', TOUCH ? s.mic : s.cameraReady && s.mic,
      asking ? 'allow the camera and mic when the browser asks'
      : starting ? s.camStatus
      : s.cameraReady && s.mic ? 'camera and mic are on'
      : TOUCH ? (s.mic ? 'mic is on' : errors.length ? `${errors.join(' · ')}. Allow it in the browser’s site settings, then try again.` : 'so you can say your troops')
      : errors.length ? `${errors.join(' · ')}. Allow ${errors.length > 1 ? 'them' : 'it'} from the address bar, then try again.`
      : s.mic ? 'mic is on, no camera: you’ll aim with the mouse'
      : 'aim with your hand, say your troops out loud');
    const dev = q<HTMLButtonElement>('[data-act="devices"]');
    dev.hidden = TOUCH ? s.mic : s.cameraReady && s.mic;
    dev.disabled = asking || starting;
    dev.textContent = s.mic && !s.camera ? 'Try camera' : errors.length ? 'Try again' : 'Turn on';
    const lvl = q('.setupMeter i');
    lvl.style.width = `${s.mic ? Math.max(0, Math.min(100, ((s.level + 90) / 90) * 100)) : 0}%`;
    lvl.classList.toggle('speaking', s.speaking);

    const a = s.framing;
    step('frame', a === 'ok', !s.cameraReady ? 'Once the camera is on, hold up the hand you’ll aim with' : a === 'ok' ? 'Good, the camera can see your hand' : ADVICE_TEXT[a ?? 'none']);

    // Everything on and the hand well placed for a moment: on to the first summon.
    const ready = tour && s.cameraReady && s.mic && a === 'ok';
    framedAt = ready ? framedAt || performance.now() : 0;
    if (ready && performance.now() - framedAt >= AUTO_MS) close('done:auto');

    q('.setupHint').textContent = !s.camera ? 'camera off' : starting ? s.camStatus : a && a !== 'ok' ? ADVICE_TEXT[a] : '';
    q<HTMLButtonElement>('[data-act="done"]').disabled = starting || asking;
  }

  if (TOUCH) {
    q('[data-step="devices"] b').textContent = 'Mic';
    q('.setup .sub').textContent = 'Say your troops out loud. Typing always works too.';
  }
  input.onSetup = () => open(true);
  // The ⋯ menu's "Fit pinch to my hand", and the first summon's "Pinch not working?".
  input.onCalibrate = () => void practice.run();
  return { open };
}
