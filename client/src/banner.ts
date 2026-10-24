// Tapestries hung on chains from the top of the screen, rippling in the wind: your blue one and the
// red one on the home and result screens. The cloth is a grid of flat facets moved every frame by a
// wave that grows toward the tails; each facet's shade follows its slope, so the folds catch the
// light as they travel down. The text on the cloth (an HTML overlay) sways with it. A frozen
// tapestry (the loser's, on a result screen) turns to ice and barely moves.

const NS = 'http://www.w3.org/2000/svg';
const COLS = 14, ROWS = 26;
// In the SVG's own units (viewBox 0 0 260 600, or taller when the box is: the cloth hangs to fill it).
const L = 20, R = 240, TOP = 126, TEXT_Y = 265; // TEXT_Y: where the overlay's text rides
const W = 260, H = 600;
// Each look's lit and shadowed facet colours (left half lit, right half in shadow) and its trim.
const LOOKS = {
  raven: { lit: [31, 70, 127], shade: [24, 55, 102], trim: '#f3d58a' }, // #1f467f / #183766
  sun: { lit: [150, 42, 56], shade: [116, 30, 43], trim: '#f3d58a' }, // #962a38 / #741e2b
  frozen: { lit: [143, 176, 204], shade: [106, 143, 176], trim: '#dbe9f4' }, // #8fb0cc / #6a8fb0
} as const;
export type House = 'raven' | 'sun';
export interface Tapestry { set(o: { house?: House; frozen?: boolean }): void }

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

