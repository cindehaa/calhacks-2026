// Offline troop designer: no AI, no network. Keeps the game playable without an API key,
// and is the fallback when Claude or the venue wifi fails. Pure and deterministic: the same
// text always gives the same troop. It follows the rules of the Claude prompt (shared/prompt.ts):
// scale from an anchor, ignore numbers and stat words, weak harmless troop for junk.
import { ANCHORS, type Anchor } from './anchors.js';
import { CLAMPS, power, sanitizeDesign, type TroopDesign, type TroopStats, type VoiceStyle } from './troop.js';

type Arch = 'goblin' | 'swarm' | 'knight' | 'archers' | 'wizard' | 'ninja' | 'bomber' | 'charger' | 'sniper' | 'golem';

const ANCHOR_OF: Record<Arch, string> = {
  goblin: 'Goblin Scrapper', swarm: 'Bee Swarm', knight: 'Shield Knight', archers: 'Twin Archers',
  wizard: 'Fire Wizard', ninja: 'Shadow Ninja', bomber: 'Bomb Lobber', charger: 'Iron Charger',
  sniper: 'Rooftop Sniper', golem: 'Stone Golem',
};
const anchor = (a: Arch) => ANCHORS.find(x => x.name === ANCHOR_OF[a])!;

// Beings: what the troop *is*. They head the name. Words are singular; plurals are folded.
const BEINGS: Record<Arch, string> = {
  goblin: 'goblin imp gremlin kobold gnome pixie fairy hobbit pirate bandit thief monkey chimp raccoon squirrel ' +
    'fox kid child peasant clown chicken duck goose frog toad crab parrot penguin hamster mouse alien potato banana',
  swarm: 'bee wasp hornet ant termite locust fly mosquito gnat firefly beetle bug insect rat cockroach piranha ' +
    'minion skeleton bat zombie lemming slime spiderling hatchling bird sparrow pigeon crow seagull',
  knight: 'knight soldier guard paladin warrior viking samurai gladiator spartan templar crusader sentinel defender ' +
    'guardian barbarian mummy bear gorilla turtle tortoise armadillo porcupine hedgehog cactus cyborg android ' +
    'astronaut cop firefighter hero man woman person guy dude monster creature beast',
  archers: 'archer ranger hunter bowman crossbowman slinger gunner cowboy gunslinger elf drone stormtrooper',
  wizard: 'wizard mage witch sorcerer sorceress warlock necromancer shaman druid priest cleric enchanter magician ' +
    'oracle alchemist sage psychic lich phoenix angel devil demon god goddess deity jellyfish snowman',
  ninja: 'ninja assassin rogue spy shinobi cat panther tiger lion leopard jaguar cheetah wolf werewolf vampire ghost ' +
    'snake viper cobra scorpion hawk falcon eagle owl raptor velociraptor shark spider octopus',
  bomber: 'bomber grenadier dragon cannoneer engineer demolitionist hydra toaster spaceship ufo',
  charger: 'horse pony stallion cavalry rider centaur rhino rhinoceros bull boar unicorn car truck motorcycle ' +
    'bike tractor train chariot',
  sniper: 'sniper marksman sharpshooter turret satellite',
  golem: 'golem giant titan troll ogre cyclops colossus behemoth mammoth elephant whale hippo yeti bigfoot kraken ' +
    'robot mech tank fortress treant ent dinosaur trex boulder fridge',
};

// Gear, mounts and verbs: how it fights. Strong gear (4) outweighs the creature (3 as the
// head noun), so "a goblin with a bow" is archers and "a knight on a horse" is a charger.
const GEAR: [Arch, number, string][] = [
  ['archers', 4, 'bow arrow crossbow slingshot sling javelin gun pistol revolver blaster'],
  ['sniper', 4, 'rifle railgun scope'],
  ['bomber', 4, 'cannon catapult grenade dynamite tnt mortar missile explosive'],
  ['charger', 4, 'horse steed saddle'], // a mount decides the style even when a rider is the head noun
  ['charger', 2, 'lance'],
  ['charger', 1, 'charging charge stampede gallop'],
  ['bomber', 1, 'lob throw hurl'],
  ['archers', 1, 'shoot'],
  ['knight', 2, 'shield armor armour'],
  ['knight', 1, 'sword axe mace hammer club spear'],
  ['goblin', 1, 'dagger knife'],
  ['wizard', 2, 'staff wand spell spellbook orb magic'],
  ['ninja', 2, 'katana shuriken'],
  ['ninja', 1, 'claw fang stealth invisible'],
];

