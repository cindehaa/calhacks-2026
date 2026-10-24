// Camera → screen mapping. Both sides are normalised to 0..1, the camera side already mirrored.
// A homography absorbs the camera's angle and the arm's reach in one fit from 4+ point pairs.

export type Pt2 = [number, number];
export type Homography = number[]; // 3×3 row-major, h[8] = 1

// Uncalibrated: the middle 60 % of the frame (a bit above centre, where a raised hand sits)
// spans the whole screen, like a touchpad.
export const DEFAULT_H: Homography = [1 / 0.6, 0, -0.2 / 0.6, 0, 1 / 0.6, -0.15 / 0.6, 0, 0, 1];

// Least squares over the 8 unknowns (normal equations, Gauss-Jordan). Null if degenerate.
export function fitHomography(src: Pt2[], dst: Pt2[]): Homography | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  const n = 8;
  const M = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  const add = (r: number[]) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) M[i][j] += r[i] * r[j];
      M[i][n] += r[i] * r[8];
    }
  };
  src.forEach(([x, y], i) => {
    const [u, v] = dst[i];
    add([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    add([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const h = M.map((row, i) => row[n] / row[i]);
  h.push(1);
  return h.every(Number.isFinite) ? h : null;
}

export function applyH(h: Homography, [x, y]: Pt2): Pt2 {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function invertH(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, k, i] = h;
  const A = e * i - f * k, B = -(d * i - f * g), C = d * k - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [A, -(b * i - c * k), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * k - b * g), a * e - b * d].map(
    v => v / det
  );
}

// RMS fit error in screen px, to tell the player how good a calibration was.
export function residualPx(h: Homography, src: Pt2[], dst: Pt2[], w: number, hgt: number): number {
  let se = 0;
  src.forEach((s, i) => {
    const [u, v] = applyH(h, s);
    se += ((u - dst[i][0]) * w) ** 2 + ((v - dst[i][1]) * hgt) ** 2;
  });
  return Math.sqrt(se / Math.max(1, src.length));
}
