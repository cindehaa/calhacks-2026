import { ANCHORS } from '../../shared/anchors';
import { ELIXIR_MAX, MATCH_SECONDS, MID_Y, canDeploy, type Side } from '../../shared/arena';
import type { BotLevel } from '../../shared/bot';
import type { TroopDesign } from '../../shared/troop';
import { designTroop, prefetchDesign, warmDesigner } from './designer';
import { Drops, releaseToStats, timingLines } from './drops';
import { InputController } from './input/controller';
import { LocalMatch } from './local';
import { OnlineMatch, type MatchSource } from './match';
import { connect, type Net } from './net';
import { PovBoard, type Eye } from './pov';
import { Board, type DrawTroop, type DrawUnit, type View } from './render';
import { sfx } from './sfx';
import { initSetup, setupDone } from './setup';
import { prefetchSprite, requestSprite } from './sprites';
import { showTutorialOnce } from './tutorial';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const flat = new Board($<HTMLCanvasElement>('board'));
const pov = new PovBoard($<HTMLCanvasElement>('board3d'), flat.canvas);
if (import.meta.env.DEV) Object.assign(window, { pov }); // poke at the 3D view from the console

// V (or the 3D button) cycles the top-down board and the POV eyes; remembered per browser.
const VIEWS = ['flat', 'tower', 'high', 'low'] as const;
type ViewMode = (typeof VIEWS)[number];
const VIEW_NAMES: Record<ViewMode, string> = { flat: 'top-down', tower: 'POV, behind your towers', high: 'POV, high', low: 'POV, ground level' };
let viewMode: ViewMode = (() => {
  const asked = new URLSearchParams(location.search).get('view');
  if (asked === 'pov') return 'tower';
  try {
    const saved = localStorage.getItem('view') as ViewMode | null;
    if (saved && VIEWS.includes(saved)) return saved;
  } catch { /* storage blocked */ }
  return 'flat';
})();
function setView(mode: ViewMode) {
  viewMode = mode;
  pov.show(mode !== 'flat');
  if (mode !== 'flat') pov.eye = mode as Eye;
  try { localStorage.setItem('view', mode); } catch { /* storage blocked */ }
  // The button names where it takes you next.
  const next = VIEWS[(VIEWS.indexOf(mode) + 1) % VIEWS.length];
  $('viewBtn').innerHTML = `${next === 'flat' ? 'Top-down' : mode === 'flat' ? '3D view' : next === 'high' ? 'High eye' : 'Low eye'} <kbd>V</kbd>`;
}
setView(viewMode);

// What input and the frame loop talk to: whichever view is showing.
const board = {
  canvas: flat.canvas,
  toWorld: (px: number, py: number) => (viewMode === 'flat' ? flat.toWorld(px, py) : pov.toWorld(px, py)),
  draw: (v: View) => (viewMode === 'flat' ? flat.draw(v) : pov.draw(v)),
};
function cycleView() {
  setView(VIEWS[(VIEWS.indexOf(viewMode) + 1) % VIEWS.length]);
  status(`View: ${VIEW_NAMES[viewMode]} (V to switch)`);
}
$('viewBtn').onclick = cycleView;

let net: Net | null = null;
let online: OnlineMatch | null = null;
let local: LocalMatch | null = null; // vs Bot, entirely in this tab
let aim: [number, number] | null = null; // hover point on your half, world coords
let lock: [number, number] | null = null; // clicked spot for typed troops
let warmedFor = '';
const drops = new Drops(); // your drops from let-go to landing: board feedback and timings
const arted = new WeakSet<DrawTroop>(); // bot-match troops already sent for art

// ---------- connection ----------

connect(
  n => {
    net = n;
    online = new OnlineMatch(n);
    $('netStatus').textContent = '';
  },
  s => ($('netStatus').textContent = s)
);
// Start drawing right away: vs Bot works even if the server never answers.
requestAnimationFrame(frame);
// The first designer call is 2–3 s cold. Warm it now, not at match start, so the lobby absorbs it.
warmDesigner();

const me = () => online?.me();
const myRoom = () => online?.room();
// What the HUD and deploys talk to: the bot match if one is open, else the online room.
const match = (): MatchSource | null => local ?? (myRoom() ? online : null);
const mySide = (): Side => match()?.side ?? 0;
const canDeployAt = (x: number, y: number) => canDeploy(mySide(), x, y, match()?.towers() ?? []);

