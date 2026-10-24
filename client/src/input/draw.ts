// Hand cursor, locked spot, drag-off ring and live transcript, drawn over the board in screen px.
import { CAL_TARGETS, type PinchCalibration, type PursuitCalibration } from './calibrate';

export interface InputView {
  cursor: { x: number; y: number; pinched: boolean } | null; // hand cursor only; the mouse has its own ring
  lock: {
    x: number;
    y: number;
    by: 'pinch' | 'voice';
    out: boolean; // outside the drag-off ring: letting go now cancels
    radius: number;
    transcript: string;
    speaking: boolean;
  } | null;
  flashes: { x: number; y: number; kind: 'deploy' | 'cancel'; label: string; t: number }[];
  hint: string;
}

const C = { mine: '#4aa3ff', voice: '#c56cf0', bad: '#ff5d6c', good: '#4ade80', text: '#e8ebf5', muted: '#8e96b3' };
export const FLASH_MS = 700;

export function drawInput(g: CanvasRenderingContext2D, v: InputView, now = performance.now()): void {
  g.save();
  const l = v.lock;
  if (l) {
    const col = l.out ? C.bad : l.by === 'voice' ? C.voice : C.mine;
    g.setLineDash([8, 8]);
    circle(g, l.x, l.y, l.radius, l.out ? C.bad : 'rgba(142,150,179,0.45)', 2);
    g.setLineDash([]);
    const pulse = l.speaking ? 3 * Math.sin(now / 90) : 0;
    circle(g, l.x, l.y, 16 + pulse, col, 3, l.out ? 'rgba(255,93,108,0.15)' : 'rgba(74,163,255,0.15)');
    const words = l.transcript ? `“${clip(l.transcript, 40)}”` : l.by === 'voice' ? 'listening…' : 'say the troop…';
    pill(g, words, l.x, l.y - 30, l.transcript ? C.text : C.muted);
    if (l.out) text(g, l.by === 'voice' ? 'stop talking to cancel' : 'let go to cancel', l.x, l.y + 36, 13, C.bad);
  }
  for (const f of v.flashes) {
    const a = (now - f.t) / FLASH_MS;
    if (a < 0 || a >= 1) continue;
    g.globalAlpha = 1 - a;
    if (f.kind === 'deploy') circle(g, f.x, f.y, 16 + a * 36, C.good, 3);
    else cross(g, f.x, f.y, 14, C.bad);
    if (f.label) text(g, f.label, f.x, f.y - 30 - a * 10, 13, f.kind === 'deploy' ? C.good : C.bad);
    g.globalAlpha = 1;
  }
  if (v.cursor) drawCursor(g, v.cursor.x, v.cursor.y, v.cursor.pinched);
  if (v.hint) text(g, v.hint, innerWidth / 2, 70, 13, '#fbbf24');
  g.restore();
}

// Full-screen calibration screens, on their own canvas above everything else.
// The hand cursor: a soft glow, a ring, and a filled centre while pinched.
export function drawCursor(g: CanvasRenderingContext2D, x: number, y: number, pinched: boolean): void {
  const glow = g.createRadialGradient(x, y, 0, x, y, 42);
  glow.addColorStop(0, 'rgba(74,163,255,0.5)');
  glow.addColorStop(1, 'rgba(74,163,255,0)');
  circle(g, x, y, 42, null, 0, glow);
  circle(g, x, y, 14, '#bfe0ff', 2.5, pinched ? C.mine : 'rgba(13,16,32,0.35)');
  circle(g, x, y, 3, null, 0, '#fff');
}

export function drawPointerCalibration(g: CanvasRenderingContext2D, w: number, h: number, run: PursuitCalibration, hand: boolean, now: number): void {
  g.fillStyle = 'rgba(8,10,20,0.92)';
  g.fillRect(0, 0, w, h);
  // The rectangle the dot will trace.
  g.setLineDash([6, 10]);
  g.strokeStyle = '#2f3758';
  g.lineWidth = 2;
  g.beginPath();
  CAL_TARGETS.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
  g.closePath();
  g.stroke();
  g.setLineDash([]);
  const ready = run.ready(now);
  const [x, y] = run.target(now);
  const glow = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, 60);
  glow.addColorStop(0, 'rgba(74,163,255,0.6)');
  glow.addColorStop(1, 'rgba(74,163,255,0)');
  circle(g, x * w, y * h, 60, null, 0, glow);
  circle(g, x * w, y * h, ready ? 22 + 5 * Math.sin(now / 120) : 18, C.mine, 3);
  circle(g, x * w, y * h, 5, null, 0, '#fff');
  const ty = h * 0.3;
  text(g, ready ? 'Point at the dot' : 'Follow the dot with your hand', w / 2, ty, 24, C.text);
  text(g, hand ? 'Move your whole hand and keep your index knuckle on the dot. Esc cancels.' : 'No hand in view', w / 2, ty + 30, 15, hand ? C.muted : '#fbbf24');
  g.fillStyle = '#2a3050';
  g.fillRect(w / 2 - 150, ty + 50, 300, 6);
  g.fillStyle = C.mine;
  g.fillRect(w / 2 - 150, ty + 50, 300 * run.progress(now), 6);
}

// After the fit: the new cursor is live, and touching each corner lights it up.
export function drawCalibrationCheck(g: CanvasRenderingContext2D, w: number, h: number, touched: boolean[], hand: boolean, now: number): void {
  g.fillStyle = 'rgba(8,10,20,0.8)';
  g.fillRect(0, 0, w, h);
  CAL_TARGETS.forEach(([x, y], i) => {
    if (touched[i]) circle(g, x * w, y * h, 22, C.good, 3, 'rgba(74,222,128,0.25)');
    else circle(g, x * w, y * h, 22 + 3 * Math.sin(now / 150 + i), '#5a6282', 2);
  });
  const all = touched.every(Boolean);
  text(g, all ? 'Looks good' : 'Touch the 4 corners with the cursor', w / 2, h / 2 - 10, 24, all ? C.good : C.text);
  text(g, hand ? 'R recalibrates · Esc keeps it as it is' : 'No hand in view', w / 2, h / 2 + 20, 15, hand ? C.muted : '#fbbf24');
}

export function drawPinchCalibration(g: CanvasRenderingContext2D, w: number, h: number, run: PinchCalibration, hand: boolean, now: number): void {
  g.fillStyle = 'rgba(8,10,20,0.92)';
  g.fillRect(0, 0, w, h);
  const p = run.phase(now);
  text(g, p.ask === 'open' ? 'Hold your hand OPEN, in your pointing pose' : 'Now PINCH thumb to middle finger and hold', w / 2, h / 2 - 10, 24, C.text);
  const sub = p.recording ? 'recording… move it around a little' : 'get ready…';
  text(g, hand ? sub : 'No hand in view', w / 2, h / 2 + 22, 15, hand ? C.muted : '#fbbf24');
  g.fillStyle = '#2a3050';
  g.fillRect(w / 2 - 150, h / 2 + 46, 300, 6);
  g.fillStyle = C.mine;
  g.fillRect(w / 2 - 150, h / 2 + 46, 300 * p.progress, 6);
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
  g.font = `600 ${size}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = color;
  g.fillText(s, x, y);
}

function pill(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string): void {
  g.font = '600 13px system-ui, sans-serif';
  const w = g.measureText(s).width + 16;
  g.fillStyle = 'rgba(13,16,32,0.85)';
  g.beginPath();
  g.roundRect(x - w / 2, y - 15, w, 22, 11);
  g.fill();
  text(g, s, x, y, 13, color);
}
