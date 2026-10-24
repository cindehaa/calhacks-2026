// Prompt list for the generated sound pack. Edit a prompt and re-run
// generate.mjs: only clips whose prompt or model changed are regenerated.
//
// Durations are in seconds. `variants` makes several takes of the same prompt
// so repeated attacks and hits don't sound identical.

// Appended to every sound-effect prompt so the pack sounds like one game.
export const SFX_STYLE =
  'stylised mobile strategy game sound effect, punchy and clean, close and dry, no reverb tail, no music, no speech';

// One set per `sfx_set` value in the troop JSON. Claude picks the set in the
// same call that writes the stats, so troop sounds add no latency.
export const SFX_SETS = {
  blade: {
    fits: 'knights, soldiers, ninjas, anything with a sword, axe or spear',
    events: {
      spawn: { prompt: 'armour clanking as a warrior lands and draws a sword', duration: 1.0 },
      attack: { prompt: 'quick sword swing whoosh', duration: 0.6, variants: 2 },
      hit: { prompt: 'sword striking a shield, metallic clang', duration: 0.5, variants: 2 },
      death: { prompt: 'armoured warrior collapsing, metal clatter on stone', duration: 1.2 },
    },
  },
  ranged: {
    fits: 'archers, snipers, throwers, anything that shoots from a distance',
    events: {
      spawn: { prompt: 'quiver rattle and a bow being drawn tight', duration: 1.0 },
      attack: { prompt: 'bowstring twang with an arrow whooshing away', duration: 0.6, variants: 2 },
      hit: { prompt: 'arrow thunking into wood', duration: 0.5, variants: 2 },
      death: { prompt: 'bow dropping onto stone and a body falling', duration: 1.2 },
    },
  },
  magic: {
    fits: 'wizards, witches, spirits, ghosts, fire and ice casters',
    events: {
      spawn: { prompt: 'magical shimmer and sparkle as a wizard teleports in', duration: 1.0 },
      attack: { prompt: 'arcane fireball launching with a crackle', duration: 0.7, variants: 2 },
      hit: { prompt: 'magic spell bursting on impact, fizzing sparks', duration: 0.5, variants: 2 },
      death: { prompt: 'magical energy dissipating into a fading shimmer', duration: 1.2 },
    },
  },
  swarm: {
    fits: 'bees, rats, bats, ants, goblin hordes, anything with a high count',
    events: {
      spawn: { prompt: 'angry swarm of insects rushing in, dense buzzing', duration: 1.0 },
      attack: { prompt: 'flurry of tiny bites and stings', duration: 0.6, variants: 2 },
      hit: { prompt: 'small wet splat', duration: 0.5, variants: 2 },
      death: { prompt: 'swarm scattering, buzzing fading away', duration: 1.2 },
    },
  },
  heavy: {
    fits: 'golems, giants, trolls, elephants, anything slow and huge',
    events: {
      spawn: { prompt: 'huge stone golem landing with a ground-shaking thud', duration: 1.2 },
      attack: { prompt: 'massive fist slamming the ground, deep boom', duration: 0.8, variants: 2 },
      hit: { prompt: 'heavy blow cracking rock, deep crunch', duration: 0.5, variants: 2 },
      death: { prompt: 'stone giant crumbling into rubble', duration: 1.5 },
    },
  },
  mech: {
    fits: 'robots, tanks, cannons, drones, anything mechanical or electric',
    events: {
      spawn: { prompt: 'robot powering up, servo whirr and a metallic stomp', duration: 1.0 },
      attack: { prompt: 'sci-fi laser blast zap', duration: 0.6, variants: 2 },
      hit: { prompt: 'electric zap hitting metal, sparks', duration: 0.5, variants: 2 },
      death: { prompt: 'robot short-circuiting and exploding, sparks and clatter', duration: 1.2 },
    },
  },
  beast: {
    fits: 'wolves, dragons, bears, dinosaurs, monsters and other creatures',
    events: {
      spawn: { prompt: 'fierce monster growl and paws landing', duration: 1.0 },
      attack: { prompt: 'claw swipe and snapping jaws', duration: 0.6, variants: 2 },
      hit: { prompt: 'blunt thump on a furry body', duration: 0.5, variants: 2 },
      death: { prompt: 'creature whimpering and thudding to the ground', duration: 1.2 },
    },
  },
};

