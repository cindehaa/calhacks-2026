// Weather for the menus: snow drifting down over the whole screen and, on the home screen,
// embers rising off the island's braziers. One canvas per screen; it only draws while visible.

interface Flake { x: number; y: number; r: number; v: number; a: number; ph: number }
interface Ember { x: number; y: number; vx: number; vy: number; life: number; age: number; r: number; ph: number }

export interface HubFxOpts {
  embers?: { x: number; y: number; w: number } // where embers rise from, as fractions of the screen
}

export function hubFx(canvas: HTMLCanvasElement, opts: HubFxOpts = {}): void {
  const g = canvas.getContext('2d')!;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let w = 0, h = 0, last = 0;
  const flakes: Flake[] = [];
  const embers: Ember[] = [];

  const flake = (y?: number): Flake => {
    const depth = Math.random();
    return { x: Math.random() * w, y: y ?? -4, r: 0.5 + depth * 1.9, v: 14 + depth * 46, a: 0.18 + depth * 0.55, ph: Math.random() * 6.28 };
  };
  const ember = (): Ember => {
    const s = opts.embers!;
    return {
      x: (s.x + (Math.random() - 0.5) * s.w) * w, y: s.y * h,
      vx: (Math.random() - 0.5) * 10, vy: -(18 + Math.random() * 30),
      life: 2.5 + Math.random() * 3.5, age: 0, r: 0.8 + Math.random() * 1.4, ph: Math.random() * 6.28,
    };
  };

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const want = Math.round((w * h) / 9000);
    while (flakes.length < want) flakes.push(flake(Math.random() * h));
    flakes.length = Math.min(flakes.length, want);
  }

  function draw(dt: number, t: number) {
    g.clearRect(0, 0, w, h);
    for (const f of flakes) {
      f.y += f.v * dt;
      f.x += Math.sin(t * 0.6 + f.ph) * f.v * 0.25 * dt + 6 * dt;
      if (f.y > h + 4) Object.assign(f, flake());
      if (f.x > w + 4) f.x -= w + 8;
      g.globalAlpha = f.a;
      g.fillStyle = '#dbe9f4';
      g.beginPath(); g.arc(f.x, f.y, f.r, 0, 6.283); g.fill();
    }
    if (opts.embers) {
      if (embers.length < 34 && Math.random() < dt * 9) embers.push(ember());
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.age += dt;
        if (e.age > e.life) { embers.splice(i, 1); continue; }
        e.x += (e.vx + Math.sin(t * 2 + e.ph) * 12) * dt;
        e.y += e.vy * dt;
        const k = e.age / e.life, a = Math.min(1, e.age * 3) * (1 - k);
        g.globalAlpha = a * 0.22;
        g.fillStyle = '#ff8a2e';
        g.beginPath(); g.arc(e.x, e.y, e.r * 4, 0, 6.283); g.fill();
        g.globalAlpha = a;
        g.fillStyle = k < 0.5 ? '#ffd27a' : '#ffb02e';
        g.beginPath(); g.arc(e.x, e.y, e.r, 0, 6.283); g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    if (canvas.closest('[hidden]')) { last = 0; return; }
    if (canvas.clientWidth !== w || canvas.clientHeight !== h) resize();
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    if (still.matches) { if (dt === 0) draw(0, 0); return; }
    draw(dt, now / 1000);
  }
  requestAnimationFrame(frame);
}
