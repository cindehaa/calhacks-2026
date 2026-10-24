// The houses' heraldry, embroidered in gold thread: a raven displayed (wings spread) for blue and a
// radiant sun for red, each faceted like the rest of the art, plus a tone-on-tone damask of small
// motifs for the cloth behind them. Drawn on the tapestries (banner.ts) and the versus card (as CSS
// images, see heraldryCss).

export type House = 'raven' | 'sun';

const GOLD = { lit: '#f3d58a', mid: '#d6a84a', dark: '#a7782a', deep: '#6e4c17' };
const poly = (pts: number[], fill: string, extra = '') => `<polygon points="${pts.join(',')}" fill="${fill}"${extra}/>`;
const mirror = (pts: number[], cx = 100) => pts.map((v, i) => (i % 2 ? v : 2 * cx - v));

// A raven displayed, head turned to its right, in a 200 × 200 box.
function raven(): string {
  const { lit, mid, dark, deep } = GOLD;
  const wingTop = [88, 62, 70, 48, 52, 32, 34, 18, 18, 14, 26, 30, 46, 46, 64, 62, 86, 74];
  const wingLow = [86, 74, 64, 62, 46, 46, 26, 30, 12, 34, 26, 44, 10, 54, 28, 58, 14, 70, 34, 72, 24, 84, 46, 84, 60, 90, 86, 86];
  const quills = [28, 40, 46, 56, 18, 62, 40, 66, 30, 78, 52, 76]; // feather lines on the lower wing
  const lines = (pts: number[]) => {
    let s = '';
    for (let i = 0; i < pts.length; i += 4) s += `<line x1="${pts[i]}" y1="${pts[i + 1]}" x2="${pts[i + 2]}" y2="${pts[i + 3]}" stroke="${deep}" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>`;
    return s;
  };
  return [
    poly(wingLow, mid), poly(wingTop, lit), lines(quills),
    poly(mirror(wingLow), dark), poly(mirror(wingTop), mid), lines(mirror(quills)),
    // tail: three spread feathers
    poly([92, 116, 100, 122, 100, 160, 84, 152], mid), poly([100, 122, 108, 116, 116, 152, 100, 160], dark),
    poly([84, 152, 76, 146, 90, 120, 92, 132], lit), poly([116, 152, 124, 146, 110, 120, 108, 132], mid),
    // body: lit on the left, shadowed on the right
    poly([94, 52, 100, 52, 100, 126, 88, 104, 86, 72], lit), poly([100, 52, 106, 52, 114, 72, 112, 104, 100, 126], mid),
    poly([90, 82, 100, 92, 110, 82, 100, 104], dark, ' opacity=".35"'),
    // head and beak
    poly([92, 46, 100, 34, 110, 37, 115, 46, 107, 54, 95, 54], lit), poly([110, 37, 115, 46, 107, 54], mid),
    poly([113, 43, 132, 48, 113, 51], dark), poly([113, 47, 132, 48, 113, 51], deep, ' opacity=".6"'),
    poly([104, 42, 107, 39.5, 110, 42, 107, 44.5], deep),
    // talons
    `<path d="M93 112 l-6 14 m6 -14 l-1 15 M107 112 l6 14 m-6 -14 l1 15" stroke="${dark}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`,
  ].join('');
}

// A radiant sun: sixteen faceted rays, long and short in turn, round a faceted face.
function sun(): string {
  const { lit, mid, dark, deep } = GOLD;
  let s = '';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2, long = i % 2 === 0;
    const r0 = 34, r1 = long ? 86 : 62, half = long ? 0.13 : 0.11;
    const P = (r: number, t: number) => [+(100 + r * Math.cos(t)).toFixed(1), +(100 + r * Math.sin(t)).toFixed(1)];
    const tip = P(r1, a), l = P(r0, a - half), r = P(r0, a + half), base = P(r0, a);
    const lightSide = Math.cos(a + Math.PI * 0.75) > 0; // light from the upper left
    s += poly([...base, ...l, ...tip], lightSide ? lit : mid) + poly([...base, ...r, ...tip], lightSide ? mid : dark);
  }
  // the face: a sixteen-sided disc split into lit and shadowed facets, with a ring and an inner star
  const ring = (r: number) => Array.from({ length: 16 }, (_, k) => {
    const t = (k / 16) * Math.PI * 2 - Math.PI / 2;
    return [+(100 + r * Math.cos(t)).toFixed(1), +(100 + r * Math.sin(t)).toFixed(1)];
  });
  const R = ring(32);
  for (let k = 0; k < 16; k++) {
    const [a, b] = [R[k], R[(k + 1) % 16]];
    const shade = k < 4 || k > 11 ? lit : k < 8 ? mid : k < 12 ? dark : mid;
    s += poly([100, 100, ...a, ...b], shade);
  }
  s += `<polygon points="${ring(24).flat().join(',')}" fill="none" stroke="${deep}" stroke-width="1.6" opacity=".5"/>`;
  const star = Array.from({ length: 16 }, (_, k) => {
    const t = (k / 16) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 7 : 16;
    return [+(100 + r * Math.cos(t)).toFixed(1), +(100 + r * Math.sin(t)).toFixed(1)];
  }).flat();
  return s + poly(star, lit) + `<polygon points="${star.join(',')}" fill="none" stroke="${deep}" stroke-width="1" opacity=".35"/>`;
}

// One 40 × 40 tile of the damask, in white (callers set its opacity): small birds or small suns on
// a diamond lattice.
function damask(house: House): string {
  const lattice = `<path d="M0 20 L20 0 L40 20 L20 40 Z" fill="none" stroke="#fff" stroke-width=".8"/>`;
  const motif = (x: number, y: number) => house === 'raven'
    ? `<path d="M${x - 6} ${y - 1} L${x - 2} ${y - 3} L${x} ${y} L${x + 2} ${y - 3} L${x + 6} ${y - 1} L${x + 2} ${y + 1} L${x} ${y + 4} L${x - 2} ${y + 1} Z" fill="#fff"/>`
    : `<g transform="translate(${x} ${y})"><path d="M0 -6 L1.5 -1.5 L6 0 L1.5 1.5 L0 6 L-1.5 1.5 L-6 0 L-1.5 -1.5 Z" fill="#fff"/><circle r="1.6" fill="none" stroke="#fff" stroke-width=".7"/></g>`;
  return lattice + motif(20, 20) + motif(0, 0) + motif(40, 0) + motif(0, 40) + motif(40, 40);
}

export const EMBLEM: Record<House, string> = { raven: raven(), sun: sun() };
export const DAMASK: Record<House, string> = { raven: damask('raven'), sun: damask('sun') };

const svgUrl = (inner: string, box: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}">${inner}</svg>`)}")`;

// CSS images for places that aren't cloth (the versus card): --emblem-raven, --damask-raven, and the same for sun.
export function heraldryCss(): void {
  const root = document.documentElement.style;
  for (const h of ['raven', 'sun'] as const) {
    root.setProperty(`--emblem-${h}`, svgUrl(EMBLEM[h], 200));
    root.setProperty(`--damask-${h}`, svgUrl(DAMASK[h], 40));
  }
}
