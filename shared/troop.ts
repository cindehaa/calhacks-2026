// Troop stat schema, clamps and pricing. The schema is the single source of truth:
// a new mechanic = a new field here, engine support in sim.ts, and a line in the prompt.

export const VOICE_STYLES = [
  'gruff_warrior',
  'squeaky_critter',
  'mystic_whisper',
  'booming_giant',
  'robotic',
  'cheerful_hero',
] as const;
export type VoiceStyle = (typeof VOICE_STYLES)[number];

export interface TroopStats {
  health: number; // hit points per unit
  damage: number; // per hit
  attack_speed: number; // hits per second
  move_speed: number; // tiles per second
  range: number; // tiles, 1 = melee
  count: number; // identical units spawned
}

// Quirks, two layers. Mechanics are closed lists the engine runs and prices; presentation only
// changes how a troop looks. The first value of each list is the plain choice.
export const ATTACKS = ['single', 'splash', 'breath', 'chain'] as const;
export const TARGETS = ['any', 'buildings'] as const;
export const ON_HITS = ['none', 'burn', 'slow', 'stun'] as const;
export const TRAITS = ['none', 'flying', 'shield', 'spawner', 'death_burst', 'heal_aura', 'charge'] as const;
export const MOTIONS = ['slash', 'smash', 'stab', 'shoot', 'lob', 'cast', 'breathe', 'bite', 'charge', 'other'] as const;
export const ELEMENTS = ['none', 'fire', 'ice', 'lightning', 'poison', 'holy', 'shadow'] as const;
export type Attack = (typeof ATTACKS)[number];
export type Targets = (typeof TARGETS)[number];
export type OnHit = (typeof ON_HITS)[number];
export type Trait = (typeof TRAITS)[number];
export type Motion = (typeof MOTIONS)[number];
export type Element = (typeof ELEMENTS)[number];

export interface TroopQuirks {
  attack: Attack; // how a hit lands
  targets: Targets; // what it chases
  on_hit: OnHit; // effect after a hit
  windup: boolean; // visible charge before each hit
  trait: Trait; // one special rule at most
}

export interface TroopLook {
  motion: Motion; // attack animation
  element: Element; // effect colour; cosmetic, a fire troop burns only with on_hit burn
  flavor: string; // what the attack looks like, 10 words or fewer
}

export const PLAIN_QUIRKS: TroopQuirks = { attack: 'single', targets: 'any', on_hit: 'none', windup: false, trait: 'none' };

export type TroopDesign = TroopStats & TroopQuirks & TroopLook & {
  name: string;
  battle_cry: string;
  voice_style: VoiceStyle;
};

export const STAT_KEYS = ['health', 'damage', 'attack_speed', 'move_speed', 'range', 'count'] as const;
const INT_STATS = new Set<keyof TroopStats>(['health', 'damage', 'range', 'count']);

export const CLAMPS: Record<keyof TroopStats, [number, number]> = {
  health: [50, 3000],
  damage: [10, 600],
  attack_speed: [0.3, 3],
  move_speed: [0.3, 2],
  range: [1, 6],
  count: [1, 12],
};

export const K = 95;
export const MAX_COST = 10;

// Pricing knobs, a parameter of power()/price() so the balance sim can try other values.
export interface Pricing {
  K: number;
  ranged: number; // f_range for range > 1 ...
  rangePerTile: number; // ... plus this per tile of range above 1
  speedSlope: number; // f_speed = 1 + speedSlope × (move_speed − 1)
}
// Range is charged per tile and speed is free: the balance sim (sim/README.md) showed long range
// winning trades 3-14x at a flat 1.3, and speed buying nothing in fights.
export const PRICING: Pricing = { K, ranged: 1.3, rangePerTile: 0.2, speedSlope: 0 };

export function clampStats(s: TroopStats): TroopStats {
  const out = {} as TroopStats;
  for (const k of STAT_KEYS) {
    const [lo, hi] = CLAMPS[k];
    let v = Number.isFinite(s[k]) ? s[k] : lo;
    v = Math.min(hi, Math.max(lo, v));
    out[k] = INT_STATS.has(k) ? Math.round(v) : v;
  }
  return out;
}

// Price multiplier per quirk value (spec: Troop quirks → Quirk rules). The plain choices are 1,
// so a troop without quirks prices exactly as before. Starting guesses for the balance sim to tune.
export const QUIRK_PRICE = {
  attack: { single: 1, splash: 1.4, breath: 1.5, chain: 1.4 },
  targets: { any: 1, buildings: 0.8 },
  on_hit: { none: 1, burn: 1.2, slow: 1.2, stun: 1.25 },
  windup: { false: 1, true: 0.85 },
  trait: { none: 1, flying: 1.3, shield: 1.15, spawner: 1.3, death_burst: 1.15, heal_aura: 1.25, charge: 1.15 },
} as const satisfies { [K in keyof TroopQuirks]: Record<string, number> };