function call(p: Promise<unknown> | undefined, onErr?: (msg: string) => void) {
  p?.catch((e: Error) => {
    const msg = e?.message ?? String(e);
    if (onErr) onErr(msg);
    else $('lobbyError').textContent = msg;
  });
}

// ---------- lobby ----------

$('createBtn').onclick = () => call(net?.conn.reducers.createRoom({}));
$('demoBtn').onclick = () => call(net?.conn.reducers.joinRoom({ code: 'DEMO' }));
$<HTMLFormElement>('joinForm').onsubmit = e => {
  e.preventDefault();
  call(net?.conn.reducers.joinRoom({ code: $<HTMLInputElement>('codeInput').value }));
};
$('startBtn').onclick = () => call(net?.conn.reducers.startMatch({}));
$('rematchBtn').onclick = () => call(match()?.rematch());
$('leaveBtn').onclick = $('lobbyBtn').onclick = () => call(match()?.leave());
$('botBtn').onclick = () => {
  lock = null;
  local = new LocalMatch($<HTMLSelectElement>('botLevel').value as BotLevel, () => (local = null));
};
$<HTMLInputElement>('nameInput').onchange = e => {
  const name = (e.target as HTMLInputElement).value;
  if (name.trim()) call(net?.conn.reducers.setName({ name }));
};

function renderLobby() {
  const p = me(), r = myRoom();
  const playing = r?.status === 'playing';
  $('lobby').hidden = !!local || playing || r?.status === 'done';
  $('lobbyOut').hidden = !!r;
  $('lobbyIn').hidden = !r;
  if (p && document.activeElement !== $('nameInput')) $<HTMLInputElement>('nameInput').value = p.name;
  if (!r || !net) return;
  $('roomCode').textContent = r.code;
  const who = (id: typeof r.host | undefined, label: string) => {
    if (!id) return `<li class="sub">${label}: waiting…</li>`;
    const pl = net!.conn.db.player.identity.find(id);
    const you = id.isEqual(net!.identity) ? ' (you)' : '';
    return `<li>${label}: ${escapeHtml(pl?.name ?? '?')}${you}${pl && !pl.online ? ' · offline' : ''}</li>`;
  };
  $('players').innerHTML = who(r.host, 'Blue') + who(r.guest, 'Red');
  $<HTMLButtonElement>('startBtn').disabled = !r.guest;
}

function renderResult() {
  const m = match();
  const done = m?.status === 'done';
  $('result').hidden = !done;
  if (!done || !m) return;
  const side = m.side;
  $('resultText').textContent = m.winner === -1 ? 'Draw' : m.winner === side ? 'You win' : 'You lose';
  $('lobbyBtn').textContent = local ? 'Leave' : 'Leave room';
  const towers = m.towers();
  const lost = (s: number) => towers.filter(t => t.side === s && t.hp <= 0).length;
  $('resultDetail').textContent = `Towers destroyed: you ${lost(1 - side)}, them ${lost(side)}`;
}

// ---------- deploying ----------

let nonceSeq = Math.floor(Math.random() * 1e6);

function spotOrDefault(): [number, number] {
  if (lock) return lock;
  if (aim) return aim;
  return [9, mySide() === 0 ? MID_Y - 4 : MID_Y + 4];
}

function status(msg: string, bad = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('bad', bad);
}

// Resolves true once the server took it. On a refusal, cancels the lock and says why.
async function sendDeploy(nonce: number, [x, y]: [number, number], description: string, d: TroopDesign, spriteUrl = ''): Promise<boolean> {
  try {
    await match()?.deployTroop(nonce, x, y, description, d, spriteUrl);
    drops.deployed(nonce, performance.now());
    return true;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    call(match()?.cancelDeploy(nonce), () => {});
    sfx.play('buzz');
    const m = msg.match(/(too expensive|not enough elixir): (\d+)/);
    status(m ? `${d.name} would cost ${m[2]} — ${m[1] === 'too expensive' ? 'over the 10 limit' : 'not enough elixir'}` : msg, true);
    drops.refused(nonce, m ? `would cost ${m[2]}${m[1] === 'too expensive' ? ', over 10' : ''}` : 'refused', performance.now());
    return false;
  }
}

