// The duel, as a script for the game's film mode (client/src/film.ts). Times are seconds of action
// from FIGHT!; spots are board tiles (18 × 30, Cindy's half is y < 14, Isaac's y > 16). The match
// clock runs at 0.6×, so the whole duel ends before overtime. Lines are the troops in troops/.
//
// Beats (story doc 2.x): aim 0.8–6, knight 6–12, dragon 15–28, the turn 28–33, the escalation
// 33–69 (gaps shrinking 7 → 4.5 s), the titan 71.5–80, the cat 83–86.5, towers fall 88–93.

const CINDY = 0, ISAAC = 1;
const say = (t, side, troop, at, talk) => ({ t, say: troop, side, at, talk });
const aim = (t, side, at, dur) => ({ t, aim: at, side, dur });

export const SCRIPT = {
  names: ['Cindy', 'Isaac'],
  clockRate: 0.6,
  events: [
    // Neither side loses a tower until the ending.
    { t: 0, guard: CINDY, min: 0.4 },
    { t: 0, guard: ISAAC, min: 0.55 },

    // 2.2 Aim: Cindy's fingertip sweeps the arena, then settles on the left lane.
    aim(0.8, CINDY, [9, 7], 1.4),
    aim(2.4, CINDY, [14.5, 9.5], 1.6),
    aim(4.2, CINDY, [3.5, 10.5], 1.6),
    // Isaac's hand idles on his side.
    aim(0.8, ISAAC, [9, 22], 2),
    // 2.3–2.6 Imagine it, deploy, generated, cost.
    say(6, CINDY, 'knight', [3.5, 10.5], 2.6),
    // 2.7 The reply: the dragon in the same lane torches the knight.
    aim(13.5, ISAAC, [3.5, 21], 1.2),
    say(15, ISAAC, 'dragon', [3.5, 21], 1.6),
    aim(20, CINDY, [8, 8], 2),
    // 2.9 The escalation.
    aim(31.5, CINDY, [13, 9], 1.2),
    say(33, CINDY, 'ice-wizard', [13, 9], 1.3),
    aim(38.6, ISAAC, [14.5, 21], 1),
    say(40, ISAAC, 'fire-golem', [14.5, 21], 1.1),
    aim(45.3, CINDY, [5, 9], 1),
    say(46.5, CINDY, 'frost-dragon', [5, 9], 1.7),
    aim(51.4, ISAAC, [12, 20], 0.9),
    say(52.5, ISAAC, 'geese', [12, 20], 2.6),
    aim(56.9, CINDY, [3.5, 11], 0.9),
    say(58, CINDY, 'cybertruck', [3.5, 11], 0.9),
    aim(61.6, ISAAC, [4, 20], 0.8),
    say(62.5, ISAAC, 'taylor-swift', [4, 20], 1.4),
    aim(66.1, CINDY, [14.5, 10], 0.8),
    say(67, CINDY, 'skibidi', [14.5, 10], 1.4),
    // 2.10 The peak: the long line, in slow motion (see SLOW).
    aim(70.4, ISAAC, [9, 22], 1),
    say(71.5, ISAAC, 'titan', [9, 22], 6),
    // 2.11 The drop.
    aim(81.6, CINDY, [9, 11], 1.2),
    say(83, CINDY, 'cat', [9, 11], 1),
    // 2.12 The shock: everything of Isaac's freezes, and his towers fall.
    { t: 86.8, stun: ISAAC },
    { t: 87, unguard: ISAAC },
    { t: 88, fell: ISAAC, lane: 0, over: 0.6 },
    { t: 90, fell: ISAAC, lane: 2, over: 0.6 },
    { t: 92.4, fell: ISAAC, lane: 1, over: 0.8 },
  ],
};

// Slow motion, in seconds of action: the knight being generated and landing, and the titan.
export const SLOW = [
  { from: 8.6, to: 12.2, speed: 0.4 },
  { from: 74, to: 80.6, speed: 0.55 },
];

// The titan prices at 17 embers as designed; the game refuses anything over 15, so the film
// trims its health until it fits (and is still the priciest troop of the match).
export const CAP = { titan: 15 };
