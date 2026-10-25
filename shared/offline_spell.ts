// Offline spell designer: the fallback when Claude is slow or down and the drop has to be a
// spell (aimed over the river), or the words plainly name one. Keyword rules like
// offline_designer.ts: deterministic, no network, the same words always give the same spell.
import { designOffline, pickAnchor } from './offline_designer.js';
import { SPELL_EFFECTS, sanitizeSpell, type SpellEffect, type SpellOnHit } from './spell.js';
import { sanitizeDesign, type Element, type TroopDesign } from './troop.js';

// First match wins, so specific words come before broad ones.
const EFFECT_WORDS: [SpellEffect, string][] = [
  ['vortex', 'tornado twister vortex whirlpool whirlwind cyclone hurricane hole gravity'],
  ['shockwave', 'shockwave quake earthquake tremor gust wind push shove knockback explosion boom thunderclap'],
  ['freeze', 'freeze frozen ice icy frost blizzard snow cold'],
  ['heal', 'heal healing cure mend regenerate regeneration restore medic potion life'],
  ['rage', 'rage haste speed fast frenzy hurry adrenaline coffee'],
  ['might', 'might strength strong power empower buff mighty courage'],
  ['shield', 'shield barrier ward protect protection armor armour bubble'],
  ['curse', 'curse hex doom jinx mark'],
  ['weaken', 'weaken weakness sap drain tired sleep sleepy lullaby'],
  ['slow', 'slow mud tar glue web sticky swamp quicksand molasses'],
  ['storm', 'storm rain cloud poison acid gas toxic plague swarm arrows volley'],
  ['blast', 'fireball fire meteor bolt lightning strike bomb nuke explode blast missile comet smite'],
];
// Words that only ever mean a spell, so the words alone can make one on your own half.
const SPELL_ONLY = new Set(
  'spell fireball meteor comet nuke smite earthquake quake tornado twister vortex blizzard hex curse heal healing rage haste freeze shockwave potion lullaby'.split(' ')
);
const ELEMENT_WORDS: [Element, string][] = [
  ['fire', 'fire fireball flame flaming burn burning lava meteor comet inferno'],
  ['ice', 'ice icy frost frozen freeze snow blizzard cold'],
  ['lightning', 'lightning thunder bolt storm electric shock spark thunderclap'],
  ['poison', 'poison acid toxic gas plague venom'],
  ['holy', 'holy heal healing light divine smite angel bless blessing'],
  ['shadow', 'shadow dark curse hex doom hole void'],
];
const ON_HIT_OF: Partial<Record<Element, SpellOnHit>> = { fire: 'burn', ice: 'slow', lightning: 'stun', poison: 'burn' };
// A middling version of each, about a fireball's price.
const BASE: Record<SpellEffect, { radius: number; duration: number; amount: number; flavor: string }> = {
  blast: { radius: 2.5, duration: 0, amount: 280, flavor: 'a blazing impact' },
  shockwave: { radius: 2.5, duration: 0, amount: 180, flavor: 'a ring of force bursts outward' },
  storm: { radius: 2.5, duration: 4, amount: 60, flavor: 'a churning cloud rains down' },
  vortex: { radius: 3, duration: 3, amount: 40, flavor: 'a spinning funnel drags everything in' },
  freeze: { radius: 2.5, duration: 4, amount: 0, flavor: 'everything freezes solid' },
  slow: { radius: 3, duration: 5, amount: 0, flavor: 'the ground turns to sludge' },
  weaken: { radius: 3, duration: 5, amount: 0, flavor: 'a draining haze settles' },
  curse: { radius: 2.5, duration: 5, amount: 0, flavor: 'dark sigils mark the foe' },
  heal: { radius: 3, duration: 4, amount: 80, flavor: 'warm light mends wounds' },
  rage: { radius: 3, duration: 5, amount: 0, flavor: 'a red frenzy surges' },
  might: { radius: 3, duration: 5, amount: 0, flavor: 'golden power fills the air' },
  shield: { radius: 3, duration: 0, amount: 300, flavor: 'a shimmering bubble forms' },
};
const NAME_OF: Record<SpellEffect, string> = {
  blast: 'Blast', shockwave: 'Shockwave', storm: 'Storm', vortex: 'Vortex', freeze: 'Freeze', slow: 'Mire',
  weaken: 'Weakness', curse: 'Curse', heal: 'Healing', rage: 'Rage', might: 'Might', shield: 'Shield',
};

const words = (s: string) => String(s ?? '').slice(0, 300).toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);
const title = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

// True if the words name a spell on their own ("a fireball", "heal"), not a creature with magic.
export function soundsLikeSpell(description: string): boolean {
  return words(description).some(w => SPELL_ONLY.has(w));
}

// The offline designer for any drop: a spell when it has to be one or the words name one, else a troop.
export function designOfflineAny(description: string, spellOnly = false): TroopDesign {
  return spellOnly || soundsLikeSpell(description) ? designOfflineSpell(description) : designOffline(description);
}

export function designOfflineSpell(description: string): TroopDesign {
  const ws = words(description), set = new Set(ws);
  const found = EFFECT_WORDS.find(([, list]) => list.split(' ').some(w => set.has(w)))?.[0];
  // Junk, a command or an offensive word, like the weak troop: a harmless fizzle.
  if (!found && pickAnchor(description).anchor === null) {
    return sanitizeDesign({
      kind: 'spell', name: 'Fizzle', element: 'none', flavor: 'a puff of harmless sparkles', wish: '',
      spell: sanitizeSpell({ effect: 'blast', radius: 1, amount: 50 }),
    });
  }
  const effect = found ?? 'blast';
  const element = ELEMENT_WORDS.find(([, list]) => list.split(' ').some(w => set.has(w)))?.[0] ?? (effect === 'blast' ? 'fire' : 'none');
  const b = BASE[effect];
  const on_hit = ON_HIT_OF[element] ?? 'none';
  // The most telling word names it: "Meteor Blast", "Poison Storm"; a bare effect gets its own name.
  const key = ws.find(w => EFFECT_WORDS.some(([, list]) => list.split(' ').includes(w)) && !SPELL_EFFECTS.includes(w as SpellEffect));
  const name = key && title(key) !== NAME_OF[effect] ? `${title(key)} ${NAME_OF[effect]}` : NAME_OF[effect];
  return sanitizeDesign({
    kind: 'spell', name, element, flavor: b.flavor, wish: '',
    spell: sanitizeSpell({ effect, radius: b.radius, duration: b.duration, amount: b.amount, on_hit }),
  });
}
