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

export interface TroopDesign extends TroopStats {
  name: string;
  battle_cry: string;
  voice_style: VoiceStyle;
}

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
export const PRICING: Pricing = { K, ranged: 1.3, rangePerTile: 0, speedSlope: 0.25 };

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

// Unclamped power; price() clamps first.
export function power(s: TroopStats, p: Pricing = PRICING): number {
  const hp = s.health * s.count;
  const dps = s.damage * s.attack_speed * s.count;
  const fRange = s.range <= 1 ? 1.0 : p.ranged + p.rangePerTile * (s.range - 1);
  const fSpeed = 1 + p.speedSlope * (s.move_speed - 1);
  return Math.sqrt(hp * dps) * fRange * fSpeed;
}

// Same stats always give the same cost. Can exceed MAX_COST; callers reject those.
export function price(s: TroopStats, p: Pricing = PRICING): number {
  return Math.max(1, Math.round(power(clampStats(s), p) / p.K));
}

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
  return { ...stats, name, battle_cry: trimWords(String(raw.battle_cry ?? '')).slice(0, 80), voice_style: voice };
}

// JSON schema for Claude's structured output. Clamps are enforced in code (clampStats),
// since structured outputs don't support numeric min/max.
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
    battle_cry: { type: 'string' },
    voice_style: { type: 'string', enum: [...VOICE_STYLES] },
  },
  required: ['name', 'health', 'damage', 'attack_speed', 'move_speed', 'range', 'count', 'battle_cry', 'voice_style'],
  additionalProperties: false,
} as const;
