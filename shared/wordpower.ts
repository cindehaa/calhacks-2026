// Word power: detail in the description sets a troop's strength instead of the noun, and a voice
// lock (or elixir as a cap) pays for it. The deploy delay stays constant: talking is already time. Prototype with switchable presets so we can feel them; pick
// one and delete the rest. Pure, shared by the server, the bot match and the client meter.
//
// "dragon" is a plain dragon. "dragon with laser eyes, blue wings and reinforced claws" keeps
// the dragon's shape (the designer still picks its stats and quirks) but its health and damage
// are rescaled to the budget the detail bought, so the noun no longer decides power: a goblin and
// a dragon with the same detail cost the same.
import { MAX_COST, PRICING, power, quirkMultiplier, type TroopDesign } from './troop';

export type Preset = 'off' | 'cooldown' | 'cap' | 'art';
export type Scorer = 'words' | 'features';
export const PRESETS: readonly Preset[] = ['cooldown', 'art', 'cap', 'off'];

export interface PresetRules {
  label: string;
  elixir: 'normal' | 'none' | 'cap'; // normal: today's pricing; none: free; cap: costs the budget, capped by what you have
  lockPerPower: number; // seconds after a deploy before you can lock the next one, per point of power
  artLanding: boolean; // the troop lands when its sprite is ready (client side, between the delay and ART_MAX)
}

// Starting guesses, all in one place to tune by feel. 0.75 s per point: a plain troop (3) locks
// you for 2.25 s, a legendary 9 for 6.75 s, an overpowered 15 for 11.25 s.
export const RULES: Record<Preset, PresetRules> = {
  cooldown: { label: 'voice lock: more power, longer lock', elixir: 'none', lockPerPower: 0.75, artLanding: false },
  art: { label: 'voice lock, lands when its art is drawn', elixir: 'none', lockPerPower: 0.75, artLanding: true },
  cap: { label: 'elixir cap: power costs elixir', elixir: 'cap', lockPerPower: 0, artLanding: false },
  off: { label: 'off (elixir, as before)', elixir: 'normal', lockPerPower: 0, artLanding: false },
};

// The art preset never holds a drop longer than this after you let go, so a slow fal call
// can't stall it; under the deploy delay it still waits the full delay.
export const ART_MAX = 5.5;

export interface PowerMode { preset: Preset; scorer: Scorer }
export const OFF: PowerMode = { preset: 'off', scorer: 'words' };
export const DEFAULT_MODE: PowerMode = { preset: 'cooldown', scorer: 'words' };

// The mode travels to the server as one short string: "slow" or "slow.features".
export const encodeMode = (m: PowerMode) => (m.scorer === 'words' ? m.preset : `${m.preset}.${m.scorer}`);
// Anything unknown (an old client, a retired preset) falls back to `fallback`.
export function decodeMode(s: string | null | undefined, fallback: Preset = 'off'): PowerMode {
  const [p, sc] = String(s ?? '').toLowerCase().split('.');
  return {
    preset: (PRESETS as readonly string[]).includes(p) ? (p as Preset) : fallback,
    scorer: sc === 'features' ? 'features' : 'words',
  };
}

// ---------- detail ----------

// Glue words, and hype that shouldn't buy anything ("the strongest unit ever").
const STOP = new Set(`a an the of with and or but to in on at for from by as is are be that who which whose its it his her
their this these those some any one two three four five six seven eight nine ten has have had very really super so
extremely incredibly totally just like kind sort plus also too much many lots lot strong stronger strongest powerful
mighty best ultimate ever unit troop thing guy dude creature invincible unstoppable op overpowered most more max maximum
legendary epic cool awesome i want make give me please uh um`.split(/\s+/));

