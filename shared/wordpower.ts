// Word power: detail in the description sets a troop's strength instead of the noun, and time
// (or elixir as a cap) pays for it. Prototype with switchable presets so we can feel them; pick
// one and delete the rest. Pure, shared by the server, the bot match and the client meter.
//
// "dragon" is a plain dragon. "dragon with laser eyes, blue wings and reinforced claws" keeps
// the dragon's shape (the designer still picks its stats and quirks) but its health and damage
// are rescaled to the budget the detail bought, so the noun no longer decides power: a goblin and
// a dragon with the same detail cost the same.
import { MAX_COST, PRICING, power, quirkMultiplier, type TroopDesign } from './troop';

export type Preset = 'off' | 'slow' | 'cooldown' | 'both' | 'cap';
export type Scorer = 'words' | 'features';
export const PRESETS: readonly Preset[] = ['off', 'slow', 'cooldown', 'both', 'cap'];

export interface PresetRules {
  label: string;
  elixir: 'normal' | 'none' | 'cap'; // normal: today's pricing; none: free; cap: costs the budget, capped by what you have
  extraPerDetail: number; // seconds in the air on top of the usual deploy delay, per detail point
  cooldownBase: number; // seconds after a deploy before you can lock the next one ...
  cooldownPerDetail: number; // ... plus this per detail point
  oneInAir: boolean; // the cooldown only starts once your last troop has landed
}

// Starting guesses, all in one place to tune by feel.
export const RULES: Record<Preset, PresetRules> = {
  off: { label: 'off (elixir, as before)', elixir: 'normal', extraPerDetail: 0, cooldownBase: 0, cooldownPerDetail: 0, oneInAir: false },
  slow: { label: 'slow cook: detail = longer in the air', elixir: 'none', extraPerDetail: 0.8, cooldownBase: 1, cooldownPerDetail: 0, oneInAir: true },
  cooldown: { label: 'recharge: detail = longer voice lock', elixir: 'none', extraPerDetail: 0, cooldownBase: 2, cooldownPerDetail: 0.9, oneInAir: false },
  both: { label: 'both: some air time, some lock', elixir: 'none', extraPerDetail: 0.45, cooldownBase: 1.5, cooldownPerDetail: 0.45, oneInAir: false },
  cap: { label: 'elixir cap: detail costs elixir', elixir: 'cap', extraPerDetail: 0, cooldownBase: 0, cooldownPerDetail: 0, oneInAir: false },
};

export interface PowerMode { preset: Preset; scorer: Scorer }
export const OFF: PowerMode = { preset: 'off', scorer: 'words' };

// The mode travels to the server as one short string: "slow" or "slow.features".
export const encodeMode = (m: PowerMode) => (m.scorer === 'words' ? m.preset : `${m.preset}.${m.scorer}`);
export function decodeMode(s: string | null | undefined): PowerMode {
  const [p, sc] = String(s ?? '').toLowerCase().split('.');
  return {
    preset: (PRESETS as readonly string[]).includes(p) ? (p as Preset) : 'off',
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
  extra: number; // seconds added to the deploy delay
  cooldown: number; // seconds before the next lock, from the deploy (or the landing if oneInAir)
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
  return {
    detail, tier: tierOf(detail), budget: Math.max(1, budget), charge, error,
    extra: r.extraPerDetail * detail,
    cooldown: r.cooldownBase + r.cooldownPerDetail * detail,
  };
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
  // now and airTime in seconds, on whatever clock the caller uses.
  deployed(side: number, now: number, q: Quote, airTime: number, mode: PowerMode) {
    if (!usesPower(mode)) return;
    const r = RULES[mode.preset];
    this.ready[side] = now + (r.oneInAir ? airTime : 0) + q.cooldown;
  }
  reset() { this.ready = [0, 0]; }
}
