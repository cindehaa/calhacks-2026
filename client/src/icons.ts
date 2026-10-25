// Faceted 3D icons, in the same language as the slabs: every shape splits into lit and shadowed
// facets (light from the upper left) and sits on a darker extruded side, so icons read as cut
// pieces rather than flat strokes. Raised gold on stone, carved into amber buttons.
// Use <i class="ico" data-icon="swords" data-tone="carved"></i>; mountIcons() fills them in.
import { EMBLEM } from './heraldry';

type Pt = [number, number];
type Face = { pts: Pt[]; tone: 0 | 1 | 2; g?: number }; // tone: 0 lit, 1 mid, 2 shadow. g: layer, drawn in order
const layer = (g: number, fs: Face[]) => fs.map(f => ({ ...f, g }));

export type Tone = 'gold' | 'carved' | 'light' | 'ice';
const TONES: Record<Tone, { face: [string, string, string]; side: string; dy: number }> = {
  gold: { face: ['#ffd27a', '#ffb02e', '#d4870f'], side: '#5c3200', dy: 1.6 },
  carved: { face: ['#5c3200', '#432400', '#2a1600'], side: '#ffe3a6', dy: 1.1 }, // a light lip below reads as cut in
  light: { face: ['#ffffff', '#dfe4f2', '#b4bdd8'], side: '#0b0e22', dy: 1.4 },
  ice: { face: ['#eef6fc', '#c6dced', '#9cc3e0'], side: '#2b4a66', dy: 1.6 },
};

const LIGHT: Pt = [-0.6, -0.8]; // toward the upper left
// Tone a facet by which way its outward normal faces.
const toneOf = (nx: number, ny: number): Face['tone'] => {
  const d = (nx * LIGHT[0] + ny * LIGHT[1]) / (Math.hypot(nx, ny) || 1);
  return d > 0.35 ? 0 : d > -0.35 ? 1 : 2;
};
const P = (cx: number, cy: number, r: number, a: number): Pt => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

// A faceted disc (r0 = 0) or ring: n segments, each toned by where it faces.
function ring(cx: number, cy: number, r1: number, r0: number, n: number, turn = Math.PI / n): Face[] {
  return Array.from({ length: n }, (_, k) => {
    const a0 = (k / n) * Math.PI * 2 - turn, a1 = ((k + 1) / n) * Math.PI * 2 - turn, mid = (a0 + a1) / 2;
    const pts: Pt[] = r0 ? [P(cx, cy, r1, a0), P(cx, cy, r1, a1), P(cx, cy, r0, a1), P(cx, cy, r0, a0)] : [[cx, cy], P(cx, cy, r1, a0), P(cx, cy, r1, a1)];
    return { pts, tone: toneOf(Math.cos(mid), Math.sin(mid)) };
  });
}
// A bar from a to b, w wide, split down its length into a lit and a shadowed half.
function bar(a: Pt, b: Pt, w: number, tip = 0): Face[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), nx = -dy / len * (w / 2), ny = dx / len * (w / 2);
  const A: Pt = [a[0] + (dx / len) * tip, a[1] + (dy / len) * tip]; // a pointed end
  const l: Face = { pts: [tip ? a : [a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], b, tip ? A : a].map(p => p as Pt), tone: toneOf(nx, ny) };
  const r: Face = { pts: [tip ? a : [a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], b, tip ? A : a].map(p => p as Pt), tone: toneOf(-nx, -ny) };
  if (tip) { l.pts = [a, [A[0] + nx, A[1] + ny], [b[0] + nx, b[1] + ny], b]; r.pts = [a, [A[0] - nx, A[1] - ny], [b[0] - nx, b[1] - ny], b]; }
  return [l, r];
}
// A convex polygon fanned from its centre into facets.
function fan(pts: Pt[]): Face[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map((p, k) => {
    const q = pts[(k + 1) % pts.length], mx = (p[0] + q[0]) / 2 - cx, my = (p[1] + q[1]) / 2 - cy;
    return { pts: [[cx, cy], p, q], tone: toneOf(mx, my) };
  });
}
const mirrorX = (fs: Face[]): Face[] => fs.map(f => ({ pts: f.pts.map(([x, y]) => [24 - x, y] as Pt), tone: (f.tone === 0 ? 1 : f.tone === 1 ? 0 : 2) as Face['tone'] }));

function sword(): Face[] {
  return [
    ...bar([3, 3], [14.6, 14.6], 3.4, 2.4), // blade, pointed
    ...bar([11.4, 17.8], [17.8, 11.4], 2.2), // guard
    ...bar([15.6, 15.6], [19.4, 19.4], 2), // grip
    ...fan([[21.4, 19.8], [21.4, 21.4], [19.8, 21.4], [19.2, 20.6], [20.6, 19.2]]), // pommel
  ];
}
function star(): Face[] {
  const out: Face[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2, tip = P(12, 12.6, 11, a);
    const l = P(12, 12.6, 4.6, a - Math.PI / 5), r = P(12, 12.6, 4.6, a + Math.PI / 5);
    out.push({ pts: [[12, 12.6], l, tip], tone: toneOf(Math.cos(a - 0.3), Math.sin(a - 0.3)) }, { pts: [[12, 12.6], tip, r], tone: toneOf(Math.cos(a + 0.3), Math.sin(a + 0.3)) });
  }
  return out;
}

