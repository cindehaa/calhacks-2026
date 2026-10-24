// Hand cursor, locked spot, drag-off ring and live transcript, drawn over the board in screen px.
import { CAL_TARGETS, type PinchCalibration } from './calibrate';
import type { LockBy } from './lock';

export interface InputView {
  cursor: { x: number; y: number; pinched: boolean } | null; // hand cursor only; the mouse has its own ring
  lock: {
    x: number;
    y: number;
    by: LockBy;
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
    else text(g, l.by === 'voice' ? 'go quiet to deploy' : 'let go to deploy', l.x, l.y + 36, 12, C.muted);
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
  if (v.cursor) {
    const c = v.cursor;
    circle(g, c.x, c.y, 10, C.mine, 2.5, c.pinched ? C.mine : 'rgba(13,16,32,0.4)');
  }
  if (v.hint) text(g, v.hint, innerWidth / 2, 70, 13, '#fbbf24');
  g.restore();
}

// Full-screen calibration screens, on their own canvas above everything else.
export function drawPointerCalibration(g: CanvasRenderingContext2D, w: number, h: number, index: number, hand: boolean, now: number): void {
  g.fillStyle = 'rgba(8,10,20,0.92)';
  g.fillRect(0, 0, w, h);
  CAL_TARGETS.forEach(([x, y], j) => {
    if (j < index) circle(g, x * w, y * h, 6, null, 0, C.good);
    else if (j > index) circle(g, x * w, y * h, 6, '#3a4050', 2);
  });
  if (index < CAL_TARGETS.length) {
    const [x, y] = CAL_TARGETS[index];
    circle(g, x * w, y * h, 20 + 4 * Math.sin(now / 150), C.mine, 3);
    circle(g, x * w, y * h, 4, null, 0, C.mine);
  }
  text(g, `Point at the glowing dot and pinch (${Math.min(index + 1, 4)} of 4)`, w / 2, h / 2 - 10, 22, C.text);
  text(g, hand ? 'Aim with your index knuckle, hold still, pinch thumb to middle finger. Esc cancels.' : 'No hand in view', w / 2, h / 2 + 20, 15, hand ? C.muted : '#fbbf24');
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

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number, stroke: string | null, width: number, fill?: string): void {
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
