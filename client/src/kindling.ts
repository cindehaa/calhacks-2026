// The embers bar drawn as a kindling pile: ten sticks over a bed of coals, glowing brighter as it
// refills. Firing burns the spent sticks: they catch light and fly as embers to the summoning
// circle. Display only; the resource is still `elixir` in code.
const STICKS = 10;
let sticks: HTMLElement[] = [];
let layer: HTMLElement | null = null;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initKindling(bar: HTMLElement): void {
  bar.classList.add('kindling');
  sticks = Array.from({ length: STICKS }, (_, i) => {
    const s = document.createElement('i');
    s.className = 'stick';
    s.style.left = `${(i / STICKS) * 100}%`;
    s.style.setProperty('--tilt', `${((i * 37) % 11) - 5}deg`); // a little untidy, like a real pile
    bar.appendChild(s);
    return s;
  });
  layer = document.createElement('div');
  layer.id = 'emberFlight';
  document.body.appendChild(layer);
}

// Lit sticks at full heat, the one catching at its fraction, the rest cold; the row glows with the total.
export function updateKindling(row: HTMLElement, elixir: number, max: number): void {
  row.style.setProperty('--heat', (Math.max(0, Math.min(max, elixir)) / max).toFixed(3));
  for (let i = 0; i < sticks.length; i++) sticks[i].style.setProperty('--lit', Math.max(0, Math.min(1, elixir - i)).toFixed(2));
}

// Burn `cost` sticks starting at `from` (the whole embers left after paying) and send their embers
// to the screen point (tx, ty).
export function burnSticks(from: number, cost: number, tx: number, ty: number): void {
  if (!layer) return;
  const lo = Math.max(0, Math.floor(from)), hi = Math.min(STICKS, lo + Math.max(1, Math.round(cost)));
  const calm = reduced();
  for (let i = lo; i < hi; i++) {
    const r = sticks[i].getBoundingClientRect();
    const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
    sticks[i].animate([{ filter: 'brightness(3)' }, { filter: 'brightness(1)' }], { duration: 380, easing: 'ease-out' });
    if (calm) continue;
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
