// First-visit setup: camera and mic on, a quick voice check. Done or skipped
// once (remembered in localStorage); after that the controller turns the camera and mic back on
// by itself. "Run setup again" in the camera panel's ⋯ menu reopens it.
import type { InputController } from './input/controller';
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
  input.attachPreview(q<HTMLCanvasElement>('.setupCam canvas'));
  let raf = 0;
  let asking = false; // waiting on the browser's permission prompt

  function open(first = false) {
    el.hidden = false;
    q('[data-act="skip"]').textContent = first ? 'Skip, use mouse and keys' : 'Close';
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
  async function turnOn() {
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
    if (act === 'devices') void turnOn();
    else if (act === 'skip') {
      input.setMouseKeys(true);
      close(act);
    } else if (act === 'done') close(act);
  });

  function step(name: string, done: boolean, msg: string) {
    const li = q(`[data-step="${name}"]`);
    li.classList.toggle('done', done);
    li.querySelector('[data-msg]')!.textContent = msg;
  }

  function render() {
    raf = requestAnimationFrame(render);
    const s = input.setupState();
    // The mic is what matters: without a camera, Space or the mouse stands in for the pinch.
    const devicesOk = s.cameraReady && s.mic;
    const starting = s.camera && !s.cameraReady;
    const errors = [s.camStatus, s.micStatus].filter(m => m.includes('failed'));

    step('devices', s.mic,
      asking ? 'allow the camera and mic when the browser asks'
      : starting ? s.camStatus
      : devicesOk ? 'camera and mic are on'
      : s.mic ? `mic is on${errors.length ? ` (${errors.join(' · ')})` : ', no camera'}: hold Space or the mouse to talk`
      : errors.length ? `${errors.join(' · ')}. Allow them from the address bar, then try again.`
      : 'aim with your hand, speak to summon');
    const dev = q<HTMLButtonElement>('[data-act="devices"]');
    dev.hidden = devicesOk;
    dev.disabled = asking || starting;
    dev.textContent = s.mic ? 'Try camera' : errors.length ? 'Try again' : 'Turn on';

    step('voice', s.heardWords,
      !s.mic ? 'checks the mic hears you'
      : s.heardWords || s.micStatus.startsWith('no speech') ? s.micStatus
      : s.speaking ? 'hearing you…'
      : 'say “hello”');
    const lvl = q('.setupMeter i');
    lvl.style.width = `${s.mic ? Math.max(0, Math.min(100, ((s.level + 90) / 90) * 100)) : 0}%`;
    lvl.classList.toggle('speaking', s.speaking);

    q('.setupHint').textContent = !s.camera ? 'camera off' : starting ? s.camStatus : s.hand ? '' : 'show your hand';
    q<HTMLButtonElement>('[data-act="done"]').disabled = !s.mic || starting;
  }

  input.onSetup = () => open();
  return { open: () => open(true) };
}
