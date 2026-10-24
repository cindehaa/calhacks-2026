// Camera → screen mapping. Both sides are normalised to 0..1, the camera side already mirrored.

export type Pt2 = [number, number];
export type Homography = number[]; // 3×3 row-major, h[8] = 1

// The middle 60 % of the frame (a bit above centre, where a raised hand sits)
// spans the whole screen, like a touchpad.
export const DEFAULT_H: Homography = [1 / 0.6, 0, -0.2 / 0.6, 0, 1 / 0.6, -0.15 / 0.6, 0, 0, 1];

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
