// Small inline SVGs for the menus: low-poly crowns and house shields. Big art (ranges, frost,
// the island, banner cloth) lives in client/public/ui as static files.

export type CrownTone = 'gold' | 'ice' | 'empty-gold' | 'empty-ice' | 'empty';

const CROWN = {
  gold: ['#f3d58a', '#d6a84a'],
  ice: ['#dbe9f4', '#9cc3e0'],
  'empty-gold': ['#4a3e24', '#4a3e24'],
  'empty-ice': ['#2d4a64', '#2d4a64'],
  empty: ['#1a2045', '#1a2045'],
} as const;

export function crownSvg(tone: CrownTone, size = 64): string {
  const [l, r] = CROWN[tone];
  const gem = tone.startsWith('empty') ? '' : '<polygon points="24,12 28,20 24,27 20,20" fill="#ffffff" opacity="0.55"/>';
  return `<svg width="${size}" height="${Math.round(size * 0.9)}" viewBox="-2 -2 52 46" aria-hidden="true">`
    + `<polygon points="0,30 4,8 14,20 24,2 24,30" fill="${l}"/><polygon points="24,2 34,20 44,8 48,30 24,30" fill="${r}"/>`
    + `<polygon points="2,32 24,32 24,42 4,42" fill="${r}"/><polygon points="24,32 46,32 44,42 24,42" fill="${l}"/>${gem}</svg>`;
}

export type House = 'raven' | 'sun';
const SHIELD = { raven: ['#5aaeff', '#2f86e8'], sun: ['#ff7a86', '#e0455a'] } as const;

// A faceted shield with the player's initial; empty draws a dashed outline for a missing player.
export function shieldSvg(house: House, initial: string, size = 50, empty = false): string {
  const h = Math.round(size * 1.15);
  if (empty) return `<svg class="shield" width="${size}" height="${h}" viewBox="0 0 48 55" aria-hidden="true"><polygon points="2,2 46,2 46,26 24,53 2,26" fill="#ffffff08" stroke="#3a4166" stroke-width="1.5" stroke-dasharray="4 3"/></svg>`;
  const [a, b] = SHIELD[house];
  const ch = initial.replace(/[&<>"']/g, '');
  return `<svg class="shield ${house}" width="${size}" height="${h}" viewBox="0 0 48 55" aria-hidden="true">`
    + `<polygon points="2,2 24,2 24,53 2,26" fill="${a}"/><polygon points="24,2 46,2 46,26 24,53" fill="${b}"/>`
    + `<polygon points="2,2 46,2 46,12 2,12" fill="#00000030"/><polygon points="2,26 24,53 24,40" fill="#00000022"/><polygon points="46,26 24,53 24,40" fill="#00000038"/>`
    + `<text x="24" y="31" text-anchor="middle" font-family="Cinzel, serif" font-weight="700" font-size="21" fill="#ffffff">${ch}</text></svg>`;
}
