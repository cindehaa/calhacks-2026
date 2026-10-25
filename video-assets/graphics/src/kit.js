// Shared by every graphics page. A page draws itself as a pure function of time, so scripts/render.mjs
// can step it frame by frame: register(duration, draw) exposes window.seek(t) and window.DURATION.

export const P = new URLSearchParams(location.search);
export const num = (k, d) => (P.has(k) ? Number(P.get(k)) : d);
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const mix = (a, b, k) => a + (b - a) * k;
export const ease = {
  linear: (t) => t,
  out: (t) => 1 - (1 - t) ** 3,
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  in: (t) => t ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
};
// 0 → 1 over [start, start + dur], eased.
export const prog = (t, start, dur, e = ease.out) => e(clamp01((t - start) / dur));
// Fade in at the start and out at the end of a page's run.
export const life = (t, D, fadeIn = 0.25, fadeOut = 0.35) => Math.min(prog(t, 0, fadeIn, ease.linear), 1 - prog(t, D - fadeOut, fadeOut, ease.in));

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function register(duration, draw) {
  window.DURATION = duration;
  window.seek = (t) => draw(t);
  // A timer, not requestAnimationFrame: the banner page takes that over to drive the cloth.
  window.ready = document.fonts.ready.then(() => new Promise((r) => setTimeout(() => r(true), 50)));
  window.ready.then(() => draw(0));
}

export function canvas(el) {
  const c = el ?? Object.assign(document.createElement('canvas'), { className: 'fx' });
  c.width = 1920; c.height = 1080;
  if (!el) document.body.append(c);
  return c.getContext('2d');
}

// A burst of embers and ice chips thrown from (x, y) at time t0, like the countdown's FIGHT! slab.
// Spread is the half-width of the line they fly from. Pure in t, so it scrubs.
export function burst(g, t, t0, { x, y, spread = 0, n = 60, seed = 1, power = 1, life = 1.4 } = {}) {
  const dt = t - t0;
  if (dt < 0 || dt > life * 1.6) return;
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const ice = r() < 0.45;
    const a = -Math.PI / 2 + (r() - 0.5) * Math.PI * 1.6;
    const v = (260 + r() * 620) * power;
    const ox = (r() * 2 - 1) * spread, l = life * (0.5 + r() * 0.7);
    const k = dt / l;
    if (k > 1) { r(); r(); continue; }
    const drag = (1 - Math.exp(-3 * dt)) / 3;
    const px = x + ox + Math.cos(a) * v * drag, py = y + Math.sin(a) * v * drag + 420 * dt * dt * (ice ? 1.4 : 0.35);
    const fade = 1 - k * k, size = (ice ? 5 + r() * 9 : 2 + r() * 4) * power ** 0.5, spin = (r() - 0.5) * 14;
    g.save();
    g.translate(px, py);
    if (ice) {
      // A faceted chip: lit and shaded halves, lit from the upper left.
      g.rotate(spin * dt + a);
      g.globalAlpha = fade;
      g.fillStyle = '#dbe9f4';
      g.beginPath(); g.moveTo(-size, 0); g.lineTo(0, -size * 0.7); g.lineTo(size * 0.2, 0); g.closePath(); g.fill();
      g.fillStyle = '#7fb0d8';
      g.beginPath(); g.moveTo(size * 0.2, 0); g.lineTo(0, -size * 0.7); g.lineTo(size, size * 0.3); g.closePath(); g.fill();
    } else {
      g.globalAlpha = fade;
      g.globalCompositeOperation = 'lighter';
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, size * 3);
      grd.addColorStop(0, '#fff2c0'); grd.addColorStop(0.25, '#ffb02e'); grd.addColorStop(1, '#ff8a3d00');
      g.fillStyle = grd;
      g.beginPath(); g.arc(0, 0, size * 3, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
}

// Falling snow over the whole frame; depth sets size, speed and blur. Pure in t.
export function snow(g, t, { n = 160, seed = 7, wind = 30, alpha = 0.8 } = {}) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const z = 0.3 + r() * 0.7, x0 = r() * 2100 - 90, y0 = r() * 1180, sp = 40 + z * 90, sway = r() * 6;
    const y = ((y0 + t * sp) % 1180) - 50, x = ((x0 + t * wind * z + Math.sin(t * 0.9 + sway) * 14 * z) % 2100 + 2100) % 2100 - 90;
    g.globalAlpha = alpha * (0.35 + 0.65 * z);
    g.fillStyle = '#e8f1fb';
    g.beginPath(); g.arc(x, y, 1 + z * 2.6, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

// The side colours: the host is blue (raven), the guest red (sun). Cindy hosts.
export const SIDES = {
  blue: { house: 'raven', accent: '#4aa3ff', cloth: '#1c58c4', name: 'Blue side' },
  red: { house: 'sun', accent: '#ff5d6c', cloth: '#c82424', name: 'Red side' },
};
export const sideOf = (speaker) => (/isaac/i.test(speaker) ? 'red' : 'blue');
