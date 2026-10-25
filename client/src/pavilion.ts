// The Pavilion of Imagination: a wall of every troop and spell anyone has summoned, newest first
// (repeats stacked into one pile), with the total, how many were yours, and your latest one in
// the spotlight. An overlay over home or the result screen; /#pavilion opens it on load.
//
// It reads the public pavilion table over SpacetimeDB's HTTP SQL endpoint and polls for new rows,
// rather than joining the game's subscription. That keeps it out of the game's way entirely: a
// database without the table yet (the server not published) only leaves this screen saying so,
// and the game's own bindings and subscribeToAllTables don't change.
import { SQL_URL } from './dbhost';
import { icon, mountIcons } from './icons';
import { hubFx } from './hubfx';
import { sfx } from './sfx';
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

// ---------- the building ----------
//
// You stand in the portico looking in: two round columns and the gable overhead are the nearest
// things, and behind them a room in CSS 3D (coffered ceiling, tiled floor, a colonnade down each
// side open to the snow) recedes to one vanishing point. The wall of troops scrolls in front of
// the room and under the roof. The pointer (and the scroll) nudge the vanishing point, so the near
// columns and the far room slide against each other.

// The gable, seen from a little below: snow on the raking cornice, its underside, the tympanum
// with the star, then a row of modillions under the horizontal cornice and the frieze the name is
// carved on. Drawn stretched to the screen's width, so only flat shapes and non-scaling strokes.
function gable(): string {
  let modillions = '', icicles = '';
  for (let x = 8; x < 1000; x += 24) {
    modillions += `<rect x="${x}" y="100" width="12" height="9" fill="#3b4478"/><rect x="${x}" y="106" width="12" height="3" fill="#141838"/>`;
  }
  for (let x = 14; x < 1000; x += 21 + ((x * 7) % 13)) {
    const len = 7 + ((x * 13) % 15);
    icicles += `<polygon points="${x - 3.5},100 ${x + 3.5},100 ${x},${100 + len}" fill="#dbe9f4" opacity="${0.5 + ((x * 3) % 5) / 10}"/>`;
  }
  return `<svg class="pavGableSvg" viewBox="0 0 1000 176" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="pavTymp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151a3c"/><stop offset="1" stop-color="#232a58"/></linearGradient>
      <linearGradient id="pavFrieze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4478"/><stop offset=".12" stop-color="#2e3568"/><stop offset=".85" stop-color="#232a58"/><stop offset="1" stop-color="#141838"/></linearGradient>
    </defs>
    <polygon points="70,92 500,22 930,92" fill="url(#pavTymp)"/>
    <polygon points="0,92 500,4 1000,92 1000,100 500,14 0,100" fill="#343d6e"/>
    <polygon points="70,92 500,22 930,92 912,92 500,30 88,92" fill="#0e1230"/>
    <polygon points="0,92 500,4 500,-6 0,84" fill="#eef6fb"/><polygon points="500,4 1000,92 1000,84 500,-6" fill="#b9d6ea"/>
    <polyline points="110,92 500,34 890,92" fill="none" stroke="#f3d58a" stroke-width="2" vector-effect="non-scaling-stroke" opacity=".8"/>
    <rect x="0" y="92" width="1000" height="8" fill="#4a5490"/><rect x="0" y="92" width="1000" height="1.5" fill="#eef6fb"/>
    ${modillions}
    <rect x="0" y="109" width="1000" height="60" fill="url(#pavFrieze)"/>
    <rect x="0" y="109" width="1000" height="2" fill="#f3d58a" opacity=".55"/><rect x="0" y="167" width="1000" height="2" fill="#f3d58a" opacity=".35"/>
    <rect x="0" y="169" width="1000" height="7" fill="#0b0e22"/>
    ${icicles}
  </svg>`;
}

// A near column: capital (abacus and echinus), a fluted round shaft lit by its brazier, and a
// base (torus on a plinth), with the brazier standing on the plinth.
function column(side: 'l' | 'r'): string {
  const sparks = Array.from({ length: 9 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i * 0.53) % 3}s;--t:${2.2 + ((i * 0.7) % 1.6)}s"></i>`).join('');
  return `<div class="pavCol ${side}" aria-hidden="true">
    <div class="pavAbacus"></div><div class="pavEchinus"></div><div class="pavNeck"></div>
    <div class="pavShaft"></div>
    <div class="pavTorus"></div><div class="pavPlinthBase"></div>
    <div class="pavFire"><div class="pavGlowFire"></div><div class="pavSparks">${sparks}</div>
      <div class="pavFlame"><i></i><i></i><i></i></div><div class="pavBowl"></div><div class="pavStand"></div></div>
  </div>`;
}