// Elements: steer the archetype and can sit in the name ("Ice Golem", "Rooftop Sniper").
const ELEMENTS: [Arch, number, string][] = [
  ['wizard', 1, 'fire flame lava magma ice frost snow lightning thunder storm poison toxic arcane holy'],
  ['ninja', 1, 'shadow'],
  ['golem', 1, 'stone rock crystal'],
  ['sniper', 1, 'rooftop'],
  ['sniper', 4, 'laser'],
  ['bomber', 4, 'bomb rocket'],
];

// Adjectives that move stats. Apart from size, each one trades stats and keeps power roughly level.
type Mod = (s: TroopStats) => void;
const MODS: [string, Mod][] = [
  ['tiny small little baby mini wee teeny puny smol micro miniature pocket', s => { s.health *= 0.5; s.damage *= 0.5 }],
  ['giant huge big large elder mega ancient enormous massive colossal gigantic jumbo titanic', s => { s.health *= 1.5; s.damage *= 1.5 }],
  ['fast quick speedy swift rapid zippy nimble agile hasty turbo hyper', s => { s.move_speed += 0.4; s.health *= 0.9 }],
  ['slow sluggish lazy sleepy lumbering', s => { s.move_speed *= 0.6; s.health *= 1.15 }],
  ['angry furious rabid berserk savage fierce wild mad crazy feral vicious evil raging', s => { s.damage *= 1.2; s.health *= 0.85 }],
  ['armored armoured iron steel metal sturdy tough plated heavy', s => { s.health *= 1.25; s.damage *= 0.9; s.move_speed *= 0.9 }],
];
const MOD_OF = new Map(MODS.flatMap(([ws, f]) => ws.split(' ').map(w => [w, f] as const)));
const SIZE_WORDS = new Set([...MODS[0][0].split(' '), ...MODS[1][0].split(' ')]);
// Name-only adjectives.
const FLAVOR = new Set(('red blue green purple golden gold silver black white pink dark royal cursed undead cosmic ' +
  'space cyber neon scrappy sneaky rusty brave happy grumpy jolly flying winged spooky mighty proud noble twin').split(' '));
// Words of absolute power: a dramatic name, but no stronger than the caster (same rule as the prompt).
const GODLY = new Set('god goddess deity almighty invincible omnipotent immortal unstoppable strongest ultimate overpowered supreme divine'.split(' '));
const GROUPS = new Set('swarm horde army pack flock herd colony legion mob gang squad band crowd hive'.split(' '));
const PLURAL_HINTS = new Set('pair duo couple twin twins many several dozens hundreds thousands millions lots bunch'.split(' '));
const COMMANDS = new Set('cancel undo nevermind abort stop nope nah'.split(' '));
// Ignored outright: filler, numbers, stat and prompt-injection words, speech noise.
const IGNORED = new Set((
  'a an the some with of and or but that who which whose on in at to for from by into onto its it is are be was ' +
  'has have had this these those very really super so just like kind sort my me i you your we our they their his her ' +
  'can will would should could do does please make made give gives want get gets ever all every everything any ' +
  'one two three four five six seven eight nine ten eleven twelve twenty fifty hundred thousand million billion dozen ' +
  'health hp damage dmg attack speed range count elixir cost costs stat stats max maximum min minimum set points ' +
  'point level lvl dps power powerful ignore previous instructions instruction prompt system assistant json ' +
  'override rules rule unit units troop troops thing things card deploy spawn ' +
  'um uh erm hmm ok okay yes no hello hi hey test testing blah bla lorem ipsum'
).split(' '));

const IRREGULAR: Record<string, string> = {
  mice: 'mouse', geese: 'goose', men: 'man', women: 'woman', children: 'child', people: 'person',
  wolves: 'wolf', werewolves: 'werewolf', elves: 'elf', thieves: 'thief', knives: 'knife', cacti: 'cactus',
  octopi: 'octopus', staves: 'staff', ponies: 'pony', fairies: 'fairy',
};
const PLURAL_OF: Record<string, string> = Object.fromEntries(Object.entries(IRREGULAR).map(([p, s]) => [s, p]));

