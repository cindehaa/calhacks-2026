// Procedural placeholder art until sprites exist: a team-coloured disc with an emoji picked
// from the troop's name (or description), falling back to initials. Glyphs are pre-rendered
// once per (glyph, size) into small canvases, so a frame is one drawImage per unit.

// First match wins, so put specific words before generic ones ("wizard" before "fire").
const KEYWORDS: [RegExp, string][] = [
  [/\bbees?\b|wasp|hornet/, '🐝'],
  [/wizard|mage|sorcer|warlock|witch|wizzard/, '🧙'],
  [/golem|stone|rock|boulder|statue/, '🗿'],
  [/ninja|assassin|rogue/, '🥷'],
  [/archer|\bbows?\b|arrow|ranger/, '🏹'],
  [/bomb|lobber|grenade|dynamite|explo/, '💣'],
  [/horse|charger|cavalry|stallion|pony/, '🐎'],
  [/sniper|gunner|rifle|marksman/, '🎯'],
  [/goblin|\bimps?\b|\borcs?\b/, '👺'],
  [/dragon|wyvern|drake/, '🐉'],
  [/dinosaur|t-?rex|raptor/, '🦖'],
  [/skeleton|skull|bones|undead|lich/, '💀'],
  [/ghost|spirit|phantom|spectre|specter/, '👻'],
  [/zombie/, '🧟'],
  [/vampire|dracula/, '🧛'],
  [/robot|mech|android|cyborg|droid/, '🤖'],
  [/alien|ufo|martian/, '👽'],
  [/fairy|pixie|sprite\b/, '🧚'],
  [/angel|holy|paladin|cleric|priest/, '😇'],
  [/demon|devil|fiend/, '😈'],
  [/\bking\b|\bqueen\b|royal|emperor|princess/, '👑'],
  [/pirate|buccaneer/, '☠️'],
  [/cowboy|sheriff|outlaw/, '🤠'],
  [/clown|jester/, '🤡'],
  [/knight|shield|guard|armou?r|soldier|warrior|samurai|viking|gladiator/, '🛡️'],
  [/sword|blade|duel/, '⚔️'],
  [/\bcat\b|kitten|kitty/, '🐈'],
  [/\bdogs?\b|puppy|hound/, '🐕'],
  [/wolf|wolves|werewolf/, '🐺'],
  [/\bbears?\b|grizzly/, '🐻'],
  [/\blions?\b/, '🦁'],
  [/tiger/, '🐅'],
  [/shark/, '🦈'],
  [/snake|serpent|cobra|viper/, '🐍'],
  [/spider|arachn/, '🕷️'],
  [/\bants?\b/, '🐜'],
  [/\brats?\b|mouse|mice/, '🐀'],
  [/\bbats?\b/, '🦇'],
  [/eagle|hawk|falcon|bird|crow|raven|phoenix/, '🦅'],
  [/frog|toad/, '🐸'],
  [/\bpigs?\b|boar|hog/, '🐷'],
  [/chicken|rooster|\bhens?\b/, '🐔'],
  [/duck/, '🦆'],
  [/monkey|\bapes?\b/, '🐒'],
  [/gorilla|kong|giant|ogre|troll|brute/, '🦍'],
  [/elephant|mammoth/, '🐘'],
  [/unicorn/, '🦄'],
  [/octopus|kraken|squid/, '🐙'],
  [/crab|lobster/, '🦀'],
  [/pikachu|electric|lightning|thunder|storm/, '⚡'],
  [/\bice\b|frost|snow|frozen/, '❄️'],
  [/fire|flame|lava|magma|inferno/, '🔥'],
  [/\btrees?\b|\bents?\b|forest|druid/, '🌳'],
  [/mushroom|fung/, '🍄'],
  [/blob|slime|ooze|goo\b|confused/, '🦠'],
  [/rocket|missile/, '🚀'],
  [/cannon|tank|artillery|catapult/, '💥'],
  [/healer|doctor|medic|nurse/, '🩺'],
  [/chef|cook/, '🧑‍🍳'],
];

const glyphMemo = new Map<string, string>();

// The glyph a troop is drawn with: an emoji if a keyword matches (and the platform has colour
// emoji), else its initials.
export function troopGlyph(name: string, description = ''): string {
  const key = name + '\u0000' + description;
  let g = glyphMemo.get(key);
  if (g) return g;
  g = initials(name);
  if (emojiOk()) {
    const n = name.toLowerCase(), d = description.toLowerCase();
    // The name wins over the description ("Fire Wizard" from "a wizard who throws fire").
    g = matchKeyword(n) ?? matchKeyword(d) ?? g;
  }
  glyphMemo.set(key, g);
  return g;
}

function matchKeyword(s: string): string | null {
  if (!s) return null;
  for (const [re, e] of KEYWORDS) if (re.test(s)) return e;
  return null;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(w => /[a-z0-9]/i.test(w));
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export const isEmojiGlyph = (g: string) => /\p{Extended_Pictographic}/u.test(g);

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

let emojiSupport: boolean | null = null;
// Colour emoji render in colour; a missing font renders a grey tofu box. Check once.
function emojiOk(): boolean {
  if (emojiSupport !== null) return emojiSupport;
  emojiSupport = false;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return false;
    g.fillStyle = '#000';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.font = `24px ${EMOJI_FONT}`;
    g.fillText('🐝', 16, 16);
    const d = g.getImageData(0, 0, 32, 32).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0 && (Math.abs(d[i] - d[i + 1]) > 40 || Math.abs(d[i + 1] - d[i + 2]) > 40)) {
        emojiSupport = true;
        break;
      }
    }
  } catch {
    emojiSupport = false;
  }
  return emojiSupport;
}

const cache = new Map<string, HTMLCanvasElement>();

// A pre-rendered glyph about `px` CSS pixels tall, drawn centred at (cx, cy) by the caller.
export function glyphImage(glyph: string, px: number): HTMLCanvasElement {
  const size = Math.max(6, Math.round(px));
  const key = glyph + '|' + size;
  let c = cache.get(key);
  if (c) return c;
  if (cache.size > 300) cache.clear(); // resizes leave old sizes behind
  const dpr = Math.min(3, devicePixelRatio || 1);
  const box = Math.ceil(size * 1.4);
  c = document.createElement('canvas');
  c.width = c.height = Math.ceil(box * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (isEmojiGlyph(glyph)) {
    g.font = `${size}px ${EMOJI_FONT}`;
    g.fillText(glyph, box / 2, box / 2 + size * 0.06);
  } else {
    const fs = glyph.length > 1 ? size * 0.72 : size * 0.9;
    g.font = `800 ${fs}px system-ui, sans-serif`;
    g.fillStyle = '#ffffff';
    g.fillText(glyph, box / 2, box / 2 + fs * 0.04);
  }
  cache.set(key, c);
  return c;
}

// How big a unit looks, as a multiple of the sim radius: 0.85x for the smallest, 1.6x for the
// tankiest, scaling with sqrt(maxHp) so a golem is bigger than a bee but not absurdly so.
export function sizeScale(maxHp: number): number {
  const lo = Math.sqrt(50), hi = Math.sqrt(3000);
  const k = (Math.sqrt(Math.max(50, maxHp)) - lo) / (hi - lo);
  return 0.85 + 0.75 * Math.min(1, Math.max(0, k));
}