// The room behind: a box open at the front, its back wall far off, its sides colonnades.
function room(): string {
  return `<div class="pavStage" aria-hidden="true"><div class="pavRoom">
    <div class="pavCeiling"></div><div class="pavFloor"></div>
    <div class="pavSide l"></div><div class="pavSide r"></div>
    <div class="pavRear"><div class="pavRearGlow"></div></div>
  </div></div>`;
}

function build(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'pavilion';
  el.className = 'pavilion';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'pavTitle');
  el.innerHTML = `
    <img class="gBg" src="/ui/home.svg" alt="">
    <canvas class="hubSky" aria-hidden="true"></canvas>
    ${room()}
    <div class="pavDim"></div>
    <div class="pavScroll">
      <header class="pavHead">
        <div class="pavCount"><b id="pavTotal">0</b><small>summoned this weekend</small></div>
        <p class="pavSub"><span id="pavYours"></span><span id="pavKinds"></span></p>
        <p id="pavStatus" class="pavStatus" hidden></p>
      </header>
      <section id="pavSpot" class="pavSpot" hidden></section>
      <div class="pavWallHead" id="pavWallHead"><i></i><span class="gLabel">The collection</span><i></i></div>
      <div id="pavWall" class="pavWall"></div>
    </div>
    <div class="pavNear">
      <div class="pavGable">${gable()}<span class="pavEmblem">${icon('star', 'gold', 46)}</span>
        <h2 id="pavTitle" class="pavTitle">Pavilion of Imagination</h2></div>
      ${column('l')}${column('r')}
    </div>
    <button id="pavilionClose" class="slab stone pavBack" aria-label="Back"><span class="face"><i class="ico" data-icon="close" data-tone="light" data-size="22"></i><b>Back</b></span></button>
    <div id="pavToast" class="pavToast" hidden></div>`;
  mountIcons(el);
  el.querySelector('#pavilionClose')!.addEventListener('click', () => closePavilion());
  hubFx(el.querySelector<HTMLCanvasElement>('.hubSky')!); // the same snow as home; it only draws while shown
  // A soft sparkle when the pointer (or the hand, which moves the pointer's :hover the same way)
  // comes onto a pile. sfx throttles it, so a sweep along a row patters rather than rattles.
  el.querySelector('#pavWall')!.addEventListener('pointerover', (e: Event) => {
    const pile = (e.target as Element).closest('.pavPile');
    if (pile && !pile.contains((e as PointerEvent).relatedTarget as Node | null)) sfx.play('cardHover');
  });
  parallax(el);
  return el;
}

// The pointer, and how far the wall has scrolled, lean the view: the vanishing point drifts with
// them (eased, so a shaky hand doesn't jitter it) and the near portico slides the other way.
function parallax(el: HTMLElement) {
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const scroll = el.querySelector<HTMLElement>('.pavScroll')!;
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
  const tick = () => {
    raf = 0;
    const s = Math.min(1, scroll.scrollTop / 1200);
    x += (tx - x) * 0.08;
    y += (ty + s * 0.6 - y) * 0.08;
    el.style.setProperty('--px', x.toFixed(4));
    el.style.setProperty('--py', y.toFixed(4));
    if (!el.hidden && (Math.abs(tx - x) > 0.002 || Math.abs(ty + s * 0.6 - y) > 0.002)) raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf && !still.matches) raf = requestAnimationFrame(tick); };
  addEventListener('pointermove', e => {
    if (el.hidden) return;
    tx = (e.clientX / innerWidth) * 2 - 1;
    ty = (e.clientY / innerHeight) * 2 - 1;
    kick();
  }, { passive: true });
  scroll.addEventListener('scroll', kick, { passive: true });
}

// Creates the screen (hidden) once. `onClose` runs whenever it closes.
export function mountPavilion(opts: { onClose?: () => void } = {}): void {
  if (root) return;
  root = build();
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
          <div class="pavSpotCard">${card(e, e.spriteUrl, true, true)}</div><div class="pavPlinthTop"></div><div class="pavPlinth"></div></div>`;
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