type Kind = 'being' | 'gear' | 'element';
type Entry = { arch: Arch; w: number; kind: Kind };
const LEXICON = new Map<string, Entry[]>();
const add = (words: string, e: Entry) => {
  for (const w of words.split(' ')) LEXICON.set(w, [...(LEXICON.get(w) ?? []), e]);
};
for (const [arch, words] of Object.entries(BEINGS) as [Arch, string][]) add(words, { arch, w: 2, kind: 'being' });
for (const [arch, w, words] of GEAR) add(words, { arch, w, kind: 'gear' });
for (const [arch, w, words] of ELEMENTS) add(words, { arch, w, kind: 'element' });

const isKnown = (w: string) =>
  LEXICON.has(w) || MOD_OF.has(w) || FLAVOR.has(w) || GODLY.has(w) || GROUPS.has(w) || PLURAL_HINTS.has(w);

// Folds a plural onto a known word. Returns [word, wasPlural].
function lookup(t: string): [string, boolean] {
  if (isKnown(t)) return [t, false];
  if (IRREGULAR[t]) return [IRREGULAR[t], true];
  const tries = t.endsWith('ies') ? [t.slice(0, -3) + 'y'] : t.endsWith('es') ? [t.slice(0, -2), t.slice(0, -1)] : t.endsWith('s') ? [t.slice(0, -1)] : [];
  for (const s of tries) if (isKnown(s)) return [s, true];
  return [t, false];
}

function pluralize(w: string): string {
  if (PLURAL_OF[w]) return PLURAL_OF[w];
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  if (/(s|x|ch|sh)$/.test(w)) return w + 'es';
  return w + 's';
}

// Small profanity list: a hit gives the weak troop. Names and cries are built only from the
// lexicon and templates, so nothing the player typed outside the lexicon can be echoed anyway.
const BLOCK_STEMS = ['fuck', 'shit'];
const BLOCK_WORDS = new Set('ass asshole arse bitch bastard slut whore dick cock pussy cunt twat wank piss crap damn porn penis tits boobs'.split(' '));
const blocked = (t: string) =>
  BLOCK_STEMS.some(s => t.includes(s)) || BLOCK_WORDS.has(t) || BLOCK_WORDS.has(t.replace(/e?s$/, ''));

// Keyboard mash and noise: no vowel, long consonant runs, triple letters, keyboard rows.
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function looksLikeWord(t: string): boolean {
  if (t.length < 3 || t.length > 14) return false;
  if (!/[aeiouy]/.test(t) || /[^aeiouy]{5}/.test(t) || /(.)\1\1/.test(t)) return false;
  const rev = [...t].reverse().join('');
  return !(t.length >= 4 && ROWS.some(r => r.includes(t) || r.includes(rev)));
}

// FNV-1a over the normalized text, then a murmur finaliser per pick: same text, same flavour.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
function pick<T>(seed: number, salt: number, list: readonly T[]): T {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return list[((h ^ (h >>> 16)) >>> 0) % list.length];
}

const title = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

