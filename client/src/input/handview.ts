// The virtual hand in the bottom-right corner: the 21 landmarks the tracker sees, drawn from the
// hand-centred 3D (world) landmarks so it stays framed wherever your hand is, mirrored like a reflection.
// Nearer joints draw thicker and brighter. The index fingertip shows the gesture state.
import type { CursorState as HandState } from './draw';
import { HAND_CONNECTIONS } from './hand';
import type { Landmark } from './pose';

const PALM = [0, 1, 5, 9, 13, 17];
const TIPS = [4, 8, 12, 16, 20];
const TIP_COLOR: Record<HandState, string> = { open: '#ffb02e', fire: '#fff1c4', fist: '#ff7a86' };

export function drawHandView(c: HTMLCanvasElement, world: Landmark[] | null, state: HandState): void {
  const w = c.clientWidth, h = c.clientHeight, dpr = devicePixelRatio || 1;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!world || world.length < 21) return;

  // Mirror x, centre the hand's bounding box, scale so a spread hand (~0.2 m) fills the panel.
  const xs = world.map(p => -p.x), ys = world.map(p => p.y), zs = world.map(p => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const s = (Math.min(w, h) * 0.85) / 0.18; // fixed, so a closing fist visibly shrinks
  const zMin = Math.min(...zs), zMax = Math.max(...zs), zr = zMax - zMin || 1;
  const P = (i: number) => [w / 2 + (xs[i] - cx) * s, h / 2 + (ys[i] - cy) * s] as const;
  const near = (i: number) => 1 - (zs[i] - zMin) / zr; // 1 = closest to the camera

  g.lineCap = g.lineJoin = 'round';
  // Palm, a faceted plate.
  g.beginPath();
  PALM.forEach((i, k) => (k ? g.lineTo(...P(i)) : g.moveTo(...P(i))));
  g.closePath();
  g.fillStyle = '#9cc3e026';
  g.fill();
  // Bones, far ones first so near fingers cross over them.
  const bones = [...HAND_CONNECTIONS].sort((a, b) => near(a[0]) + near(a[1]) - near(b[0]) - near(b[1]));
  for (const [a, b] of bones) {
    const k = (near(a) + near(b)) / 2;
    g.strokeStyle = `rgba(${Math.round(156 + 63 * k)}, ${Math.round(195 + 38 * k)}, ${Math.round(224 + 20 * k)}, ${0.55 + 0.45 * k})`;
    g.lineWidth = 4 + 5 * k;
    g.beginPath();
    g.moveTo(...P(a));
    g.lineTo(...P(b));
    g.stroke();
  }
  // Joints, then the fingertips a little larger.
  for (let i = 0; i < 21; i++) {
    const tip = TIPS.includes(i), k = near(i);
    g.fillStyle = tip ? '#dbe9f4' : '#1a2045';
    g.beginPath();
    g.arc(...P(i), (tip ? 3.2 : 2.2) + 1.6 * k, 0, Math.PI * 2);
    g.fill();
  }
  // The aiming fingertip, in the state's colour, with a halo when it fires.
  const [ix, iy] = P(8);
  if (state === 'fire') {
    g.fillStyle = '#ffb02e55';
    g.beginPath();
    g.arc(ix, iy, 14, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = TIP_COLOR[state];
  g.beginPath();
  g.arc(ix, iy, 5.5, 0, Math.PI * 2);
  g.fill();
}
