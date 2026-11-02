// First-time how-to-play card. Shows once (remembered in localStorage) after the setup screen,
// closes itself after 10 s or when the match starts, and the "?" button or key reopens it.

import { TOUCH } from './input/controller';
import { loopArt, pinchArt, pointArt, sayArt } from './input/handart';

const SEEN_KEY = 'arena.tutorialSeen';
const SHOW_MS = 10_000;

const el = document.getElementById('tutorial');
const timer = el?.querySelector<HTMLElement>('.tutTimer');
let closeAt = 0;
let tick = 0;

function seen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* private mode */ }
}

function open(auto: boolean) {
  if (!el) return;
  el.hidden = false;
  const art: Record<string, () => string> = { say: sayArt, point: pointArt, pinch: pinchArt, loop: loopArt };
  el.querySelectorAll<HTMLElement>('[data-art]').forEach(a => { a.innerHTML = art[a.dataset.art!]?.() ?? '' });
  clearTimeout(tick);
  timer?.classList.remove('run');
  if (auto) {
    void timer?.offsetWidth; // restart the drain animation
    timer?.classList.add('run');
    tick = window.setTimeout(close, SHOW_MS);
    closeAt = performance.now() + SHOW_MS;
  }
}

function close() {
  if (!el) return;
  el.hidden = true;
  clearTimeout(tick);
  markSeen();
}

// Phones: say or type, then tap. No hands, no keys.
if (el && TOUCH) {
  const steps = el.querySelectorAll('ol li span:last-child');
  steps[0].innerHTML = '<b>Say</b> a troop with the mic, or <b>type</b> one, like “wizard with fire”.';
  steps[1].innerHTML = '<b>Hold</b> your half, drag to aim, <b>let go</b> to place. It costs <b>embers</b>.';
  el.querySelector('p.sub')!.textContent = 'Wrong troop? Say “cancel” before it lands.';
  // The camera is optional on a phone, and this card (the ? button) is the one menu a phone has:
  // a button here turns it on (main.ts opens setup to frame the hand) or off again.
  const foot = el.querySelector('.tutFoot .sub')!;
  foot.textContent = '';
  const cam = document.createElement('button');
  cam.className = 'textBtn tutCam';
  foot.append(cam);
  const label = () => (cam.textContent = document.getElementById('handView')?.hidden === false ? 'Turn camera off' : 'Aim with the camera');
  label();
  new MutationObserver(label).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  cam.onclick = () => {
    close();
    dispatchEvent(new Event('arena:camera'));
  };
}

if (el) {
  document.getElementById('helpBtn')?.addEventListener('click', e => {
    open(false);
    (e.currentTarget as HTMLElement).blur();
  });
  document.getElementById('tutClose')?.addEventListener('click', close);
  el.addEventListener('pointerdown', e => { if (e.target === el) close() });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.hidden) close();
    else if (e.key === '?' && el.hidden && !(e.target instanceof HTMLInputElement)) open(false);
  });
  // The match starting hides the lobby: get out of the way of the 3-2-1.
  const lobby = document.getElementById('lobby');
  if (lobby) {
    new MutationObserver(() => { if (lobby.hidden && !el.hidden && performance.now() < closeAt + 1) close() }).observe(lobby, {
      attributes: true, attributeFilter: ['hidden'],
    });
  }
}

export function showTutorialOnce() {
  if (!el || seen()) return;
  open(true);
  markSeen(); // first-time only, even if the tab closes before it is dismissed
}