interface Flavor { voice: VoiceStyle; epithets: string[]; heads: string[]; cries: string[] }
// {N} is the head noun as it appears in the name.
const FLAVORS: Record<Arch, Flavor> = {
  goblin: { voice: 'squeaky_critter', epithets: ['Scrappy', 'Sneaky', 'Grubby', 'Cheeky'], heads: ['goblin', 'imp'],
    cries: ['Shiny things are mine!', 'Stab first, ask later!', '{N} wants loot!', 'Mine! All mine!', 'Hehehe, gimme gimme!'] },
  swarm: { voice: 'squeaky_critter', epithets: ['Buzzing', 'Swarming', 'Teeming', 'Pesky'], heads: ['swarm'],
    cries: ['Bzz! Attack!', 'There are so many of us!', 'Swarm them, {N}!', 'Nibble nibble nibble!', 'Overwhelm! Overwhelm!'] },
  knight: { voice: 'gruff_warrior', epithets: ['Stalwart', 'Brave', 'Loyal', 'Steadfast'], heads: ['knight', 'guard'],
    cries: ['For the realm!', 'Hold the line!', 'Shields up, {N} advances!', 'None shall pass!', 'Stand firm and strike!'] },
  archers: { voice: 'cheerful_hero', epithets: ['Sharp', 'Keen', 'Steady', 'Eagle-Eyed'], heads: ['archer'],
    cries: ['Arrows nocked, let them fly!', 'Loose!', 'Aim true, {N}!', 'Rain them down!', 'Never miss twice!'] },
  wizard: { voice: 'mystic_whisper', epithets: ['Arcane', 'Wise', 'Mystic', 'Elder'], heads: ['wizard', 'mage'],
    cries: ['Feel the flame!', 'The spell is cast!', 'Magic answers the {N}!', 'Behold my power!', 'By the ancient words!'] },
  ninja: { voice: 'mystic_whisper', epithets: ['Shadow', 'Silent', 'Swift', 'Hidden'], heads: ['ninja', 'assassin'],
    cries: ['You never saw me.', 'Strike from the shadows.', 'The {N} is already here.', 'Silent and swift.', 'One cut is enough.'] },
  bomber: { voice: 'gruff_warrior', epithets: ['Boom', 'Blasting', 'Explosive', 'Kaboom'], heads: ['bomber'],
    cries: ['Fire in the hole!', 'Kaboom incoming!', 'Stand back, {N} is lobbing!', 'Light the fuse!', 'Boom goes the enemy!'] },
  charger: { voice: 'cheerful_hero', epithets: ['Iron', 'Thundering', 'Galloping', 'Raging'], heads: ['charger', 'rider'],
    cries: ['Charge! Nothing stops me!', 'Full speed ahead!', 'Clear the road for {N}!', 'Trample them!', 'Here I come!'] },
  sniper: { voice: 'robotic', epithets: ['Rooftop', 'Steady', 'Deadeye', 'Patient'], heads: ['sniper'],
    cries: ['Target acquired.', 'One shot, one kill.', '{N} has the high ground.', 'Holding my breath.', 'Lined up. Taking it.'] },
  golem: { voice: 'booming_giant', epithets: ['Stone', 'Towering', 'Rumbling', 'Mountain'], heads: ['golem', 'giant'],
    cries: ['Stone does not yield.', 'The ground shakes!', '{N} crushes all!', 'I am the wall.', 'Nothing moves me.'] },
};
const ELEMENT_CRIES = ['Feel the {E}!', 'Taste the {E}!', 'Here comes the {E}!'];
const GODLY_CRIES = ['Kneel before the {N}!', 'Behold, I am unstoppable!', 'Bow to your new master!', 'Witness true power!'];

// Head nouns that change the voice from the archetype's default.
const VOICE_OF: [VoiceStyle, string][] = [
  ['robotic', 'robot mech drone cyborg android turret satellite ufo spaceship tank toaster fridge car truck train tractor'],
  ['booming_giant', 'dragon giant troll ogre titan cyclops colossus behemoth elephant mammoth yeti bigfoot kraken whale bear gorilla trex dinosaur hydra'],
  ['squeaky_critter', 'mouse hamster chicken duck goose frog toad penguin pixie fairy imp gremlin kid child potato banana'],
];
const VOICE_BY_WORD = new Map(VOICE_OF.flatMap(([v, ws]) => ws.split(' ').map(w => [w, v] as const)));

const WEAK_NAMES = ['Confused Blob', 'Lost Duckling', 'Sleepy Pebble', 'Puzzled Puddle', 'Shy Turnip', 'Dizzy Sock',
  'Grumpy Teacup', 'Wobbly Jelly', 'Bashful Cloud', 'Lonely Sprout', 'Soggy Biscuit', 'Startled Snail'];
const WEAK_CRIES = ['Wait, which way is the fight?', 'Am I doing this right?', 'Bloop?', 'Five more minutes...',
  'Hello? Anyone?', 'I come in peace!', 'Is it snack time?', 'Oh no, not again.'];

// Prepositions and relative words end the first noun phrase, where the head noun usually is.
const PHRASE_END = new Set('with of on in at that who which riding holding wielding carrying from and'.split(' '));

interface Token { raw: string; word: string; plural: boolean; entries: Entry[]; at: number }

export type WeakReason = 'empty' | 'command' | 'blocked' | 'gibberish';

interface Analysis {
  seed: number;
  arch: Arch | null; // null: the weak, harmless troop
  reason?: WeakReason;
  tokens: Token[]; // content words only
  head?: Token;
  words: string[];
}

function tokenize(description: string): string[] {
  return String(description ?? '').slice(0, 300).toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter(t => t.length > 1);
}

