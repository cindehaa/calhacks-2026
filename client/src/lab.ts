// Workshop page (dev builds, ?lab): the live input signals on a scrolling timeline (hand, gesture
// scores, voice activity, transcript words) and the intents the control scheme emits. For tuning
// the controls, not for players.
import type { InputController } from './input/controller';
import type { Intent, Signal } from './input/schemes/types';

const SPAN_MS = 10_000;
const ROWS = ['hand', 'thumbDown', 'pinch', 'point', 'voice', 'words', 'gesture', 'intent'] as const;
const INTENT_COLOR: Record<Intent['kind'], string> = {
  commit: '#4ade80', cancel: '#f87171', clear: '#fb923c', uiActivate: '#a78bfa',
};

export function openLab(input: InputController): void {
  const el = document.createElement('div');
  el.id = 'lab';
  el.innerHTML = `
    <div class="labBar"><b>Workshop</b>
      <span class="labHow"></span><span class="labState"></span>
      <button data-act="min">–</button></div>
    <canvas></canvas>`;
  const style = document.createElement('style');
  style.textContent = `
    #lab { position: fixed; left: 0; right: 0; bottom: 0; height: 34vh; z-index: 9999; background: rgba(8,10,14,.72);
      color: #e2e8f0; font: 12px/1.3 ui-monospace, monospace; display: flex; flex-direction: column; pointer-events: none; }
    #lab .labBar { pointer-events: auto; }
    #lab.min { height: 30px; } #lab.min canvas { display: none; }
    #lab .labBar { display: flex; gap: 10px; align-items: center; padding: 4px 8px; }
    #lab .labHow { opacity: .7; } #lab .labState { margin-left: auto; color: #fbbf24; }
    #lab canvas { flex: 1; width: 100%; }`;
  document.head.appendChild(style);
  document.body.appendChild(el);
  el.querySelector<HTMLButtonElement>('[data-act="min"]')!.onclick = () => el.classList.toggle('min');

  type Mark = { t: number; row: (typeof ROWS)[number]; color: string; label?: string; v?: number; until?: number };
  let marks: Mark[] = [];
  const hand: { t: number; vis: boolean; half: boolean; thumbDown: number; pinch: number; point: number }[] = [];
  const levels: { t: number; db: number; loud: boolean }[] = [];
  let voiceOn: number | null = null;

  input.listeners.signal.push((s: Signal) => {
    if (s.kind === 'hand') {
      hand.push(s.visible ? { t: s.t, vis: true, half: s.overHalf, thumbDown: s.gestures.Thumb_Down, pinch: s.gestures.Pinch, point: s.gestures.Pointing_Up } : { t: s.t, vis: false, half: false, thumbDown: 0, pinch: 0, point: 0 });
    } else if (s.kind === 'level') levels.push({ t: s.t, db: s.db, loud: s.loud });
    else if (s.kind === 'voice') {
      if (s.phase === 'start') voiceOn = s.t;
      else if (voiceOn !== null) {
        marks.push({ t: voiceOn, until: s.t, row: 'voice', color: 'rgba(74,222,128,.35)' });
        voiceOn = null;
      }
    } else if (s.kind === 'words') marks.push({ t: s.t, row: 'words', color: s.final ? '#e2e8f0' : '#64748b', label: s.cancel ? `✕ ${s.text}` : s.text });
    else if (s.kind === 'pinch') marks.push({ t: s.t, row: 'gesture', color: '#38bdf8', label: s.kind });
    else if (s.kind === 'deploy') marks.push({ t: s.t, row: 'gesture', color: '#94a3b8', label: `deploy ${s.phase}` });
    else if (s.kind === 'key') marks.push({ t: s.t, row: 'gesture', color: '#cbd5e1', label: s.key });
  });
  input.listeners.intent.push((i: Intent, ok: boolean) => {
    const label = i.kind === 'commit' ? `commit ${i.by}` : i.kind === 'cancel' || i.kind === 'clear' ? `${i.kind} ${i.why}` : i.kind;
    marks.push({ t: performance.now(), row: 'intent', color: INTENT_COLOR[i.kind], label: ok ? label : `${label} ✗` });
  });

  const c = el.querySelector('canvas')!;
  const draw = () => {
    requestAnimationFrame(draw);
    if (el.classList.contains('min')) return;
    const now = performance.now(), dpr = devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const left = 60, X = (t: number) => left + ((t - (now - SPAN_MS)) / SPAN_MS) * (w - left - 8);
    const rh = h / ROWS.length, Y = (r: (typeof ROWS)[number]) => ROWS.indexOf(r) * rh;
    marks = marks.filter(m => (m.until ?? m.t) > now - SPAN_MS);
    while (hand.length && hand[0].t < now - SPAN_MS) hand.shift();
    while (levels.length && levels[0].t < now - SPAN_MS) levels.shift();
    g.font = '11px ui-monospace, monospace';
    ROWS.forEach((r, i) => {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,.03)' : 'transparent';
      g.fillRect(0, i * rh, w, rh);
      g.fillStyle = '#94a3b8';
      g.fillText(r, 6, i * rh + rh / 2 + 4);
    });
    // Hand: visible (grey) and pointing at your half (green). Gesture scores as lines.
    for (const f of hand) {
      g.fillStyle = !f.vis ? 'rgba(248,113,113,.4)' : f.half ? '#4ade80' : '#475569';
      g.fillRect(X(f.t), Y('hand') + 4, 3, rh - 8);
    }
    const line = (row: (typeof ROWS)[number], key: 'thumbDown' | 'pinch' | 'point', color: string) => {
      g.strokeStyle = color;
      g.beginPath();
      hand.forEach((f, i) => (i ? g.lineTo : g.moveTo).call(g, X(f.t), Y(row) + rh - 3 - f[key] * (rh - 6)));
      g.stroke();
    };
    line('thumbDown', 'thumbDown', '#fb923c');
    line('pinch', 'pinch', '#38bdf8');
    line('point', 'point', '#a78bfa');
    // Voice: the level, loud frames highlighted, VAD spans behind.
    for (const m of marks) if (m.row === 'voice') { g.fillStyle = m.color; g.fillRect(X(m.t), Y('voice'), X(m.until!) - X(m.t), rh) }
    if (voiceOn !== null) { g.fillStyle = 'rgba(74,222,128,.35)'; g.fillRect(X(voiceOn), Y('voice'), X(now) - X(voiceOn), rh) }
    for (const l of levels) {
      const k = Math.max(0, Math.min(1, (l.db + 90) / 80));
      g.fillStyle = l.loud ? '#4ade80' : '#334155';
      g.fillRect(X(l.t), Y('voice') + rh - k * rh, 2, k * rh);
    }
    for (const m of marks) {
      if (m.row === 'voice') continue;
      const x = X(m.t), y = Y(m.row);
      g.fillStyle = m.color;
      g.fillRect(x, y + 2, 2, rh - 4);
      if (m.label) g.fillText(m.label, x + 4, y + rh / 2 + 4);
    }
    el.querySelector('.labHow')!.textContent = input.scheme.howTo;
    el.querySelector('.labState')!.textContent = input.schemeState();
  };
  requestAnimationFrame(draw);
}