// Deploy with the art if it's already here, else deploy now and set the art when it lands.
async function deployWithArt(nonce: number, spot: [number, number], description: string, d: TroopDesign, art: Promise<string | null>) {
  const m = match();
  const ready = await Promise.race([art, Promise.resolve(undefined)]); // undefined: still drawing
  const ok = await sendDeploy(nonce, spot, description, d, ready ?? '');
  if (!ok || ready !== undefined) return;
  const url = await art;
  if (url && m) call(m.attachSprite(description, url), () => {});
}

// Anchors skip Claude: lock and deploy in one go.
function deployAnchor(i: number) {
  const a = ANCHORS[i];
  if (!a || match()?.status !== 'playing') return;
  const spot = spotOrDefault();
  const nonce = ++nonceSeq;
  call(match()?.beginDeploy(nonce, spot[0], spot[1]), msg => status(msg, true));
  void deployWithArt(nonce, spot, a.description, a, requestSprite(a.description));
  status(`${a.name}`);
}

// Dev only: drop any anchor by name at a spot, and reach the local match (headless view checks).
if (import.meta.env.DEV) {
  Object.assign(window, {
    devDrop(name: string, x: number, y: number) {
      const a = ANCHORS.find(t => t.name === name);
      if (!a || match()?.status !== 'playing') return false;
      const nonce = ++nonceSeq;
      call(match()?.beginDeploy(nonce, x, y), msg => status(msg, true));
      void deployWithArt(nonce, [x, y], a.description, a, requestSprite(a.description));
      return true;
    },
    devLocal: () => local,
    devAnchors: ANCHORS,
  });
}

// Lock first so the deploy delay overlaps generation, then design, then deploy.
function beginAt(spot: [number, number]): number | null {
  if (match()?.status !== 'playing') return null;
  const nonce = ++nonceSeq;
  call(match()?.beginDeploy(nonce, spot[0], spot[1]), msg => status(msg, true));
  drops.begin(nonce, spot, performance.now());
  return nonce;
}

// An empty message cancels quietly (a quick click that wasn't a hold-to-talk).
function cancelAt(nonce: number, msg: string) {
  call(match()?.cancelDeploy(nonce), () => {});
  drops.cancelled(nonce);
  status(msg, !!msg);
}

async function designAt(nonce: number, spot: [number, number], description: string) {
  status(`designing “${description}”…`);
  drops.heard(nonce, description, performance.now());
  const art = requestSprite(description); // in parallel with the designer; often already started
  void art.then(url => url && drops.art(nonce, performance.now()));
  try {
    const { design, cost, ms, source, early } = await designTroop(description);
    const tags = [source === 'offline' && 'offline', early && 'early'].filter(Boolean).join(', ');
    drops.designed(nonce, design.name, tags, performance.now());
    status(`${design.name} (${cost}) · ${ms} ms${tags ? ` (${tags})` : ''}`);
    void deployWithArt(nonce, spot, description, design, art);
  } catch (e) {
    cancelAt(nonce, `designer failed: ${(e as Error).message}`);
  }
}

async function deployDescription(description: string) {
  const spot = spotOrDefault();
  const nonce = beginAt(spot);
  if (nonce !== null) await designAt(nonce, spot, description);
}

// Camera and mic: pinch or start talking to lock (beginDeploy), let go or go quiet to deploy.
const input = new InputController(board.canvas, {
  playing: () => match()?.status === 'playing',
  canDeploy: ([x, y]) => canDeployAt(x, y),
  toWorld: (px, py) => board.toWorld(px, py),
  begin: beginAt,
  deploy: designAt,
  cancel: cancelAt,
  status,
  typedText: () => $<HTMLInputElement>('descInput').value,
  clearTyped: () => ($<HTMLInputElement>('descInput').value = ''),
  prefetch: words => {
    prefetchDesign(words);
    prefetchSprite(words);
  },
  released: (nonce, words) => drops.release(nonce, words, performance.now()),
});

// First visit: camera and mic, then the how-to card.
const setup = initSetup(input, showTutorialOnce);
if (setupDone()) showTutorialOnce();
else setup.open();