function analyze(description: string): Analysis {
  const words = tokenize(description);
  const seed = hash(words.join(' '));
  const weak = (reason: WeakReason): Analysis => ({ seed, arch: null, reason, tokens: [], words });
  if (!words.length) return weak('empty');
  if (words.some(blocked)) return weak('blocked');
  if (words.some(t => COMMANDS.has(t)) || / never mind /.test(` ${words.join(' ')} `)) return weak('command');

  const tokens: Token[] = [];
  words.forEach((t, at) => {
    if (IGNORED.has(t)) return;
    const [word, plural] = lookup(t);
    if (!IGNORED.has(word)) tokens.push({ raw: t, word, plural, entries: LEXICON.get(word) ?? [], at });
  });
  if (!tokens.length) return weak('empty');
  if (!tokens.some(t => isKnown(t.word)) && !tokens.some(t => looksLikeWord(t.raw))) return weak('gibberish');

  // "giant" alone is the being, before another noun it's a size ("giant bees").
  for (const t of tokens) {
    if (t.word === 'giant' && tokens.some(x => x.at > t.at && x.entries.length)) t.entries = [];
  }

  const head = headToken(words, tokens);
  const score = new Map<Arch, number>();
  for (const t of tokens) {
    for (const e of t.entries) score.set(e.arch, (score.get(e.arch) ?? 0) + e.w + (t === head && e.kind === 'being' ? 1 : 0));
  }
  // No archetype word: a godly description is a caster, a bare group word ("a horde") is a swarm,
  // anything else a plain mini-tank.
  const bareGroup = tokens.some(t => GROUPS.has(t.word)) && tokens.every(t => isKnown(t.word));
  let arch: Arch = tokens.some(t => GODLY.has(t.word)) ? 'wizard' : bareGroup ? 'swarm' : 'knight';
  let best = 0;
  for (const [a, s] of score) if (s > best) { best = s; arch = a }
  return { seed, arch, tokens, head, words };
}

// The last being in the first noun phrase ("a goblin archer with..." → archer), else the first being.
function headToken(words: string[], tokens: Token[]): Token | undefined {
  const end = words.findIndex((t, i) => i > 0 && PHRASE_END.has(t));
  const beings = tokens.filter(t => t.entries.some(e => e.kind === 'being'));
  return beings.filter(t => end < 0 || t.at < end).at(-1) ?? beings[0];
}

type Size = 'small' | 'medium' | 'big';
// Small swarmers spawn as the Bee Swarm's 8, medium creatures in a group as 3-5, big ones as 2-3.
// A lone medium or big creature is a single body.
const SIZE_OF_ARCH: Record<Arch, Size> = {
  goblin: 'medium', swarm: 'small', knight: 'big', archers: 'medium', wizard: 'medium',
  ninja: 'medium', bomber: 'big', charger: 'big', sniper: 'medium', golem: 'big',
};
// Swarm-archetype beings that are person-sized, not insect-sized.
const MEDIUM_SWARMERS = new Set('skeleton zombie minion slime'.split(' '));
const sizeOf = (arch: Arch, head?: string): Size =>
  arch === 'swarm' && head && MEDIUM_SWARMERS.has(head) ? 'medium' : SIZE_OF_ARCH[arch];

// Spreads the troop's total health and damage over `count` bodies. Per-unit stats can't go below
// the clamps without silently adding power, so a tiny swarm gets fewer bodies instead.
function splitInto(s: TroopStats, count: number) {
  const [minHp, minDmg] = [CLAMPS.health[0], CLAMPS.damage[0]];
  const hp = s.health * s.count, dmg = s.damage * s.count;
  const n = Math.max(1, Math.min(count, Math.floor((hp * 1.2) / minHp), Math.floor((dmg * 1.2) / minDmg)));
  s.health = hp / n;
  s.damage = dmg / n;
  s.count = n;
  // What a floor still adds comes off the other stat, so splitting never adds power.
  if (s.health < minHp) { s.damage *= s.health / minHp; s.health = minHp }
  if (s.damage < minDmg) { s.health *= s.damage / minDmg; s.damage = minDmg }
}

// Scales health and damage down until the troop is no stronger than `cap`.
function capPower(s: TroopStats, cap: number) {
  for (let i = 0; i < 4; i++) {
    const p = power(sanitizeDesign(s));
    if (p <= cap) return;
    const f = (cap / p) * 0.995; // power scales linearly when health and damage both do
    s.health = Math.min(s.health, 3000) * f;
    s.damage = Math.min(s.damage, 600) * f;
  }
}

