// The Pavilion of Imagination: a wall of every troop and spell anyone has summoned, newest first
// (repeats stacked into one pile), with the total, how many were yours, and your latest one in the spotlight. Opened from home and
// from the result screen, or on its own at /pavilion (pavilion.html) for a second tab.
//
// It reads the public pavilion table over SpacetimeDB's HTTP SQL endpoint and polls for new rows,
// rather than joining the game's subscription. That keeps it out of the game's way entirely: a
// database without the table yet (the server not published) only leaves this screen saying so,
// and the game's own bindings and subscribeToAllTables don't change.
import { SQL_URL } from './dbhost';
import { icon, mountIcons } from './icons';
import { hubFx } from './hubfx';
import { myIdentities, newestFirst, parseExhibits, pileKey, piles, tally, type Exhibit, type Pile } from './pavilion_data';
import { elementColors, troopGlyph } from './tokens';
import './pavilion.css';

const POLL_MS = 2500;
const WALL_MAX = 600; // piles on the wall; the counts still cover every row
const CASCADE = 36; // piles that rise in one after another on open; the rest just appear
const FRESH_MS = 6000; // how long a pile that grew while open keeps its glow

let root: HTMLElement | null = null;
let rows: Exhibit[] = [];
let lastId = -1; // highest row id fetched
let loaded = false; // the first fetch has answered
let timer = 0;
let busy = false;
let shownTotal = 0; // what the big number reads, for its count up
let onClose: (() => void) | null = null;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root!.querySelector(sel) as T;

// The pavilion itself: a gabled stone roof with snow on it and icicles off the eaves, over a
// carved beam with the name, between two columns with a brazier burning at each foot. The roof
// scrolls away with the header; the columns and fires stay, framing the wall.
function roof(): string {
  let icicles = '';
  for (let x = 14; x < 1000; x += 22 + ((x * 7) % 13)) {
    const len = 8 + ((x * 13) % 17);
    icicles += `<polygon points="${x - 4},188 ${x + 4},188 ${x},${188 + len}" fill="#dbe9f4" opacity="${0.55 + ((x * 3) % 5) / 10}"/>`;
  }
  return `<svg class="pavRoof" viewBox="0 0 1000 214" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="20,160 500,24 500,160" fill="#343d6e"/><polygon points="500,24 980,160 500,160" fill="#252b4a"/>
    <polygon points="120,152 500,50 500,152" fill="#1f2650"/><polygon points="500,50 880,152 500,152" fill="#181d3d"/>
    <polyline points="120,152 500,50 880,152" fill="none" stroke="#f3d58a" stroke-width="3" vector-effect="non-scaling-stroke"/>
    <polygon points="6,162 500,14 994,162 980,168 500,30 20,168" fill="#eef6fb"/>
    <polygon points="500,14 994,162 980,168 500,30" fill="#9cc3e0"/>
    <rect x="0" y="160" width="1000" height="16" fill="#2e3558"/><rect x="0" y="176" width="1000" height="12" fill="#1c2140"/>
    <rect x="0" y="160" width="1000" height="2" fill="#ffffff30"/>
    ${icicles}
  </svg>`;
}

function column(side: 'l' | 'r'): string {
  const sparks = Array.from({ length: 9 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i * 0.53) % 3}s;--t:${2.2 + ((i * 0.7) % 1.6)}s"></i>`).join('');
  return `<div class="pavCol ${side}" aria-hidden="true">
    <div class="pavCap"></div><div class="pavShaft"></div><div class="pavBase"></div>
    <div class="pavFire"><div class="pavGlowFire"></div><div class="pavSparks">${sparks}</div>
      <div class="pavFlame"><i></i><i></i><i></i></div><div class="pavBowl"></div><div class="pavStand"></div></div>
  </div>`;
}

