// Home: the arena stays bright and everything around it (crags, woods, snow) dims, so the scene
// behind the menu isn't noisy. Each frame the board's outline (its corners on the ground and at
// tower height) is projected to the screen; a soft-edged mask darkens everything outside it.
import { ARENA_H, ARENA_W } from '../../shared/arena';

type ToScreen = (x: number, y: number, h?: number) => [number, number] | null;
const NS = 'http://www.w3.org/2000/svg';
const M = 0.8; // tiles of margin round the board, for the banks
const TOWER_H = 4.5; // tall enough to keep the far towers' tops inside

// Convex hull (monotone chain), counter-clockwise.
function hull(ps: [number, number][]): [number, number][] {
  const p = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function homeDim(screen: HTMLElement, toScreen: ToScreen): void {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'homeDim');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs><filter id="homeDimBlur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="28"/></filter></defs>
    <path fill="#04050b" fill-rule="evenodd" filter="url(#homeDimBlur)"/>`;
  screen.prepend(svg);
  const path = svg.querySelector('path')!;
  const corners: [number, number][] = [[-M, -M], [ARENA_W + M, -M], [ARENA_W + M, ARENA_H + M], [-M, ARENA_H + M]];
  let last = '';

  function frame() {
    requestAnimationFrame(frame);
    if (screen.hidden) return;
    const pts = corners.flatMap(([x, y]) => [toScreen(x, y, 0), toScreen(x, y, TOWER_H)]).filter((p): p is [number, number] => !!p);
    if (pts.length < 3) return;
    const w = innerWidth, h = innerHeight, pad = 200; // the blur needs room past the screen edge
    const outer = `M${-pad} ${-pad}H${w + pad}V${h + pad}H${-pad}Z`;
    const inner = 'M' + hull(pts).map(([x, y]) => `${x.toFixed(0)} ${y.toFixed(0)}`).join('L') + 'Z';
    const d = outer + inner;
    if (d !== last) path.setAttribute('d', (last = d));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  requestAnimationFrame(frame);
}
