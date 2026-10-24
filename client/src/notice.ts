// One short message at a time, on a small stone slab just above the dock: what went wrong and
// what to do, never a silent dead end. A new message replaces the one showing unless that one
// ranks higher; plain ones fade after a couple of seconds. Held ones (the hand out of view, the
// connection dropping) stay until their key is cleared, and nothing lower shows meanwhile.
//
// Pure DOM; no game state. Respects prefers-reduced-motion through CSS (notice.css).
import './notice.css';

export type Tone = 'info' | 'warn' | 'bad' | 'good';

export interface NoticeOpts {
  tone?: Tone;
  ms?: number; // how long it shows; ignored when held
  key?: string; // names it, so clearNotice(key) can take it down
  hold?: boolean; // stays until clearNotice(key)
  rank?: number; // a lower-ranked message waits out a higher one (0 default, 1 held hints, 2 connection)
  action?: { label: string; run: () => void };
}

interface Showing { key: string; rank: number; hold: boolean; until: number }

let el: HTMLDivElement | null = null;
let showing: Showing | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let waiting: ReturnType<typeof setTimeout> | undefined;
let waitingKey = '';

function mount(): HTMLDivElement {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'notice';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

export function notice(text: string, o: NoticeOpts = {}): void {
  const now = performance.now();
  const rank = o.rank ?? (o.hold ? 1 : 0);
  const cur = showing && (showing.hold || showing.until > now) ? showing : null;
  if (cur && cur.rank > rank && cur.key !== o.key) return;
  // A held message waits for a short one to finish rather than cutting it off.
  if (o.hold && cur && !cur.hold && cur.key !== (o.key ?? text)) {
    clearTimeout(waiting);
    waitingKey = o.key ?? text;
    waiting = setTimeout(() => notice(text, o), cur.until - now + 60);
    return;
  }
  const n = mount();
  const ms = o.ms ?? 2400;
  showing = { key: o.key ?? text, rank, hold: !!o.hold, until: now + ms };
  n.dataset.tone = o.tone ?? 'info';
  n.replaceChildren();
  const face = document.createElement('span');
  face.className = 'nFace';
  face.textContent = text;
  n.appendChild(face);
  if (o.action) {
    const b = document.createElement('button');
    b.className = 'nAct';
    b.textContent = o.action.label;
    const run = o.action.run;
    b.onclick = e => {
      (e.currentTarget as HTMLElement).blur();
      run();
    };
    n.appendChild(b);
  }
  n.hidden = false;
  // Just above the dock, whatever its height (it grows with the troop chips and the hints).
  const dock = document.getElementById('dock')?.getBoundingClientRect();
  n.style.bottom = dock && dock.height ? `${Math.round(innerHeight - dock.top + 14)}px` : '';
  // Restart the entrance (a small rise and settle) for each new message.
  n.classList.remove('in');
  void n.offsetWidth;
  n.classList.add('in');
  n.style.pointerEvents = o.action ? 'auto' : 'none';
  clearTimeout(timer);
  if (!o.hold) timer = setTimeout(hide, ms);
}

export function clearNotice(key: string): void {
  if (waitingKey === key) clearTimeout(waiting);
  if (showing?.key === key) hide();
}

export function noticeShowing(key: string): boolean {
  return !!showing && showing.key === key && (showing.hold || showing.until > performance.now());
}

// Any message up at all: the board's hover label and poke labels stay quiet meanwhile (one at a time).
export function noticeActive(): boolean {
  return !!showing && (showing.hold || showing.until > performance.now());
}

function hide(): void {
  clearTimeout(timer);
  showing = null;
  if (el) {
    el.classList.remove('in');
    el.hidden = true;
  }
}