function build(standalone: boolean): HTMLElement {
  const el = document.createElement('div');
  el.id = 'pavilion';
  el.className = `pavilion${standalone ? ' standalone' : ''}`;
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'pavTitle');
  // Standalone, "close" is the way into the game; over the game it just closes.
  const close = standalone
    ? `<a id="pavilionClose" class="slab amber pavPlay" href="/"><span class="face"><i class="ico" data-icon="swords" data-tone="carved" data-size="26"></i><b>Play</b></span></a>`
    : `<button id="pavilionClose" class="slab stone icon" aria-label="Close"><span class="face"><i class="ico" data-icon="close" data-tone="light" data-size="18"></i></span></button>`;
  el.innerHTML = `
    <img class="gBg" src="/ui/home.svg" alt="">
    <div class="pavDim"></div>
    <canvas class="hubSky" aria-hidden="true"></canvas>
    <div class="pavFloor" aria-hidden="true"></div>
    <div class="pavScroll">
      <header class="pavHead">
        <div class="pavGable">${roof()}<span class="pavEmblem">${icon('star', 'gold', 54)}</span></div>
        <div class="pavBeam">
          <h2 id="pavTitle" class="pavTitle">Pavilion of Imagination</h2>
        </div>
        <div class="pavCount"><b id="pavTotal">0</b><small>summoned this weekend</small></div>
        <p class="pavSub"><span id="pavYours"></span><span id="pavKinds"></span></p>
        <p id="pavStatus" class="pavStatus" hidden></p>
      </header>
      <section id="pavSpot" class="pavSpot" hidden></section>
      <div class="pavWallHead" id="pavWallHead"><i></i><span class="gLabel">The collection</span><i></i></div>
      <div id="pavWall" class="pavWall"></div>
    </div>
    ${column('l')}${column('r')}
    <div class="pavClose">${close}</div>
    <div id="pavToast" class="pavToast" hidden></div>`;
  mountIcons(el);
  el.querySelector('button#pavilionClose')?.addEventListener('click', () => closePavilion());
  hubFx(el.querySelector<HTMLCanvasElement>('.hubSky')!); // the same snow as home; it only draws while shown
  return el;
}

// Creates the screen (hidden) once. `standalone` is the /pavilion page, where it's all there is.
export function mountPavilion(opts: { standalone?: boolean; onClose?: () => void } = {}): void {
  if (root) return;
  root = build(!!opts.standalone);
  onClose = opts.onClose ?? null;
  document.body.appendChild(root);
}

export const pavilionOpen = () => !!root && !root.hidden;

export function openPavilion(): void {
  mountPavilion();
  // Drop focus from the button that opened it: Space and Esc fall back on the focused button, so
  // it would open the Pavilion again right after Esc closed it.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const first = root!.hidden;
  root!.hidden = false;
  if (first) {
    $('.pavScroll').scrollTop = 0;
    shownTotal = 0;
    if (loaded) render(true);
    else status('Opening the Pavilion…');
  }
  void poll();
}

export function closePavilion(): void {
  if (!root || root.hidden) return;
  root.hidden = true;
  clearTimeout(timer);
  onClose?.();
}

// ---------- fetching ----------

