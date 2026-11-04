// The embers bar drawn as a bed of coals: one coal per elixir, heating from dead grey to white-hot
// as it refills. Past halfway its fire catches, rising from the bottom of the bed behind the coal,
// and a full coal burns with a flickering flame. Firing burns the spent coals: their flames leap and
// go out, and embers fly to the summoning circle. Display only; the resource is still `elixir` in code.
let coals: HTMLElement[] = [];
let pile: HTMLElement | null = null;
let layer: HTMLElement | null = null;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initKindling(bar: HTMLElement): void {
  bar.classList.add('kindling');
  pile = bar;
  layer = document.createElement('div');
  layer.id = 'emberFlight';
  document.body.appendChild(layer);
}

// Each coal at its own fraction; the row glows with the total.
export function updateKindling(row: HTMLElement, elixir: number, max: number): void {
  if (coals.length !== Math.ceil(max)) lay(Math.ceil(max));
  row.style.setProperty('--heat', (Math.max(0, Math.min(max, elixir)) / max).toFixed(3));
  for (let i = 0; i < coals.length; i++) {
    const lit = Math.max(0, Math.min(1, elixir - i));
    const c = coals[i], flame = c.lastElementChild as SVGElement;
    c.style.setProperty('--lit', lit.toFixed(2));
    c.classList.toggle('full', lit >= 1);
    // The fire catches past halfway and grows while the coal finishes; a full one flickers (CSS).
    const f = Math.max(0, Math.min(1, (lit - 0.5) / 0.5));
    flame.style.transform = lit >= 1 ? '' : `scale(${f <= 0 ? 0 : (0.35 + 0.5 * f).toFixed(3)})`;
    flame.style.opacity = f <= 0 ? '0' : lit < 1 ? (0.5 + 0.4 * f).toFixed(2) : '1';
  }
}

const flameSvg = (i: number) => `<svg class="flame" viewBox="0 0 22 30" aria-hidden="true"><defs>
<linearGradient id="kfo${i}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#d84a10"/><stop offset=".6" stop-color="#ff8a3d"/><stop offset="1" stop-color="#ffcf70"/></linearGradient>
<linearGradient id="kfi${i}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#fff8e0"/></linearGradient></defs>
<path fill="url(#kfo${i})" d="M11 1 C13 7 20 11 20 19 C20 25 16 29 11 29 C6 29 2 25 2 19 C2 14 6 12 7 7 C8 11 10 12 10 12 C10 8 10 4 11 1Z"/>
<path class="core" fill="url(#kfi${i})" d="M11 12 C12 16 15 18 15 22 C15 26 13 28 11 28 C9 28 7 26 7 22 C7 19 9 17 11 12Z"/></svg>`;

// Rebuilt when the cap changes (Practice can run on other elixir rules).
function lay(n: number) {
  for (const c of coals) c.remove();
  coals = Array.from({ length: n }, (_, i) => {
    const c = document.createElement('div');
    c.className = 'coalCell';
    c.style.left = `${(i / n) * 100}%`;
    c.style.width = `${100 / n}%`;
    c.innerHTML = `<i class="coal"></i>${flameSvg(i)}`;
    c.style.setProperty('--phase', `${-((i * 0.37) % 2.2)}s`); // so the pile doesn't pulse in step
    pile?.appendChild(c);
    return c;
  });
}

// Burn `cost` coals starting at `from` (the whole embers left after paying) and send their embers
// to the screen point (tx, ty).
export function burnCoals(from: number, cost: number, tx: number, ty: number): void {
  if (!layer) return;
  const lo = Math.max(0, Math.floor(from)), hi = Math.min(coals.length, lo + Math.max(1, Math.round(cost)));
  const calm = reduced();
  for (let i = lo; i < hi; i++) {
    const coal = coals[i].firstElementChild as HTMLElement, flame = coals[i].lastElementChild as SVGElement;
    coal.animate([{ filter: 'brightness(2.4)', transform: 'scale(1.18)' }, { filter: 'brightness(1)', transform: 'scale(.86)' }], { duration: 450, easing: 'ease-out' });
    if (calm) continue;
    flame.animate([
      { transform: 'scale(1, 1)', opacity: 1 },
      { transform: 'scale(1.4, 2.1) translateY(-6px)', opacity: 1, offset: 0.35 },
      { transform: 'scale(.4, 2.4) translateY(-14px)', opacity: 0 },
    ], { duration: 420, easing: 'ease-out' });
    const r = coals[i].getBoundingClientRect();
    const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
    for (let k = 0; k < 3; k++) {
      const e = document.createElement('span');
      e.className = 'emberMote';
      layer.appendChild(e);
      const dx = tx - sx, dy = ty - sy;
      const bend = (Math.random() - 0.5) * 160 - 60; // arc up and sideways on the way
      const mx = sx + dx * 0.45 + bend, my = sy + dy * 0.45 - 80 - Math.random() * 60;
      const delay = (i - lo) * 45 + k * 70;
      e.animate([
        { transform: `translate(${sx}px, ${sy}px) scale(1.2)`, opacity: 0 },
        { transform: `translate(${sx}px, ${sy - 8}px) scale(1.3)`, opacity: 1, offset: 0.08 },
        { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${tx + (Math.random() - 0.5) * 18}px, ${ty}px) scale(0.4)`, opacity: 0 },
      ], { duration: 620 + Math.random() * 160, delay, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'backwards' }).onfinish = () => e.remove();
    }
  }
}