// Product of the quirk multipliers; missing or unknown values count as plain.
export function quirkMultiplier(q: Partial<TroopQuirks> = {}): number {
  const f = <T extends Record<string, number>>(table: T, v: unknown) => (table as Record<string, number>)[String(v)] ?? 1;
  return f(QUIRK_PRICE.attack, q.attack) * f(QUIRK_PRICE.targets, q.targets) * f(QUIRK_PRICE.on_hit, q.on_hit) *
    f(QUIRK_PRICE.windup, q.windup === true) * f(QUIRK_PRICE.trait, q.trait);
}

// Unclamped power of the stats alone; price() clamps first and adds the quirks.
export function power(s: TroopStats, p: Pricing = PRICING): number {
  const hp = s.health * s.count;
  const dps = s.damage * s.attack_speed * s.count;
  const fRange = s.range <= 1 ? 1.0 : p.ranged + p.rangePerTile * (s.range - 1);
  const fSpeed = 1 + p.speedSlope * (s.move_speed - 1);
  return Math.sqrt(hp * dps) * fRange * fSpeed;
}

// Same stats and quirks always give the same cost. Can exceed MAX_COST; callers reject those.
// Quirks come from `s` itself (a whole design) unless passed separately; the second argument may
// also be the pricing knobs, so price(design, knobs) still works for the balance sim.
export function price(s: TroopStats & Partial<TroopQuirks>, q?: Partial<TroopQuirks> | Pricing, p: Pricing = PRICING): number {
  if (q && 'K' in q) [p, q] = [q, undefined];
  const mult = quirkMultiplier(q ?? s);
  return Math.max(1, Math.round((power(clampStats(s), p) * mult) / p.K));
}

// A description as lowercase words, so "A Fire-Wizard!" and "a fire wizard" share a design
// request and a sprite. Sprite cache ids hash this, so changing it redraws all the art.
export const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

export function trimWords(s: string, n = 8): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(' ');
}

// Cleans up a raw design (from Claude or a client) into something safe to play.
export function sanitizeDesign(raw: Partial<TroopDesign>): TroopDesign {
  const stats = clampStats({
    health: Number(raw.health),
    damage: Number(raw.damage),
    attack_speed: Number(raw.attack_speed),
    move_speed: Number(raw.move_speed),
    range: Number(raw.range),
    count: Number(raw.count),
  });
  const name = trimWords(String(raw.name ?? ''), 3).slice(0, 32) || 'Mystery Troop';
  const voice = VOICE_STYLES.includes(raw.voice_style as VoiceStyle)
    ? (raw.voice_style as VoiceStyle)
    : 'cheerful_hero';
  return {
    ...stats, ...sanitizeQuirks(raw), ...sanitizeLook(raw),
    name, battle_cry: trimWords(String(raw.battle_cry ?? '')).slice(0, 80), voice_style: voice,
  };
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T => (list.includes(v as T) ? (v as T) : list[0]);

// Unknown values fall back to the plain choice. trait is a single field, so "at most one" holds.
export function sanitizeQuirks(raw: Partial<TroopQuirks>): TroopQuirks {
  return {
    attack: oneOf(ATTACKS, raw.attack),
    targets: oneOf(TARGETS, raw.targets),
    on_hit: oneOf(ON_HITS, raw.on_hit),
    windup: raw.windup === true || (raw.windup as unknown) === 'true',
    trait: oneOf(TRAITS, raw.trait),
  };
}

export function sanitizeLook(raw: Partial<TroopLook>): TroopLook {
  const motion = MOTIONS.includes(raw.motion as Motion) ? (raw.motion as Motion) : 'other';
  return { motion, element: oneOf(ELEMENTS, raw.element), flavor: trimWords(String(raw.flavor ?? ''), 10).slice(0, 80) };
}

// JSON schema for Claude's structured output. Clamps are enforced in code (clampStats),
// since structured outputs don't support numeric min/max. battle_cry and voice_style aren't asked
// for: nothing has used them since the battle cries were cut, and every output token is latency.
// sanitizeDesign fills them in.
export const TROOP_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    health: { type: 'integer' },
    damage: { type: 'integer' },
    attack_speed: { type: 'number' },
    move_speed: { type: 'number' },
    range: { type: 'integer' },
    count: { type: 'integer' },
    attack: { type: 'string', enum: [...ATTACKS] },
    targets: { type: 'string', enum: [...TARGETS] },
    on_hit: { type: 'string', enum: [...ON_HITS] },
    windup: { type: 'boolean' },
    trait: { type: 'string', enum: [...TRAITS] },
    motion: { type: 'string', enum: [...MOTIONS] },
    element: { type: 'string', enum: [...ELEMENTS] },
    flavor: { type: 'string' },
  },
  required: [
    'name', 'health', 'damage', 'attack_speed', 'move_speed', 'range', 'count',
    'attack', 'targets', 'on_hit', 'windup', 'trait', 'motion', 'element', 'flavor',
  ],
  additionalProperties: false,
} as const;
