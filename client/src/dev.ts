// Dev settings for playtests: the elixir rules Practice runs on, kept in this browser. Only at
// /dev (dev mode); elsewhere, and in every online match (the server runs those), it's the
// defaults (ELIXIR in shared/arena.ts).
import { ELIXIR, type ElixirRules } from '../../shared/arena';
import { DEV_MODE } from './devmode';

const KEY = 'arena.devElixir';
const LIMITS: Record<keyof ElixirRules, [number, number]> = { max: [1, 30], start: [0, 30], perSec: [0.05, 5] };

const clamp = (k: keyof ElixirRules, v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n)) : ELIXIR[k];
};

// Missing, junk or out-of-range values fall back to the defaults; the start never exceeds the cap.
export function elixirRules(): ElixirRules {
  if (!DEV_MODE) return ELIXIR;
  let saved: Partial<ElixirRules> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {} } catch { /* private mode or junk */ }
  const max = Math.round(clamp('max', saved.max ?? ELIXIR.max));
  return { max, start: Math.min(max, clamp('start', saved.start ?? ELIXIR.start)), perSec: clamp('perSec', saved.perSec ?? ELIXIR.perSec) };
}

const isDefault = (r: ElixirRules) => r.max === ELIXIR.max && r.start === ELIXIR.start && r.perSec === ELIXIR.perSec;

function save(r: ElixirRules | null) {
  try {
    if (r && !isDefault(r)) localStorage.setItem(KEY, JSON.stringify(r));
    else localStorage.removeItem(KEY);
  } catch { /* private mode */ }
}

// Wires the dev settings section in the Practice pop-up: three number fields and Reset.
export function initDevSettings(): void {
  const field = (id: string) => document.getElementById(id) as HTMLInputElement;
  const max = field('devMax'), start = field('devStart'), perSec = field('devRate');
  const status = document.getElementById('devStatus')!;
  const show = () => {
    const r = elixirRules();
    max.value = String(r.max);
    start.value = String(r.start);
    perSec.value = String(r.perSec);
    status.textContent = isDefault(r) ? 'Using the defaults' : 'Changed from the defaults';
  };
  for (const el of [max, start, perSec]) {
    el.onchange = () => {
      save({ max: Number(max.value), start: Number(start.value), perSec: Number(perSec.value) });
      show(); // shows the clamped values
    };
  }
  document.getElementById('devReset')!.onclick = () => {
    save(null);
    show();
  };
  document.getElementById('devDefaults')!.textContent = `Defaults: ${ELIXIR.max} max, ${ELIXIR.start} to start, ${ELIXIR.perSec} per second.`;
  show();
}
