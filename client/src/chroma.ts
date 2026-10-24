// Generated sprites come on a flat magenta background (api/sprites.ts asks for one); this keys
// it out in the browser, so there's no second background-removal call. Pure, so it's testable.

export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

// RGB distance to the background colour. Background reachable from the image border goes soft
// between CLEAR and SOFT, which takes the anti-aliased rim and the faint drop shadow with it.
// Background enclosed by the outline (between an arm and the body) is only keyed when much
// closer, so a pink troop on magenta keeps its body: a pink dragon's belly sits ~56 away.
const CLEAR = 70, SOFT = 150;
const HOLE_CLEAR = 20, HOLE_SOFT = 40;

// Keys the background out in place. Returns the box around what's left, or null if nothing is.
export function chromaKey(px: Pixels): { x: number; y: number; w: number; h: number } | null {
  const { data, width: w, height: h } = px;
  const key = borderColour(px);
  const n = w * h;
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] - key[0], g = data[i * 4 + 1] - key[1], b = data[i * 4 + 2] - key[2];
    dist[i] = Math.sqrt(r * r + g * g + b * b);
  }

  // Flood from the border through anything near the background colour.
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  const visit = (i: number) => {
    if (!outside[i] && dist[i] < SOFT) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop()!, x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < n - w) visit(i + w);
  }

  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    const a = outside[i] ? ramp(dist[i], CLEAR, SOFT) : ramp(dist[i], HOLE_CLEAR, HOLE_SOFT);
    const o = i * 4;
    if (a < 1) {
      // Unmix the background out of edge pixels so they don't keep a magenta fringe.
      for (let c = 0; c < 3; c++) data[o + c] = a > 0 ? (data[o + c] - (1 - a) * key[c]) / a : 0;
      data[o + 3] *= a;
    }
    if (data[o + 3] > 16) {
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const ramp = (d: number, lo: number, hi: number) => (d <= lo ? 0 : d >= hi ? 1 : (d - lo) / (hi - lo));

// Median of the outermost ring: the model's "#FF00FF" drifts, and the troop may touch an edge.
function borderColour({ data, width: w, height: h }: Pixels): [number, number, number] {
  const ch: number[][] = [[], [], []];
  const add = (x: number, y: number) => {
    for (let c = 0; c < 3; c++) ch[c].push(data[(y * w + x) * 4 + c]);
  };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
  return ch.map(v => v.sort((a, b) => a - b)[v.length >> 1]) as [number, number, number];
}
