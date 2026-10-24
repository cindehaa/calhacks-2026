import type { TroopDesign } from './troop';

// Reference troops. Claude sees them as few-shot points to scale from, players get them as
// starter suggestions (keys 1–0), and the balance sim pits generated troops against them.
// `cost` is what price() gives today; shared/sim.test.ts fails if a stat change moves it.
export interface Anchor extends TroopDesign {
  role: string;
  description: string; // what a player might say; also the sprite prompt
  cost: number;
}

export const ANCHORS: Anchor[] = [
  {
    role: 'cheap skirmisher', description: 'a scrappy goblin with a rusty dagger', cost: 2,
    name: 'Goblin Scrapper', health: 420, damage: 100, attack_speed: 1.1, move_speed: 1.5, range: 1, count: 1,
    battle_cry: 'Shiny things are mine!', voice_style: 'squeaky_critter',
  },
  {
    role: 'swarm', description: 'a swarm of angry bees', cost: 3,
    name: 'Bee Swarm', health: 50, damage: 18, attack_speed: 1.2, move_speed: 1.6, range: 1, count: 8,
    battle_cry: 'Bzz! Attack!', voice_style: 'squeaky_critter',
  },
  {
    role: 'melee mini-tank', description: 'a knight with a big shield', cost: 3,
    name: 'Shield Knight', health: 1100, damage: 120, attack_speed: 0.8, move_speed: 0.8, range: 1, count: 1,
    battle_cry: 'For the realm!', voice_style: 'gruff_warrior',
  },
  {
    role: 'ranged pair', description: 'two archers', cost: 5,
    name: 'Twin Archers', health: 200, damage: 70, attack_speed: 1.0, move_speed: 1.0, range: 5, count: 2,
    battle_cry: 'Arrows nocked, let them fly!', voice_style: 'cheerful_hero',
  },
  {
    role: 'ranged caster', description: 'a wizard who throws fire', cost: 6,
    name: 'Fire Wizard', health: 380, damage: 260, attack_speed: 0.8, move_speed: 0.9, range: 5, count: 1,
    battle_cry: 'Feel the flame!', voice_style: 'mystic_whisper',
  },
  {
    role: 'fast assassin', description: 'a ninja assassin', cost: 3,
    name: 'Shadow Ninja', health: 360, damage: 230, attack_speed: 1.3, move_speed: 1.9, range: 1, count: 1,
    battle_cry: 'You never saw me.', voice_style: 'mystic_whisper',
  },
  {
    role: 'heavy ranged', description: 'a goblin that lobs bombs', cost: 7,
    name: 'Bomb Lobber', health: 650, damage: 300, attack_speed: 0.7, move_speed: 0.8, range: 4, count: 1,
    battle_cry: 'Fire in the hole!', voice_style: 'gruff_warrior',
  },
  {
    role: 'fast tank', description: 'an armored knight on a charging horse', cost: 4,
    name: 'Iron Charger', health: 1100, damage: 180, attack_speed: 0.8, move_speed: 1.6, range: 1, count: 1,
    battle_cry: 'Charge! Nothing stops me!', voice_style: 'cheerful_hero',
  },
  {
    role: 'glass cannon', description: 'a sniper on a rooftop', cost: 6,
    name: 'Rooftop Sniper', health: 220, damage: 600, attack_speed: 0.6, move_speed: 1.0, range: 5, count: 1,
    battle_cry: 'Target acquired.', voice_style: 'robotic',
  },
  {
    role: 'big tank', description: 'a slow stone golem', cost: 8,
    name: 'Stone Golem', health: 3000, damage: 300, attack_speed: 0.6, move_speed: 0.5, range: 1, count: 1,
    battle_cry: 'Stone does not yield.', voice_style: 'booming_giant',
  },
];