// Which anchor a description builds on; null means the weak troop. For tests and tuning.
export function pickAnchor(description: string): { anchor: Anchor | null; reason?: WeakReason } {
  const a = analyze(description);
  return a.arch ? { anchor: anchor(a.arch) } : { anchor: null, reason: a.reason };
}

export function designOffline(description: string): TroopDesign {
  const { seed, arch, tokens, head, words } = analyze(description);
  if (!arch) {
    return sanitizeDesign({
      name: pick(seed, 1, WEAK_NAMES), health: 150, damage: 30, attack_speed: 1, move_speed: 1, range: 1, count: 1,
      battle_cry: pick(seed, 2, WEAK_CRIES), voice_style: pick(seed, 3, ['squeaky_critter', 'cheerful_hero'] as const),
    });
  }
  const base = anchor(arch);
  const fl = FLAVORS[arch];
  const s: TroopStats = {
    health: base.health, damage: base.damage, attack_speed: base.attack_speed,
    move_speed: base.move_speed, range: base.range, count: base.count,
  };

  // Adjectives. A size word only counts if it isn't sizing gear ("a knight with a big shield").
  // Elements are skipped, so "tiny fire wizard" still sizes the wizard.
  const sizesGear = (t: Token) => {
    const next = tokens.find(x => x.at > t.at && x.entries.some(e => e.kind !== 'element'));
    return !!next && !next.entries.some(e => e.kind === 'being');
  };
  const adjectives: Token[] = [];
  for (const t of tokens) {
    if (SIZE_WORDS.has(t.word) && t.entries.length === 0 && sizesGear(t)) continue;
    const mod = t.entries.length ? undefined : MOD_OF.get(t.word);
    mod?.(s);
    if (mod || FLAVOR.has(t.word) || GODLY.has(t.word)) adjectives.push(t);
  }

  // Group size comes from what the creature is, never from the words or numbers: a group word
  // or a plural only says "more than one". Total power stays level (it scales with count).
  const size = sizeOf(arch, head?.word);
  const creature = hash(head?.word ?? arch); // per creature, so "wolves" and "a pack of wolves" match
  const group = tokens.find(t => GROUPS.has(t.word));
  const plural = (head?.plural ?? false) || words.some(w => PLURAL_HINTS.has(w));
  const target = size === 'small' ? base.count : group || plural ? (size === 'medium' ? 3 + (creature % 3) : 2 + (creature % 2)) : 1;
  splitInto(s, target);

  // Nothing beats the big tank; words of absolute power stop at the caster.
  const godly = tokens.some(t => GODLY.has(t.word));
  capPower(s, power(anchor(godly ? 'wizard' : 'golem')));

  // Name: [adjective] [element or second being] [head], or [adjective] [noun] [Group].
  const nounWord = head?.word ?? pick(seed, 4, fl.heads);
  const many = s.count > 1 && nounWord !== 'swarm';
  const noun = many ? pluralize(nounWord) : nounWord;
  const element = tokens.find(t => t !== head && t.entries.some(e => e.kind === 'element'));
  const prev = head && tokens.find(t => t.at === head.at - 1);
  const second = prev?.entries.some(e => e.kind === 'being') ? prev : undefined;
  const adj = adjectives[0]?.word;
  let parts = group
    ? [adj, nounWord === 'swarm' ? undefined : nounWord, group.word]
    : [adj, second?.word ?? element?.word, noun];
  parts = parts.filter(Boolean);
  if (parts.length === 1) parts.unshift(godly ? pick(seed, 5, ['Almighty', 'Invincible', 'Supreme']) : pick(seed, 5, fl.epithets));
  const name = [...new Set(parts.map(w => title(w!)))].join(' ');

  const cries = godly ? GODLY_CRIES : element && seed % 3 === 0 ? ELEMENT_CRIES : fl.cries;
  const battle_cry = pick(seed, 6, cries).replace('{N}', title(noun)).replace('{E}', element?.word ?? '');
  const voiced = [head, second].find(t => t && VOICE_BY_WORD.has(t.word));
  const voice_style = voiced ? VOICE_BY_WORD.get(voiced.word)! : fl.voice;

  return sanitizeDesign({ ...s, name, battle_cry, voice_style });
}
