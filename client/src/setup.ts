// First-visit setup: camera and mic on, a quick voice check, then how to pinch, move and let go, with a
// short practice (practice.ts). Done or skipped once (remembered in localStorage); after that the
// controller turns the camera and mic back on by itself. "Run setup again" in the camera panel's
// ⋯ menu reopens it.
import { TOUCH, type InputController } from './input/controller';
import { pinchArt, pointArt } from './input/handart';
import { initPractice, practiceDone } from './practice';
import { logEvent } from './telemetry';

const DONE_KEY = 'arena.setupDone';

export function setupDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1' } catch { return false }
}
function markDone() {
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* private mode */ }
}

export function initSetup(input: InputController, onClose: () => void): { open(): void } {
  const el = document.getElementById('setup')!;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  input.attachPreview(q<HTMLCanvasElement>('.setupCam canvas'), { c: q<HTMLCanvasElement>('.setupSeen canvas'), label: q('[data-seen]') });
  // Which hand aims (the other may be holding the mic), as three big buttons: remembered with the
  // input prefs. Either: the game picks (handpick.ts).
  const markHand = () => el.querySelectorAll<HTMLButtonElement>('[data-hand]').forEach(b => {
    const on = b.dataset.hand === input.handPref;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  markHand();
  let raf = 0;
  let asking = false; // waiting on the browser's permission prompt
  let movedOn = false; // the voice check passed and practice opened by itself, this time setup is open
  const practice = initPractice(input);

  // Practice, then back to setup; from "Let's play" (then: true), on into the game after it.
  async function runPractice(then: boolean) {
    cancelAnimationFrame(raf);
    const how = await practice.run();
    if (then) close(`done:practice-${how}`);
    else render();
  }

  function open(first = false) {
    el.hidden = false;
    input.resetVoiceCheck();
    movedOn = false;
    q('[data-art="point"]').innerHTML = pointArt();
    q('[data-art="pinch"]').innerHTML = pinchArt();
    q('[data-act="skip"]').textContent = !first ? 'Close' : TOUCH ? 'Skip, I’ll type' : 'Skip, use mouse and keys';
    cancelAnimationFrame(raf);
    render();
  }

  function close(how: string) {
    logEvent(`setup:${how}`);
    el.hidden = true;
    cancelAnimationFrame(raf);
    markDone();
    onClose();
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
      close(act);
    } else if (act === 'practice') void runPractice(false);
    else if (act === 'done') {
      // First time with the camera working: a quick practice before the game.
      if (input.setupState().cameraReady && !practiceDone()) void runPractice(true);
      else close(act);
    }
  });

  function step(name: string, done: boolean, msg: string) {
    const li = q(`[data-step="${name}"]`);
    li.classList.toggle('done', done);
    li.querySelector('[data-msg]')!.textContent = msg;
  }

  function render() {
    raf = requestAnimationFrame(render);
    const s = input.setupState();
    // The mic is what matters: without a camera, Space or a click stands in for the pinch.
    const devicesOk = s.cameraReady && s.mic;
    const starting = s.camera && !s.cameraReady;
    const errors = [s.camStatus, s.micStatus].filter(m => m.includes('failed'));

    step('devices', s.mic,
      asking ? 'allow the camera and mic when the browser asks'
      : starting ? s.camStatus
      : devicesOk ? 'camera and mic are on'
      : TOUCH ? (s.mic ? 'mic is on: say a troop, then hold where it goes and let go' : errors.length ? `${errors.join(' · ')}. Allow it in the browser’s site settings, then try again.` : 'say your troop out loud, then hold where it goes and let go')
      : s.mic ? `mic is on${errors.length ? ` (${errors.join(' · ')})` : ', no camera'}: say a troop, then click or press Space to send it`
      : errors.length ? `${errors.join(' · ')}. Allow them from the address bar, then try again.`
      : 'aim with your hand, say your troop out loud');
    const dev = q<HTMLButtonElement>('[data-act="devices"]');
    dev.hidden = TOUCH ? s.mic : devicesOk;
    dev.disabled = asking || starting;
    dev.textContent = s.mic ? 'Try camera' : errors.length ? 'Try again' : 'Turn on';

    // Any speech passes: the mic works, which is all this checks. Words follow if the recogniser
    // catches them.
    const heard = s.heardWords || s.heardSound;
    step('voice', heard,
      !s.mic ? 'checks the mic hears you'
      : s.heardWords ? s.micStatus
      : heard ? 'heard you'
      : s.speaking ? 'hearing you…'
      : 'say “hello”');
    const lvl = q('.setupMeter i');
    lvl.style.width = `${s.mic ? Math.max(0, Math.min(100, ((s.level + 90) / 90) * 100)) : 0}%`;
    lvl.classList.toggle('speaking', s.speaking);

    const practiced = practiceDone();
    step('hands', practiced,
      !s.cameraReady ? 'No camera? Click or press Space instead of pinching.'
      : practiced ? 'Practice done. Thumbs down cancels a troop.'
      : 'Fit the pinch to your hand (or skip it), then grab three targets. About 20 seconds.');
    const prac = q<HTMLButtonElement>('[data-act="practice"]');
    prac.hidden = !s.cameraReady;
    prac.textContent = practiced ? 'Again' : 'Practice';
    prac.classList.toggle('ghost', practiced);

    // Heard them and the camera's on: straight on to the hand practice.
    if (heard && s.cameraReady && !movedOn) {
      movedOn = true;
      setTimeout(() => { if (!el.hidden) void runPractice(false) }, 700);
    }

    q('.setupHint').textContent = !s.camera ? 'camera off' : starting ? s.camStatus : s.hand ? '' : 'show your hand';
    q<HTMLButtonElement>('[data-act="done"]').disabled = !s.mic || starting;
  }

  if (TOUCH) {
    q('[data-step="devices"] b').textContent = 'Mic';
    q('.setup .sub').textContent = 'Typing always works too.';
  }
  input.onSetup = () => open();
  // The ⋯ menu's "Fit pinch to my hand": just the fitting, over whatever is showing.
  input.onCalibrate = () => void practice.run({ fitOnly: true });
  return { open: () => open(true) };
}