// Match-wide sounds that don't depend on the troop.
export const GAME_SFX = {
  deploy_pending: {
    // Plays through the 2.5 s deploy delay, so the wait sounds intentional.
    prompt: 'rising magical charge-up, swirling frost and crackling embers building tension',
    duration: 2.5,
  },
  deploy_land: { prompt: 'troop landing in packed snow, punchy impact with a puff of powder snow and an icy crunch', duration: 0.8 },
  tower_hit: { prompt: 'projectile hitting a frosted stone tower, chunky impact with ice chips cracking off', duration: 0.6, variants: 2 },
  tower_destroyed: { prompt: 'frozen stone tower collapsing, ice shattering, big explosion and falling rubble', duration: 2.5 },
  match_start: { prompt: 'deep war horn blast echoing across a frozen valley, signalling the battle start', duration: 2.0 },
  double_elixir: { prompt: 'bright magical gong with a rising shimmer of ice crystals and a whoosh of flame', duration: 1.5 },
  match_end: { prompt: 'final deep gong, a fire flaring up then settling to a soft crackle', duration: 2.0 },
  victory: {
    prompt: 'short triumphant brass fanfare with sparkling sleigh bells and celesta, warm and festive, victory jingle',
    duration: 4.0,
    // Fanfares are music, so drop the "no music" part of the style.
    style: 'stylised mobile game jingle, punchy and clean',
  },
  defeat: {
    prompt: 'short sad descending trombone, a cold wind gust and a fire dying down to embers, defeat jingle',
    duration: 3.0,
    style: 'stylised mobile game jingle, punchy and clean',
  },
  arena_ambience: {
    prompt: 'cold winter wind sweeping over a snowy arena, distant crowd murmur, faint crackling braziers',
    duration: 15,
    loop: true,
    style: 'game background ambience, quiet and even, no music, no speech',
  },
};

// Music loops. The battle and overtime tracks match the 60 s + 30 s split of a
// 90 s match, but the client should still loop them in case timings change.
// Every track sits on a crackling fireplace so the soundtrack fits the
// warmth-and-frost theme (meta/aesthetics.md).
const MUSIC_STYLE =
  'crackling fireplace texture underneath, instrumental, mobile strategy game soundtrack, sits under dialogue, no vocals, loopable';

export const MUSIC = {
  menu: {
    prompt: `cosy winter fireside lobby theme, warm plucked strings, celesta and soft music-box bells, gentle frosty chimes, relaxed, 100 BPM, ${MUSIC_STYLE}`,
    duration: 60,
  },
  battle: {
    prompt: `energetic orchestral battle theme on a frozen night, driving war drums, warm brass stabs over icy shimmering strings and glockenspiel, 120 BPM, ${MUSIC_STYLE}`,
    duration: 60,
  },
  overtime: {
    prompt: `intense climax version of a frost-and-fire orchestral battle theme, faster war drums, urgent icy strings, roaring fire, 140 BPM, ${MUSIC_STYLE}`,
    duration: 30,
  },
};

// Fixed announcer lines, pre-generated with Cartesia TTS so they play with no
// latency. The speakers are shared, so lines are neutral about who is winning.
export const ANNOUNCER = {
  // Leo is listed by Cartesia among the voices with the best emotion control.
  // Check on site that he sounds distinct from the six troop voices.
  voice: '0834f3df-e650-4766-a20c-5a93a43aa6e3',
  lines: {
    match_start: { text: 'Let the battle begin!', emotion: 'excited' },
    double_elixir: { text: 'Double elixir!', emotion: 'enthusiastic' },
    last_ten: { text: 'Ten seconds left!', emotion: 'anticipation' },
    tower_down: { text: 'A tower has fallen!', emotion: 'amazed' },
    match_end: { text: 'Time! The battle is over!', emotion: 'triumphant' },
    draw: { text: "It's a draw!", emotion: 'surprised' },
    too_expensive: { text: 'Not enough elixir!', emotion: 'sarcastic' },
  },
};
