// Weather for the menus: snow drifting down over the whole screen and, on the home screen,
// embers rising off the island's braziers. One canvas per screen; it only draws while visible.

interface Flake { x: number; y: number; r: number; v: number; a: number; ph: number }
interface Ember { x: number; y: number; vx: number; vy: number; life: number; age: number; r: number; ph: number }

export interface HubFxOpts {
  embers?: HTMLElement // embers rise from the middle of this element
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
    const r = opts.embers!.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    return {
      x: r.left - c.left + r.width * (0.5 + (Math.random() - 0.5) * 0.55), y: r.top - c.top + r.height * (0.25 + Math.random() * 0.35),
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

// The result screens' weather: gold confetti tumbling down and embers rising on a win, snow
// driven sideways by gusts on a loss, a little of both on a draw. `mood` is read every frame.
type Mood = 'win' | 'lose' | 'draw';
interface Bit { x: number; y: number; vx: number; vy: number; r: number; spin: number; a: number; tone: number; kind: 0 | 1 | 2 } // 0 confetti, 1 snow, 2 ember

const GOLDS = ['#f3d58a', '#d6a84a', '#ffd27a', '#b8862f'];

export function resultFx(canvas: HTMLCanvasElement, mood: () => Mood): void {
  const g = canvas.getContext('2d')!;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let w = 0, h = 0, last = 0, shown = false, born = 0;
  let bits: Bit[] = [];

  const make = (m: Mood, top: boolean): Bit => {
    const kind: Bit['kind'] = m === 'win' ? (Math.random() < 0.8 ? 0 : 2) : m === 'lose' ? 1 : Math.random() < 0.5 ? 1 : 2;
    const x = Math.random() * w;
    if (kind === 0) return { kind, x, y: top ? -20 - Math.random() * h * 0.6 : Math.random() * h, vx: (Math.random() - 0.5) * 40, vy: 60 + Math.random() * 90, r: 4 + Math.random() * 6, spin: Math.random() * 6.28, a: 0.9, tone: Math.floor(Math.random() * GOLDS.length) };
    if (kind === 2) return { kind, x, y: h + Math.random() * h * 0.3, vx: (Math.random() - 0.5) * 12, vy: -(25 + Math.random() * 40), r: 1 + Math.random() * 1.6, spin: Math.random() * 6.28, a: 0.9, tone: 0 };
    const depth = Math.random();
    return { kind, x: top ? Math.random() * (w + 200) - 200 : x, y: top ? -10 : Math.random() * h, vx: 30 + depth * 60, vy: 30 + depth * 70, r: 0.6 + depth * 2.4, spin: Math.random() * 6.28, a: 0.25 + depth * 0.6, tone: 0 };
  };

  function frame(now: number) {
    requestAnimationFrame(frame);
    if (canvas.closest('[hidden]')) { shown = false; last = 0; return; }
    if (canvas.clientWidth !== w || canvas.clientHeight !== h) {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const m = mood();
    if (!shown) {
      // Fresh weather for each result: the confetti burst starts above the screen.
      shown = true; born = now;
      bits = Array.from({ length: m === 'lose' ? Math.round((w * h) / 4500) : 90 }, () => make(m, m === 'win'));
    }
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    if (still.matches && dt) return;
    const t = (now - born) / 1000;
    const gust = m === 'lose' ? 1 + Math.max(0, Math.sin(t * 0.7)) ** 6 * 2.5 : 1; // every few seconds the wind picks up
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      b.spin += dt * (b.kind === 0 ? 5 : 1);
      b.x += (b.kind === 1 ? b.vx * gust : b.vx + Math.sin(t * 2 + b.spin) * 20) * dt;
      b.y += b.vy * dt;
      if (b.y > h + 20 || b.y < -40 && b.kind === 2 || b.x > w + 40) bits[i] = make(m, true);
      g.globalAlpha = b.a;
      if (b.kind === 0) {
        // A faceted chip seen edge-on as it tumbles: width follows the spin.
        const sx = Math.cos(b.spin) * b.r, sy = b.r * 0.6;
        g.fillStyle = GOLDS[b.tone];
        g.beginPath();
        g.moveTo(b.x - sx, b.y - sy); g.lineTo(b.x + sx, b.y - sy * 0.4); g.lineTo(b.x + sx * 0.6, b.y + sy); g.lineTo(b.x - sx * 0.8, b.y + sy * 0.5);
        g.fill();
      } else if (b.kind === 2) {
        g.fillStyle = '#ff8a2e'; g.globalAlpha = b.a * 0.25;
        g.beginPath(); g.arc(b.x, b.y, b.r * 4, 0, 6.283); g.fill();
        g.fillStyle = '#ffd27a'; g.globalAlpha = b.a;
        g.beginPath(); g.arc(b.x, b.y, b.r, 0, 6.283); g.fill();
      } else {
        g.fillStyle = '#dbe9f4';
        g.beginPath(); g.arc(b.x, b.y, b.r, 0, 6.283); g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  requestAnimationFrame(frame);
}