$<HTMLFormElement>('describe').onsubmit = e => {
  e.preventDefault();
  const input = $<HTMLInputElement>('descInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  deployDescription(text);
};

$('hand').innerHTML = ANCHORS.map(
  (a, i) => `<button data-i="${i}"><kbd>${(i + 1) % 10}</kbd>${escapeHtml(a.name)}</button>`
).join('');
$('hand').onclick = e => {
  const b = (e.target as HTMLElement).closest('button');
  if (b) deployAnchor(Number(b.dataset.i));
};

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
    return;
  }
  if (/^[0-9]$/.test(e.key)) {
    if (input.mouseKeys) deployAnchor((Number(e.key) + 9) % 10);
  }
  else if (e.key === 't' || e.key === 'T') $('timings').hidden = !$('timings').hidden;
  else if (e.key === 'Escape') lock = null;
  else if (e.key === 'v' || e.key === 'V') cycleView();
  else if (e.key === 'Enter' || e.key === '/') {
    e.preventDefault();
    $('descInput').focus();
  }
});

board.canvas.addEventListener('mousemove', e => {
  if (!input.mouseKeys) return void (aim = lock = null);
  const [x, y] = board.toWorld(e.clientX, e.clientY);
  aim = canDeployAt(x, y) ? [x, y] : null;
});
board.canvas.addEventListener('mouseleave', () => (aim = null));
board.canvas.addEventListener('click', () => {
  if (input.tookClick() || !aim) return; // a hold-to-talk press already deployed or cancelled
  lock = aim;
  $('descInput').focus();
});

// ---------- frame ----------

function frame() {
  requestAnimationFrame(frame);
  renderLobby();
  renderResult();
  const m = match();
  if (!m) {
    $('roomInfo').textContent = '';
    board.draw({ mySide: 0, units: [], towers: [], troops: new Map(), pendings: [], aim: null, lock: null, status: 'lobby' });
    return;
  }
  const side = m.side;
  if (m.status === 'playing' && warmedFor !== m.key) {
    warmedFor = m.key;
    warmDesigner();
    input.warm();
  }
  const left = Math.min(MATCH_SECONDS, Math.max(0, MATCH_SECONDS - m.time));
  $('clock').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  $('roomInfo').textContent = `${m.label}${left <= 30 && m.status === 'playing' ? ' · double elixir' : ''}`;
  const elixir = m.elixir;
  $('elixirFill').style.width = `${(elixir / ELIXIR_MAX) * 100}%`;
  $('elixirText').textContent = String(Math.floor(elixir));

  showTimings();
  const units: DrawUnit[] = m.units();
  if (local) artForBot(local);

  board.draw({
    mySide: side,
    units,
    towers: m.towers(),
    troops: m.troops(),
    pendings: m.pendings(),
    aim: m.status === 'playing' ? aim : null,
    lock: m.status === 'playing' ? lock : null,
    input: input.view(),
    drops: m.status === 'playing' ? drops.views(performance.now()) : [],
    time: m.time,
    status: m.status,
    winner: m.winner ?? undefined,
  });
}

// Debug readout, off by default (T toggles): per drop, how long the pinch was held, then from
// letting go to the final words, the stats and the art. Release → stats has to beat the 2.5 s delay.
let timingsAt = 0;
if (new URLSearchParams(location.search).has('timings')) $('timings').hidden = false;
function showTimings() {
  const el = $('timings');
  const now = performance.now();
  if (el.hidden || now - timingsAt < 250) return;
  timingsAt = now;
  const last = [...drops.list].reverse().find(d => releaseToStats(d) !== null);
  const head = last ? `release → stats ${Math.round(releaseToStats(last)!)} ms` : 'release → stats …';
  el.textContent = [head, ...timingLines(drops.list)].join('\n');
  el.classList.toggle('slow', !!last && releaseToStats(last)! > 2500);
}

// The bot's troops are anchors, so their art is drawn once and cached by the api like yours.
function artForBot(m: LocalMatch) {
  for (const t of m.troops().values()) {
    if (t.spriteUrl || !t.description || arted.has(t)) continue;
    arted.add(t);
    const desc = t.description;
    requestSprite(desc).then(url => {
      if (url) void m.attachSprite(desc, url);
    });
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