// rim: the edge facing the island, which the braziers light. phase: so two tapestries don't move in step.
export function tapestry(svg: SVGSVGElement, overlay: HTMLElement, o: { house: House; rim: 'left' | 'right'; phase?: number }): Tapestry {
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let house = o.house, frozen = false, ice = 0; // ice eases 0 → 1 as the cloth freezes
  const phase = o.phase ?? 0;
  // The tails sit 40 above the bottom of the box, the swallowtail notch 80.
  let tails = H - 40, notch = H - 80;
  const fit = () => {
    const { width, height } = svg.getBoundingClientRect();
    const h = width ? Math.max(H, (W * height) / width) : H;
    svg.setAttribute('viewBox', `0 0 ${W} ${h.toFixed(1)}`);
    tails = h - 40;
    notch = h - 80;
  };
  fit();
  new ResizeObserver(() => { fit(); draw(); }).observe(svg);
  // Chains, the rod and its finials stay put.
  for (const x of [50, 210]) {
    svg.append(el('line', { x1: x, y1: 0, x2: x, y2: 118, stroke: '#1b1e2c', 'stroke-width': 4 }));
    for (let y = 8; y < 112; y += 24) svg.append(el('rect', { x: x - 4, y, width: 8, height: 12, rx: 3, fill: '#2a2f45' }));
  }
  const cloth = el('g', {});
  svg.append(cloth);
  const facets: SVGPolygonElement[] = [];
  for (let k = 0; k < COLS * ROWS; k++) cloth.append((facets[k] = el('polygon', {})));
  const top = el('polygon', { fill: '#000', opacity: 0.3 }); // the shadow under the rod
  const trim = el('polyline', { fill: 'none', 'stroke-width': 1.5, opacity: 0.55 });
  const chevron = el('polygon', { opacity: 0.18 });
  const rim = el('polyline', { fill: 'none', stroke: '#ffb02e', 'stroke-width': 5, opacity: 0.45 }); // brazier light on the edge facing the island
  const knot = el('polygon', { opacity: 0.75 });
  const rime = el('polygon', { fill: '#dbe9f4', opacity: 0 }); // frost gathered along the tails when frozen
  cloth.append(top, chevron, trim, rim, rime, knot);
  svg.append(el('rect', { x: 6, y: 116, width: 248, height: 10, fill: '#1b1e2c' }), el('rect', { x: 6, y: 116, width: 248, height: 3, fill: '#4a4f68' }),
    el('polygon', { points: '0,121 6,113 12,121 6,129', fill: '#c98a2e' }), el('polygon', { points: '248,121 254,113 260,121 254,129', fill: '#c98a2e' }));

  // Where a point on the cloth sits: u across (0 left, 1 right), v down (0 at the rod, 1 at the tails).
  const bottom = (u: number) => tails - (tails - notch) * (1 - Math.abs(2 * u - 1)); // swallowtail
  let t = 0, amp = 0;
  const at = (u: number, v: number): [number, number] => {
    const y = TOP + v * (bottom(u) - TOP);
    const hang = v ** 1.35; // the rod holds the top still
    const tt = t + phase;
    const dx = amp * hang * (Math.sin(v * 5.2 - tt * 2.1 + u * 1.3) + 0.35 * Math.sin(v * 9 - tt * 3.3 + u * 2.6));
    return [L + u * (R - L) + dx, y - Math.abs(dx) * 0.12];
  };
  // Folds running down the cloth: a ridge catches the light, the trough beside it falls into shadow.
  const fold = (u: number, v: number) => Math.sin(u * Math.PI * 2.6 - (t + phase) * 1.7 + v * 3.4) * (0.25 + 0.75 * v ** 1.2) * (amp / 8);
  const pts = (list: [number, number][]) => list.map(([u, v]) => at(u, v).map(n => n.toFixed(1)).join(',')).join(' ');

  const mix = (a: readonly number[], b: readonly number[], k: number) => a.map((n, i) => n + (b[i] - n) * k);
  function draw() {
    const look = LOOKS[house], lit = mix(look.lit, LOOKS.frozen.lit, ice), shade = mix(look.shade, LOOKS.frozen.shade, ice);
    const trimColor = ice > 0.5 ? LOOKS.frozen.trim : look.trim;
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const u0 = i / COLS, u1 = (i + 1) / COLS, v0 = j / ROWS, v1 = (j + 1) / ROWS;
        const a = at(u0, v0), b = at(u1, v0), c = at(u1, v1), d = at(u0, v1);
        // Slope of the facet across x (how much it turns toward the light) shades it.
        const turn = ((b[0] - a[0]) + (c[0] - d[0])) / 2 / ((R - L) / COLS) - 1 + ((d[0] - a[0]) + (c[0] - b[0])) / 2 / 30;
        const base = u0 < 0.5 ? lit : shade;
        const k = Math.max(-0.42, Math.min(0.42, turn * 1.1 + fold((u0 + u1) / 2, (v0 + v1) / 2) * 0.34));
        const rgb = base.map(n => Math.round(k > 0 ? n + (255 - n) * k * 0.35 : n * (1 + k)));
        const f = facets[j * COLS + i];
        f.setAttribute('points', [a, b, c, d].map(p => p.map(n => n.toFixed(1)).join(',')).join(' '));
        f.setAttribute('fill', `rgb(${rgb})`);
        f.setAttribute('stroke', `rgb(${rgb})`); // hides hairline seams between facets
        f.setAttribute('stroke-width', '1');
      }
    }
    const inset = 14 / (R - L);
    top.setAttribute('points', pts([[0, 0], [1, 0], [1, 0.045], [0, 0.045]]));
    trim.setAttribute('points', pts([[inset, 0.045], [inset, 0.95], [0.5, 0.9], [1 - inset, 0.95], [1 - inset, 0.045]]));
    chevron.setAttribute('points', pts([[inset, 0.8], [0.5, 0.73], [1 - inset, 0.8], [1 - inset, 0.83], [0.5, 0.76], [inset, 0.83]]));
    rim.setAttribute('points', pts(Array.from({ length: 12 }, (_, k) => [o.rim === 'right' ? 0.99 : 0.01, k / 11] as [number, number])));
    rim.setAttribute('opacity', String(0.45 * (1 - ice)));
    for (const e of [trim]) e.setAttribute('stroke', trimColor);
    for (const e of [chevron, knot]) e.setAttribute('fill', trimColor);
    rime.setAttribute('opacity', String(0.55 * ice));
    rime.setAttribute('points', pts([[0, 0.86], [0.25, 0.9], [0.5, 0.82], [0.75, 0.9], [1, 0.86], [1, 1], [0.5, 1], [0, 1]]));
    const [kx, ky] = at(0.5, 0.86);
    knot.setAttribute('points', `${kx},${ky - 7} ${kx + 5},${ky} ${kx},${ky + 7} ${kx - 5},${ky}`);
    // The text rides on the cloth at TEXT_Y, however long the cloth is.
    const vt = (TEXT_Y - TOP) / (bottom(0.5) - TOP);
    const [ox] = at(0.5, vt), [ox2] = at(0.5, vt + 0.1 * (H - 40 - TOP) / (bottom(0.5) - TOP));
    overlay.style.transform = `translateX(${((ox - 130) / 260 * 100).toFixed(2)}cqw) rotate(${((ox2 - ox) * 0.4).toFixed(2)}deg)`;
  }

  let last = 0;
  function frame(now: number) {
    requestAnimationFrame(frame);
    if (svg.closest('[hidden]')) return void (last = 0);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (still.matches) {
      if (amp) { amp = 0; draw(); }
      return;
    }
    t += dt;
    ice += ((frozen ? 1 : 0) - ice) * Math.min(1, dt * 1.5);
    // A steady breeze with gusts every so often; frozen cloth hangs stiff.
    const gust = Math.max(0, Math.sin(t * 0.37)) ** 4 + 0.5 * Math.max(0, Math.sin(t * 0.83 + 1)) ** 6;
    amp = (5 + gust * 7) * (1 - ice * 0.85);
    draw();
  }
  draw();
  requestAnimationFrame(frame);
  return {
    set(next) {
      if (next.house) house = next.house;
      if (next.frozen !== undefined) {
        frozen = next.frozen;
        if (still.matches) ice = frozen ? 1 : 0;
      }
      draw();
    },
  };
}
