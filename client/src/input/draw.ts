// Hand cursor, the words waiting to be sent, and fire / cancel flashes, drawn over the board in
// screen px.
import { micRing, wordsFlash, wordsPill } from './wordfx';

export type CursorState = 'open' | 'fire' | 'fist';

export interface InputView {
  cursor: { x: number; y: number; state: CursorState } | null; // hand cursor only; the mouse has its own ring
  prompt: { x: number; y: number; text: string; speaking: boolean } | null; // at the cursor, hand or mouse
  flashes: { x: number; y: number; kind: 'deploy' | 'cancel' | 'miss'; label: string; t: number; words?: string }[]; // words: what was sent or cleared, for wordfx.ts
  mic?: { x: number; y: number; db: number; speaking: boolean } | null; // mic on: its level, at the cursor
  hint: string;
}

const C = { mine: '#4aa3ff', voice: '#c56cf0', bad: '#ff5d6c', good: '#4ade80', warn: '#fbbf24', text: '#e8ebf5', muted: '#8e96b3' };
export const FLASH_MS = 700;
export const MISS_MS = 1300; // the "didn't catch that" bubble stays a little longer
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } };

export function drawInput(g: CanvasRenderingContext2D, v: InputView, now = performance.now()): void {
  g.save();
  const p = v.prompt;
  if (p) {
    const dot = p.speaking ? 1 + 0.3 * Math.sin(now / 90) : 1;
    if (p.text) wordsPill(g, `“${clip(p.text, 40)}”`, p.x, p.y - 34, C.text, now); // element words lit
    else pill(g, 'listening…', p.x, p.y - 34, C.muted);
    if (p.speaking) circle(g, p.x + 26, p.y - 46, 3.5 * dot, null, 0, C.voice);
  }
  for (const f of v.flashes) {
    if (f.kind === 'miss') { missBubble(g, f.x, f.y, f.label, (now - f.t) / MISS_MS); continue }
    const a = (now - f.t) / FLASH_MS;
    if (a < 0 || a >= 1) continue;
    if (f.words) wordsFlash(g, f.kind, f.words, f.x, f.y, a); // words into an orb, or crumpled
    g.globalAlpha = 1 - a;
    if (f.kind === 'deploy') circle(g, f.x, f.y, 16 + a * 36, C.good, 3);
    else cross(g, f.x, f.y, 14, C.bad);
    if (f.label) text(g, f.label, f.x, f.y - 30 - a * 10, 13, f.kind === 'deploy' ? C.good : C.bad);
    g.globalAlpha = 1;
  }
  if (v.mic) micRing(g, v.mic.x, v.mic.y, v.mic.db, v.mic.speaking);
  if (v.cursor) drawCursor(g, v.cursor.x, v.cursor.y, v.cursor.state);
  if (v.hint) text(g, v.hint, innerWidth / 2, 70, 13, C.warn);
  g.restore();
}

// The hand cursor: a soft glow, a ring, a filled centre just after a flick, amber while a fist.
export function drawCursor(g: CanvasRenderingContext2D, x: number, y: number, state: CursorState): void {
  const glow = g.createRadialGradient(x, y, 0, x, y, 42);
  glow.addColorStop(0, state === 'fist' ? 'rgba(251,191,36,0.5)' : 'rgba(74,163,255,0.5)');
  glow.addColorStop(1, 'rgba(74,163,255,0)');
  circle(g, x, y, 42, null, 0, glow);
  circle(g, x, y, 14, state === 'fist' ? C.warn : '#bfe0ff', 2.5, state === 'fire' ? C.mine : 'rgba(13,16,32,0.35)');
  circle(g, x, y, 3, null, 0, '#fff');
}

const clip = (s: string, n: number) => (s.length > n ? '…' + s.slice(-n) : s);

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number, stroke: string | null, width: number, fill?: string | CanvasGradient): void {
  g.beginPath();
  g.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = width;
    g.stroke();
  }
}

function cross(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(x - r, y - r);
  g.lineTo(x + r, y + r);
  g.moveTo(x + r, y - r);
  g.lineTo(x - r, y + r);
  g.stroke();
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string): void {
  g.font = `700 ${size}px 'Alegreya Sans', system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = color;
  g.fillText(s, x, y);
}

function pill(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string): void {
  g.font = "700 13px 'Alegreya Sans', system-ui, sans-serif";
  const w = g.measureText(s).width + 16;
  g.fillStyle = 'rgba(13,16,32,0.85)';
  g.beginPath();
  g.roundRect(x - w / 2, y - 15, w, 22, 11);
  g.fill();
  text(g, s, x, y, 13, color);
}

// A fire with no words: a small frost bubble at the spot that wobbles in, says so, and floats
// off. No cross and no red: nothing went wrong, it just didn't hear anything.
function missBubble(g: CanvasRenderingContext2D, x: number, y: number, label: string, a: number): void {
  if (a < 0 || a >= 1) return;
  const still = reduced();
  const s = a * 1.3; // seconds, roughly
  const pop = still ? 1 : s < 0.18 ? 0.6 + 0.4 * (s / 0.18) + 0.12 * Math.sin((s / 0.18) * Math.PI) : 1;
  const wob = still ? 0 : Math.exp(-s * 5) * Math.sin(s * 34) * 0.12;
  const alpha = a < 0.75 ? 1 : 1 - (a - 0.75) / 0.25;
  const lift = still ? 0 : a * 14;
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y - 40 - lift);
  g.rotate(wob);
  g.scale(pop, pop);
  g.font = "italic 700 15px 'Alegreya Sans', system-ui, sans-serif";
  const w = g.measureText(label).width + 22, h = 28, c = 6;
  g.beginPath();
  g.moveTo(-w / 2 + c, -h); g.lineTo(w / 2 - c, -h); g.lineTo(w / 2, -h + c); g.lineTo(w / 2, -c); g.lineTo(w / 2 - c, 0);
  g.lineTo(7, 0); g.lineTo(0, 9); g.lineTo(-7, 0);
  g.lineTo(-w / 2 + c, 0); g.lineTo(-w / 2, -c); g.lineTo(-w / 2, -h + c); g.closePath();
  g.fillStyle = 'rgba(219,233,244,0.96)';
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 8; g.shadowOffsetY = 2;
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 2; g.strokeStyle = '#9cc3e0'; g.stroke();
  g.fillStyle = '#171b2e';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 0, -h / 2 + 1);
  g.restore();
  // A little puff of frost where the finger was.
  g.save();
  g.globalAlpha = alpha * (1 - a);
  g.strokeStyle = '#9cc3e0'; g.lineWidth = 2; g.setLineDash([3, 5]);
  g.beginPath(); g.arc(x, y, 10 + a * 14, 0, Math.PI * 2); g.stroke();
  g.restore();
}
