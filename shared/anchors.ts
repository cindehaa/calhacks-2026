import { PLAIN_QUIRKS, type TroopDesign } from './troop';

// Reference troops. Claude sees them as few-shot points to scale from, players get them as
// starter suggestions (keys 1–0), and the balance sim pits generated troops against them.
// `cost` is what price() gives today; shared/sim.test.ts fails if a stat change moves it.
// The first ten are plain fighters (presentation only, so their costs never moved); the rest
// show Claude what quirked troops look like.
export interface Anchor extends TroopDesign {
  role: string;
  description: string; // what a player might say; also the sprite prompt
  cost: number;
}

const Q = PLAIN_QUIRKS;

export const ANCHORS: Anchor[] = [
  {
    role: 'cheap skirmisher', description: 'a scrappy goblin with a rusty dagger', cost: 2,
    name: 'Goblin Scrapper', health: 420, damage: 100, attack_speed: 1.1, move_speed: 1.5, range: 1, count: 1,
    battle_cry: 'Shiny things are mine!', voice_style: 'squeaky_critter',
    ...Q, motion: 'stab', element: 'none', flavor: 'jabs with a rusty dagger',
  },
  {
    role: 'swarm', description: 'a swarm of angry bees', cost: 3,
    name: 'Bee Swarm', health: 50, damage: 18, attack_speed: 1.2, move_speed: 1.6, range: 1, count: 8,
    battle_cry: 'Bzz! Attack!', voice_style: 'squeaky_critter',
    ...Q, motion: 'bite', element: 'none', flavor: 'dive-bomb stings',
  },
  {
    role: 'melee mini-tank', description: 'a knight with a big shield', cost: 3,
    name: 'Shield Knight', health: 1100, damage: 120, attack_speed: 0.8, move_speed: 0.8, range: 1, count: 1,
    battle_cry: 'For the realm!', voice_style: 'gruff_warrior',
    ...Q, motion: 'slash', element: 'none', flavor: 'bashes with a shield, then a sword swing',
  },
  {
    role: 'ranged pair', description: 'two archers', cost: 5,
    name: 'Twin Archers', health: 200, damage: 70, attack_speed: 1.0, move_speed: 1.0, range: 5, count: 2,
    battle_cry: 'Arrows nocked, let them fly!', voice_style: 'cheerful_hero',
    ...Q, motion: 'shoot', element: 'none', flavor: 'loose arrows in quick pairs',
  },
  {
    role: 'ranged caster', description: 'a wizard who throws fire', cost: 6,
    name: 'Fire Wizard', health: 380, damage: 260, attack_speed: 0.8, move_speed: 0.9, range: 5, count: 1,
    battle_cry: 'Feel the flame!', voice_style: 'mystic_whisper',
    ...Q, motion: 'cast', element: 'fire', flavor: 'hurls a ball of fire',
  },
  {
    role: 'fast assassin', description: 'a ninja assassin', cost: 3,
    name: 'Shadow Ninja', health: 360, damage: 230, attack_speed: 1.3, move_speed: 1.9, range: 1, count: 1,
    battle_cry: 'You never saw me.', voice_style: 'mystic_whisper',
    ...Q, motion: 'slash', element: 'shadow', flavor: 'a blur of katana cuts',
  },
  {
    role: 'heavy ranged', description: 'a goblin that lobs bombs', cost: 7,
    name: 'Bomb Lobber', health: 650, damage: 300, attack_speed: 0.7, move_speed: 0.8, range: 4, count: 1,
    battle_cry: 'Fire in the hole!', voice_style: 'gruff_warrior',
    ...Q, motion: 'lob', element: 'fire', flavor: 'lobs a fizzing bomb',
  },
  {
    role: 'fast tank', description: 'an armored knight on a charging horse', cost: 4,
    name: 'Iron Charger', health: 1100, damage: 180, attack_speed: 0.8, move_speed: 1.6, range: 1, count: 1,
    battle_cry: 'Charge! Nothing stops me!', voice_style: 'cheerful_hero',
    ...Q, motion: 'charge', element: 'none', flavor: 'lowers a lance and gallops through',
  },
  {
    role: 'glass cannon', description: 'a sniper on a rooftop', cost: 6,
    name: 'Rooftop Sniper', health: 220, damage: 600, attack_speed: 0.6, move_speed: 1.0, range: 5, count: 1,
    battle_cry: 'Target acquired.', voice_style: 'robotic',
    ...Q, motion: 'shoot', element: 'none', flavor: 'one long-range rifle crack',
  },
  {
    role: 'big tank', description: 'a slow stone golem', cost: 8,
    name: 'Stone Golem', health: 3000, damage: 300, attack_speed: 0.6, move_speed: 0.5, range: 1, count: 1,
    battle_cry: 'Stone does not yield.', voice_style: 'booming_giant',
    ...Q, motion: 'smash', element: 'none', flavor: 'slams both stone fists down',
  },
  {
    role: 'flying breather', description: 'a fire-breathing dragon', cost: 7,
    name: 'Fire Dragon', health: 500, damage: 90, attack_speed: 0.8, move_speed: 1.0, range: 2, count: 1,
    battle_cry: 'Burn, little castles!', voice_style: 'booming_giant',
    attack: 'breath', targets: 'any', on_hit: 'burn', windup: false, trait: 'flying',
    motion: 'breathe', element: 'fire', flavor: 'breathes a wide jet of flame',
  },
  {
    role: 'chain caster', description: 'a storm wizard', cost: 6,
    name: 'Storm Wizard', health: 340, damage: 140, attack_speed: 0.7, move_speed: 0.9, range: 4, count: 1,
    battle_cry: 'Thunder answers me!', voice_style: 'mystic_whisper',
    attack: 'chain', targets: 'any', on_hit: 'stun', windup: false, trait: 'none',
    motion: 'cast', element: 'lightning', flavor: 'hurls forked lightning',
  },
  {
    role: 'building breaker', description: 'a battering ram', cost: 4,
    name: 'Battering Ram', health: 1400, damage: 250, attack_speed: 0.6, move_speed: 1.0, range: 1, count: 1,
    battle_cry: 'Open the gates!', voice_style: 'gruff_warrior',
    attack: 'single', targets: 'buildings', on_hit: 'none', windup: false, trait: 'none',
    motion: 'charge', element: 'none', flavor: 'slams an iron-capped log into the wall',
  },
  {
    role: 'slowing ranged', description: 'an ice archer', cost: 4,
    name: 'Ice Archer', health: 300, damage: 90, attack_speed: 0.9, move_speed: 1.0, range: 5, count: 1,
    battle_cry: 'Freeze where you stand!', voice_style: 'cheerful_hero',
    attack: 'single', targets: 'any', on_hit: 'slow', windup: false, trait: 'none',
    motion: 'shoot', element: 'ice', flavor: 'shoots frost-tipped arrows',
  },
  {
    role: 'charged splash', description: 'a spark cannon', cost: 7,
    name: 'Spark Cannon', health: 600, damage: 220, attack_speed: 0.5, move_speed: 0.6, range: 5, count: 1,
    battle_cry: 'Charging... fire!', voice_style: 'robotic',
    attack: 'splash', targets: 'any', on_hit: 'none', windup: true, trait: 'none',
    motion: 'shoot', element: 'lightning', flavor: 'fires a crackling ball of sparks',
  },
];