async function fetchRows(since: number | null): Promise<{ rows: Exhibit[] } | { error: string }> {
  const sql = since === null ? 'SELECT * FROM pavilion' : `SELECT * FROM pavilion WHERE id > ${since}`;
  try {
    const r = await fetch(SQL_URL, { method: 'POST', body: sql, signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    if (!r.ok) return { error: /no such table/i.test(text) ? 'missing' : `HTTP ${r.status}` };
    return { rows: parseExhibits(JSON.parse(text)) };
  } catch (e) {
    return { error: (e as Error)?.message ?? String(e) };
  }
}

async function poll(): Promise<void> {
  clearTimeout(timer);
  if (!pavilionOpen()) return;
  if (!busy && document.visibilityState === 'visible') {
    busy = true;
    const backlog = !loaded;
    const got = await fetchRows(backlog ? null : lastId);
    busy = false;
    if ('error' in got) {
      status(got.error === 'missing'
        ? 'The Pavilion opens once the server has its new table. Summon away: every troop from now on lands here.'
        : `Can't reach the Pavilion right now (${got.error}). Trying again…`);
    } else {
      status('');
      loaded = true;
      const fresh = got.rows.filter(r => r.id > lastId);
      if (fresh.length) {
        rows.push(...fresh);
        for (const r of fresh) lastId = Math.max(lastId, r.id);
        rows.sort(newestFirst);
      }
      // The first answer is the backlog and rises in; rows after it arrive as new.
      if (backlog) render(true);
      else if (fresh.length) render(false, fresh);
    }
  }
  if (pavilionOpen()) timer = window.setTimeout(() => void poll(), POLL_MS);
}

function status(msg: string) {
  const s = $('#pavStatus');
  s.textContent = msg;
  s.hidden = !msg;
}

// ---------- drawing ----------

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function card(e: Exhibit, art: string, mine: boolean, big = false): string {
  const glyph = esc(troopGlyph(e.name, e.description));
  const img = art ? `<img src="${esc(art)}" alt="" loading="${big ? 'eager' : 'lazy'}" decoding="async">` : '';
  const cls = ['pavCard', e.kind, mine ? 'mine' : '', art ? '' : 'noArt'].filter(Boolean).join(' ');
  return `<figure class="${cls}">
    <div class="pavArt"><span class="pavPedestal"></span><span class="pavGlyph">${glyph}</span>${img}</div>
    <figcaption><b>${esc(e.name)}</b><small>“${esc(e.description || e.name)}”</small></figcaption>
    <span class="pavCost" title="Cost">${e.cost}</span>
    ${e.kind === 'spell' ? '<span class="pavTag">Spell</span>' : ''}
    ${mine ? '<span class="pavMine">You</span>' : ''}
  </figure>`;
}

const colors = (e: Exhibit) => elementColors(e.element) ?? (e.kind === 'spell' ? ['#8f9bff', '#dfe3ff'] : ['#f3d58a', '#fff3cf']);

// A pile: the card, with the sheets of its repeats fanned out behind it and how many there are.
function pileHtml(p: Pile, fresh: boolean): string {
  const [main, light] = colors(p.top);
  const sheets = p.count > 2 ? '<i class="pavSheet s2"></i><i class="pavSheet s1"></i>' : p.count > 1 ? '<i class="pavSheet s1"></i>' : '';
  const tilt = ((p.top.id * 37) % 5) - 2; // a pile is never squared up quite the same way twice
  const cls = ['pavPile', p.count > 1 ? 'stacked' : '', p.mine ? 'mine' : '', fresh ? 'fresh' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}" data-key="${esc(p.key)}" style="--el:${main};--elLight:${light};--tilt:${tilt}deg">${sheets}${card(p.top, p.art, p.mine)}${p.count > 1 ? `<span class="pavTimes" title="Summoned ${p.count} times">×${p.count}</span>` : ''}</div>`;
}

// A sprite that 404s (art from another deploy, or a cleared cache) falls back to the glyph.
function watchArt(scope: HTMLElement) {
  for (const img of scope.querySelectorAll<HTMLImageElement>('.pavArt img:not([data-watched])')) {
    img.dataset.watched = '1';
    img.addEventListener('error', () => {
      img.closest('.pavCard')?.classList.add('noArt');
      img.remove();
    }, { once: true });
  }
}

function render(cascade: boolean, arrived: Exhibit[] = []): void {
  if (!root) return;
  const mine = myIdentities();
  const t = tally(rows, mine);
  const total = t.troops + t.spells;

  countUp($('#pavTotal'), total);
  $('#pavYours').textContent = t.yours ? `${t.yours.toLocaleString('en-US')} by you` : 'None by you yet';
  $('#pavKinds').textContent = ` · ${t.troops.toLocaleString('en-US')} troop${t.troops === 1 ? '' : 's'} · ${t.spells.toLocaleString('en-US')} spell${t.spells === 1 ? '' : 's'}`;

  const spot = $('#pavSpot');
  if (t.latestYours) {
    const e = t.latestYours;
    if (spot.dataset.id !== String(e.id)) {
      spot.dataset.id = String(e.id);
      const [main, light] = colors(e);
      spot.innerHTML = `<span class="gLabel">${icon('star', 'gold', 16)} Your latest summon</span>
        <div class="pavSpotStage" style="--el:${main};--elLight:${light}"><i class="pavBeamL"></i><i class="pavBeamR"></i>
          <div class="pavSpotCard">${card(e, e.spriteUrl, true, true)}</div><div class="pavPlinth"></div></div>`;
      watchArt(spot);
    }
    spot.hidden = false;
  } else {
    spot.hidden = true;
  }

  const all = piles(rows, mine);
  const freshKeys = new Set(arrived.map(pileKey));
  const wall = $('#pavWall');
  $('#pavWallHead').hidden = !all.length;
  wall.innerHTML = all.slice(0, WALL_MAX).map(p => pileHtml(p, freshKeys.has(p.key))).join('') ||
    `<p class="pavEmpty">Nothing summoned yet. Say a troop and it takes the first plinth.</p>`;
  if (cascade) {
    [...wall.children].slice(0, CASCADE).forEach((c, i) => {
      (c as HTMLElement).style.animationDelay = `${0.35 + i * 0.035}s`;
      c.classList.add('rise');
    });
  }
  if (arrived.length) {
    setTimeout(() => wall.querySelectorAll('.pavPile.fresh').forEach(el => el.classList.remove('fresh')), FRESH_MS);
    const sc = $('.pavScroll');
    if (sc.scrollTop < 400) sc.scrollTo({ top: 0, behavior: 'smooth' });
    toast(arrived.sort(newestFirst)[0]);
  }
  watchArt(wall);
}

function toast(e: Exhibit) {
  const el = $('#pavToast');
  el.innerHTML = `<span class="gLabel">Just summoned</span><b>${esc(e.name)}</b>`;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  clearTimeout(Number(el.dataset.t));
  el.dataset.t = String(setTimeout(() => (el.hidden = true), 4200));
}

// The big number rolls up to its value rather than jumping.
function countUp(el: HTMLElement, to: number) {
  const from = shownTotal;
  shownTotal = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = to.toLocaleString('en-US');
    return;
  }
  const t0 = performance.now(), ms = from === 0 ? 1400 : 700;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString('en-US');
    if (k < 1 && shownTotal === to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  if (to > from && from > 0) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
}

// Polling pauses with the tab hidden; pick up straight away when it's back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pavilionOpen()) void poll();
});