const words = (s: string) => s.toLowerCase().replace(/[^a-z' ,]/g, ' ').split(/[\s,]+/).map(w => w.replace(/^'+|'+$/g, '')).filter(Boolean);
const content = (ws: string[]) => ws.filter(w => w.length > 1 && !STOP.has(w));

export const MAX_DETAIL = 12;

// words: every distinct describing word after the first counts one.
// features: every extra clause ("with laser eyes", ", blue wings", "and reinforced claws") counts
// two, so "big red angry dragon" is still plain but a list of parts is not.
export function detailOf(text: string, scorer: Scorer = 'words'): number {
  if (scorer === 'features') {
    const parts = text.toLowerCase().split(/,|;|\b(?:with|and|plus|that|who|which|wearing|holding|riding|carrying)\b/);
    const seen = new Set<string>();
    let n = 0;
    for (const p of parts) {
      const c = content(words(p)).filter(w => !seen.has(w));
      c.forEach(w => seen.add(w));
      if (c.length) n++;
    }
    return Math.min(MAX_DETAIL, Math.max(0, n - 1) * 2);
  }
  return Math.min(MAX_DETAIL, Math.max(0, new Set(content(words(text))).size - 1));
}

// ---------- what detail buys ----------

export const PLAIN_BUDGET = 3; // a plain anything is about a knight
export const budgetFor = (detail: number) => PLAIN_BUDGET + detail;

export const TIERS = [[0, 'basic'], [1, 'upgraded'], [3, 'elite'], [6, 'legendary'], [9, 'overpowered']] as const;
export const tierOf = (detail: number) => [...TIERS].reverse().find(([d]) => detail >= d)![1];

// Overpowered has to be reachable, so word power gets its own, looser health and damage caps.
export const POWER_CLAMPS = { health: [30, 9000], damage: [6, 1800] } as const;

export interface Quote {
  detail: number;
  tier: string;
  budget: number; // the troop's strength in elixir-equivalents; also the cost pill
  charge: number; // elixir actually taken
  cooldown: number; // seconds after the deploy before the next lock
  error: string | null; // only in cap mode: 'not enough elixir: 1'
}

// What a description gets under a mode. elixir only matters in cap mode.
export function quote(text: string, mode: PowerMode, elixir = Infinity, detailOverride?: number): Quote {
  const r = RULES[mode.preset];
  const detail = detailOverride ?? detailOf(text, mode.scorer);
  let budget = budgetFor(detail);
  let charge = 0;
  let error: string | null = null;
  if (r.elixir === 'cap') {
    budget = Math.min(budget, MAX_COST, Math.floor(elixir));
    charge = budget;
    if (budget < 1) error = 'not enough elixir: 1';
  }
  budget = Math.max(1, budget);
  return { detail, tier: tierOf(detail), budget, charge, error, cooldown: r.lockPerPower * budget };
}

// Rescale health and damage so the design is worth `budget`, keeping its shape (count, range,
// speeds, quirks). Both scale by the same factor, so power (√(hp × dps)) scales by it; if one
// hits its cap the other makes up the difference.
export function empower(d: TroopDesign, budget: number): TroopDesign {
  const now = (power(d, PRICING) * quirkMultiplier(d)) / PRICING.K;
  if (!(now > 0)) return d;
  const f = budget / now;
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.round(Math.min(hi, Math.max(lo, v)));
  const health = clamp(d.health * f, POWER_CLAMPS.health);
  const damage = clamp((d.damage * f * f * d.health) / health, POWER_CLAMPS.damage);
  return { ...d, health, damage };
}

export const usesPower = (m: PowerMode) => m.preset !== 'off';

// ---------- pacing ----------

// When each side may lock its next drop. The server doesn't enforce this yet: the client gates
// its own drops and the bot match gates the bot.
export class Pacer {
  private ready = [0, 0];
  readyAt(side: number) { return this.ready[side]; }
  wait(side: number, now: number) { return Math.max(0, this.ready[side] - now); }
  // now in seconds, on whatever clock the caller uses.
  deployed(side: number, now: number, q: Quote, mode: PowerMode) {
    if (usesPower(mode)) this.ready[side] = now + q.cooldown;
  }
  reset() { this.ready = [0, 0]; }
}
