// Spell schema, clamps and pricing. A spell is the other kind of design: no body, it lands
// anywhere on the board (not just your half) and does one thing in a circle there. Like troop
// quirks, the effect is a closed list the engine runs and prices; the look (name, element,
// flavor) is free. A new effect = a value here, its price, engine support in sim.ts and a line
// in the prompt.

// Three classes, by who it touches: attack hurts enemies, nerf hampers enemies, buff helps allies.
export const SPELL_CLASSES = ['attack', 'nerf', 'buff'] as const;
export type SpellClass = (typeof SPELL_CLASSES)[number];

export const SPELL_EFFECTS = [
  // attack
  'blast', // instant damage (fireball, meteor, lightning bolt)
  'shockwave', // instant damage that throws enemies out of the circle (quake, gust, explosion)
  'storm', // damage every second for the duration (poison cloud, blizzard, rain of arrows)
  'vortex', // pulls enemies toward the centre and damages them every second (tornado, black hole)
  // nerf
  'freeze', // enemy units and towers stop entirely
  'slow', // enemies move and attack 40% slower
  'weaken', // enemies deal 40% less damage
  'curse', // enemies take 40% more damage
  // buff
  'heal', // allies regain health every second
  'rage', // allies move and attack 35% faster
  'might', // allies deal 40% more damage
  'shield', // instant: allies gain a shield that soaks hits
] as const;
export type SpellEffect = (typeof SPELL_EFFECTS)[number];

export const SPELL_CLASS_OF: Record<SpellEffect, SpellClass> = {
  blast: 'attack', shockwave: 'attack', storm: 'attack', vortex: 'attack',
  freeze: 'nerf', slow: 'nerf', weaken: 'nerf', curse: 'nerf',
  heal: 'buff', rage: 'buff', might: 'buff', shield: 'buff',
};

// Instant spells act once when they land; the rest are zones that last `duration` seconds.
export const INSTANT: ReadonlySet<SpellEffect> = new Set(['blast', 'shockwave', 'shield']);

// What `amount` means for each effect, and its range. Effects without one ignore it.
// blast, shockwave: damage. storm, vortex: damage per second. heal: health per second. shield: shield hp.
export const AMOUNT: Partial<Record<SpellEffect, [number, number]>> = {
  blast: [50, 1200], shockwave: [50, 1200], storm: [10, 300], vortex: [10, 300], heal: [10, 300], shield: [50, 1000],
};

// Same values as troop on_hit (shared/troop.ts ON_HITS), listed here so this file imports nothing.
export const SPELL_ON_HITS = ['none', 'burn', 'slow', 'stun'] as const;
export type SpellOnHit = (typeof SPELL_ON_HITS)[number];

export interface SpellSpec {
  effect: SpellEffect;
  radius: number; // tiles
  duration: number; // seconds; 0 for an instant spell
  amount: number; // see AMOUNT; 0 for effects without one
  on_hit: SpellOnHit; // attack spells only: applied to every enemy each hit
}

export const SPELL_CLAMPS = { radius: [1, 4], duration: [1, 8] } as const;

// Pricing. Each effect costs `base` embers for a reference spell (radius 2.5, and for amount
// effects the amount in `per`), scaled linearly by amount (or by duration for status effects)
// and by area to the power AREA_EXP, since a bigger circle rarely catches proportionally more.
// A fireball (blast 300, radius 2.5) is 4; freeze for 4 s is 4. Starting guesses, like the
// quirk prices: the balance sim tunes them.
export const REF_RADIUS = 2.5;
export const AREA_EXP = 0.6; // of area, so radius^1.2
const AMOUNT_PRICE: Partial<Record<SpellEffect, { per: number; base: number }>> = {
  blast: { per: 300, base: 4 }, // damage
  shockwave: { per: 300, base: 5 },
  storm: { per: 300, base: 3 }, // total damage, amount × duration
  vortex: { per: 300, base: 6 }, // the pull is worth something on its own
  heal: { per: 400, base: 3 }, // total healing, amount × duration
  shield: { per: 300, base: 3 },
};
// Embers per second of duration, for effects without an amount.
const STATUS_PRICE: Partial<Record<SpellEffect, number>> = {
  freeze: 1, slow: 0.45, weaken: 0.5, curse: 0.6, rage: 0.55, might: 0.55,
};
const ON_HIT_PRICE: Record<SpellOnHit, number> = { none: 1, burn: 1.2, slow: 1.2, stun: 1.25 };
const TOTAL = new Set<SpellEffect>(['storm', 'vortex', 'heal']); // amount is per second

export const isSpellEffect = (v: unknown): v is SpellEffect => SPELL_EFFECTS.includes(v as SpellEffect);

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

// Unknown or missing values fall back to a plain fireball-sized blast.
export function sanitizeSpell(raw: Partial<Record<keyof SpellSpec, unknown>>): SpellSpec {
  const effect = isSpellEffect(raw.effect) ? raw.effect : 'blast';
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  const radius = Math.round(clamp(num(raw.radius, REF_RADIUS), SPELL_CLAMPS.radius) * 2) / 2; // half tiles
  const duration = INSTANT.has(effect) ? 0 : Math.round(clamp(num(raw.duration, 4), SPELL_CLAMPS.duration) * 2) / 2;
  const range = AMOUNT[effect];
  const amount = range ? Math.round(clamp(num(raw.amount, range[0]), range)) : 0;
  // on_hit only rides on attack spells; slow and stun would double up a nerf.
  const on_hit = SPELL_CLASS_OF[effect] === 'attack' && SPELL_ON_HITS.includes(raw.on_hit as SpellOnHit) ? (raw.on_hit as SpellOnHit) : 'none';
  return { effect, radius, duration, amount, on_hit };
}

// Unrounded embers; priceSpell rounds. Clamps first, so raw input can't price outside the rules.
export function exactSpellCost(raw: SpellSpec): number {
  const s = sanitizeSpell(raw);
  const area = Math.pow((s.radius / REF_RADIUS) ** 2, AREA_EXP);
  const ap = AMOUNT_PRICE[s.effect];
  const scale = ap ? ((TOTAL.has(s.effect) ? s.amount * s.duration : s.amount) / ap.per) * ap.base : (STATUS_PRICE[s.effect] ?? 1) * s.duration;
  return scale * area * ON_HIT_PRICE[s.on_hit];
}

export function priceSpell(s: SpellSpec): number {
  return Math.max(1, Math.round(exactSpellCost(s)));
}
