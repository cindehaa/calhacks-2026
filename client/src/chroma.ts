// Fallback background removal, for when BiRefNet times out and the api hands over the raw
// FLUX image. Plain magenta keying ate pink and purple troops in prep, so this keys whatever
// colour the border actually is (its median) and only clears pixels reachable from the edges,
// which leaves a pink troop's insides alone. Pure: works on RGBA bytes, so it tests in node.

const dist2 = (d: ArrayLike<number>, i: number, c: [number, number, number]) =>
  (d[i] - c[0]) ** 2 + (d[i + 1] - c[1]) ** 2 + (d[i + 2] - c[2]) ** 2;

export function borderMedian(d: ArrayLike<number>, w: number, h: number): [number, number, number] {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
  };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

// Clears (alpha 0) every pixel within `tol` of the border colour that connects to the edge, and
// half-fades the ring just inside it so the cut isn't jagged. Returns how many it cleared.
export function keyBackground(d: Uint8ClampedArray, w: number, h: number, tol = 70): number {
  const bg = borderMedian(d, w, h), t2 = tol * tol;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (p: number) => {
    if (!seen[p] && dist2(d, p * 4, bg) <= t2) {
      seen[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  let n = 0;
  while (stack.length) {
    const p = stack.pop()!, x = p % w, y = (p / w) | 0;
    d[p * 4 + 3] = 0;
    n++;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  // Soften the edge: kept pixels touching a cleared one get half alpha, within twice the tolerance.
  for (let p = 0; p < w * h; p++) {
    if (seen[p]) continue;
    const x = p % w;
    const nearCut = (x > 0 && seen[p - 1]) || (x < w - 1 && seen[p + 1]) || (p >= w && seen[p - w]) || (p + w < w * h && seen[p + w]);
    if (nearCut && dist2(d, p * 4, bg) <= 4 * t2) d[p * 4 + 3] = 128;
  }
  return n;
}