const SHAPES: Record<string, () => Face[]> = {
  swords: () => [...layer(0, mirrorX(sword())), ...layer(1, sword())],
  sword: sword,
  target: () => [...ring(12, 12, 10.5, 8, 8), ...ring(12, 12, 6, 3.6, 8), ...ring(12, 12, 2, 0, 8)],
  star,
  close: () => [...bar([4.5, 4.5], [19.5, 19.5], 3.6), ...bar([19.5, 4.5], [4.5, 19.5], 3.6)],
  copy: () => [...layer(0, fan([[9, 2], [22, 2], [22, 15], [9, 15]])), ...layer(1, fan([[2, 8], [15, 8], [15, 21], [2, 21]]))],
  camera: () => [...fan([[2, 7], [15, 7], [15, 18], [2, 18]]), ...fan([[16, 12.5], [22, 7.5], [22, 17.5]]), ...ring(8.5, 12.5, 3, 0, 8)],
  speaker: () => [...fan([[2, 9], [7, 9], [13, 3.5], [13, 20.5], [7, 15], [2, 15]]), ...bar([16, 7.5], [18.6, 12], 2.4), ...bar([18.6, 12], [16, 16.5], 2.4), ...bar([19.4, 4.5], [22.6, 12], 2.2), ...bar([22.6, 12], [19.4, 19.5], 2.2)],
  muted: () => [...fan([[3, 9], [8, 9], [14, 4], [14, 20], [8, 15], [3, 15]]), ...bar([16.5, 9], [22, 15], 2), ...bar([22, 9], [16.5, 15], 2)],
  mic: () => [...fan([[9, 2], [15, 2], [16.5, 4], [16.5, 11], [15, 13.5], [9, 13.5], [7.5, 11], [7.5, 4]]), ...bar([5, 10], [6.5, 15], 2), ...bar([6.5, 15], [12, 17.5], 2), ...bar([12, 17.5], [17.5, 15], 2), ...bar([17.5, 15], [19, 10], 2), ...bar([12, 17.5], [12, 21.5], 2.2), ...bar([8, 21.5], [16, 21.5], 2.2)],
  pause: () => [...fan([[5, 4], [10, 4], [10, 20], [5, 20]]), ...fan([[14, 4], [19, 4], [19, 20], [14, 20]])],
  flag: () => [...bar([5, 2.5], [5, 22], 2.4), ...fan([[6, 3.5], [20, 3.5], [16.5, 8.5], [20, 13.5], [6, 13.5]])],
};

const pts = (p: Pt[], dy = 0) => p.map(([x, y]) => `${x.toFixed(2)},${(y + dy).toFixed(2)}`).join(' ');

export function icon(name: string, tone: Tone = 'gold', size = 30): string {
  const t = TONES[tone];
  if (name === 'raven') {
    // The house emblem itself, so the icon and the banners are one bird.
    return `<svg class="ico3d" viewBox="0 0 200 200" width="${size}" height="${size}" aria-hidden="true"><g transform="translate(0 ${t.dy * 8})" opacity=".9">${EMBLEM.raven.replace(/fill="#[0-9a-f]{6}"/g, `fill="${t.side}"`)}</g>${EMBLEM.raven}</svg>`;
  }
  const faces = (SHAPES[name] ?? SHAPES.star)();
  // Layer by layer: the extruded side (every face, shifted down, in the side colour), then the lit faces.
  let body = '';
  for (const g of [...new Set(faces.map(f => f.g ?? 0))].sort()) {
    const fs = faces.filter(f => (f.g ?? 0) === g);
    body += `<g fill="${t.side}" stroke="${t.side}" stroke-width=".25" stroke-linejoin="round">${fs.map(f => `<polygon points="${pts(f.pts, t.dy)}"/>`).join('')}</g>`;
    body += fs.map(f => `<polygon points="${pts(f.pts)}" fill="${t.face[f.tone]}" stroke="${t.face[f.tone]}" stroke-width=".25" stroke-linejoin="round"/>`).join('');
  }
  return `<svg class="ico3d" viewBox="0 0 24 ${24 + t.dy}" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}

// Fill every <i data-icon> under root (default: the whole page).
export function mountIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('i[data-icon]')) {
    el.innerHTML = icon(el.dataset.icon!, (el.dataset.tone as Tone) || 'gold', Number(el.dataset.size) || 30);
  }
}
