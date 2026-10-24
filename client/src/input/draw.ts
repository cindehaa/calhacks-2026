// Hand cursor, locked spot, drag-off ring and live transcript, drawn over the board in screen px.

export interface InputView {
  cursor: { x: number; y: number; pinched: boolean } | null; // hand cursor only; the mouse has its own ring
  lock: {
    x: number;
    y: number;
    by: 'pinch' | 'key' | 'voice' | 'flick';
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
    if (l.radius) {
      g.setLineDash([8, 8]);
      circle(g, l.x, l.y, l.radius, l.out ? C.bad : 'rgba(142,150,179,0.45)', 2);
      g.setLineDash([]);
    }
    const pulse = l.speaking ? 3 * Math.sin(now / 90) : 0;
    circle(g, l.x, l.y, 16 + pulse, col, 3, l.out ? 'rgba(255,93,108,0.15)' : 'rgba(74,163,255,0.15)');
    const words = l.transcript ? `“${clip(l.transcript, 40)}”` : l.by === 'voice' ? 'listening…' : 'say the troop…';
    pill(g, words, l.x, l.y - 30, l.transcript ? C.text : C.muted);
    if (l.out) text(g, l.by === 'voice' ? 'stop talking to cancel' : l.by === 'key' ? 'let go of Space to cancel' : 'let go to cancel', l.x, l.y + 36, 13, C.bad);
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

// The hand cursor: a soft glow, a ring, and a filled centre while pinched.
export function drawCursor(g: CanvasRenderingContext2D, x: number, y: number, pinched: boolean): void {
  const glow = g.createRadialGradient(x, y, 0, x, y, 42);
  glow.addColorStop(0, 'rgba(74,163,255,0.5)');
  glow.addColorStop(1, 'rgba(74,163,255,0)');
  circle(g, x, y, 42, null, 0, glow);
  circle(g, x, y, 14, '#bfe0ff', 2.5, pinched ? C.mine : 'rgba(13,16,32,0.35)');
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
