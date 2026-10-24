// Small inline SVGs for the menus: low-poly crowns and house shields. Big art (ranges, frost,
// the island, banner cloth) lives in client/public/ui as static files.

export type CrownTone = 'gold' | 'ice' | 'empty-gold' | 'empty-ice' | 'empty';

// Lit facet, shadowed facet, and the extruded side underneath (like the menu slabs).
const CROWN = {
  gold: ['#f3d58a', '#d6a84a', '#6e4c17'],
  ice: ['#dbe9f4', '#9cc3e0', '#2b4a66'],
  'empty-gold': ['#4a3e24', '#3d331d', '#1a150b'],
  'empty-ice': ['#2d4a64', '#253e54', '#0f1d2a'],
  empty: ['#1a2045', '#151a38', '#080a18'],
} as const;

export function crownSvg(tone: CrownTone, size = 64): string {
  const [l, r, side] = CROWN[tone];
  const gem = tone.startsWith('empty') ? '' : '<polygon points="24,12 28,20 24,27 20,20" fill="#ffffff" opacity="0.55"/>';
  return `<svg width="${size}" height="${Math.round(size * 0.97)}" viewBox="-2 -2 52 50" aria-hidden="true">`
    + `<g fill="${side}" transform="translate(0 4)"><polygon points="0,30 4,8 14,20 24,2 34,20 44,8 48,30"/><polygon points="2,32 46,32 44,42 4,42"/></g>`
    + `<polygon points="0,30 4,8 14,20 24,2 24,30" fill="${l}"/><polygon points="24,2 34,20 44,8 48,30 24,30" fill="${r}"/>`
    + `<polygon points="2,32 24,32 24,42 4,42" fill="${r}"/><polygon points="24,32 46,32 44,42 24,42" fill="${l}"/>${gem}</svg>`;
}

export type House = 'raven' | 'sun';
const SHIELD = { raven: ['#5aaeff', '#2f86e8', '#123a7a'], sun: ['#ff7a86', '#e0455a', '#6a1724'] } as const; // lit, shadow, extruded side

// A faceted shield with the player's initial; empty draws a dashed outline for a missing player.
export function shieldSvg(house: House, initial: string, size = 50, empty = false): string {
  const h = Math.round(size * 1.23);
  if (empty) return `<svg class="shield" width="${size}" height="${h}" viewBox="0 0 48 55" aria-hidden="true"><polygon points="2,2 46,2 46,26 24,53 2,26" fill="#ffffff08" stroke="#3a4166" stroke-width="1.5" stroke-dasharray="4 3"/></svg>`;
  const [a, b, side] = SHIELD[house];
  const ch = initial.replace(/[&<>"']/g, '');
  return `<svg class="shield ${house}" width="${size}" height="${h}" viewBox="0 0 48 59" aria-hidden="true">`
    + `<polygon points="2,6 46,6 46,30 24,57 2,30" fill="${side}"/>`
    + `<polygon points="2,2 24,2 24,53 2,26" fill="${a}"/><polygon points="24,2 46,2 46,26 24,53" fill="${b}"/>`
    + `<polygon points="2,2 46,2 46,12 2,12" fill="#00000030"/><polygon points="2,26 24,53 24,40" fill="#00000022"/><polygon points="46,26 24,53 24,40" fill="#00000038"/>`
    + `<text x="24" y="31" text-anchor="middle" font-family="Cinzel, serif" font-weight="700" font-size="21" fill="#ffffff">${ch}</text></svg>`;
}
