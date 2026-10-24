import { ANCHORS } from '../../shared/anchors';
import { COUNTDOWN, ELIXIR_MAX, KING_LANE, MATCH_SECONDS, MID_Y, canDeploy, type Side } from '../../shared/arena';
import type { BotLevel } from '../../shared/bot';
import { price, type TroopDesign } from '../../shared/troop';
import { designTroop, prefetchDesign, warmDesigner } from './designer';
import { Drops, releaseToStats, timingLines } from './drops';
import { InputController, type DeployHow } from './input/controller';
import { LocalMatch } from './local';
import { OnlineMatch, type MatchSource } from './match';
import { connect, type Net } from './net';
import { PovBoard } from './pov';
import type { DrawTroop, DrawUnit } from './render';
import { sfx } from './sfx';
import { initSetup, setupDone } from './setup';
import { prefetchSprite, requestSprite } from './sprites';
import { Attempt, attachLogs, logBotEnd, logBotStart, logEvent, logUtterance } from './telemetry';
import { showTutorialOnce } from './tutorial';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const board = new PovBoard($<HTMLCanvasElement>('board3d'), $<HTMLCanvasElement>('board'));
if (import.meta.env.DEV) Object.assign(window, { board }); // poke at the 3D view from the console

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
    attachLogs(n);
    netMsg('');
    const name = savedName();
    if (name) call(n.conn.reducers.setName({ name }));
  },
  netMsg
);
function netMsg(s: string) {
  $('netStatus').textContent = s;
  $('hubNet').textContent = s ? `${s} · Practice works offline` : 'Online';
}
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

// ---------- title and hub ----------

// The title screen's press also unlocks audio, so the menu music can start.
let entered = false;
function enter() {
  if (entered) return;
  entered = true;
  $('title').hidden = true;
  sfx.unlock();
  if (setupDone()) showTutorialOnce();
  else setup.open();
}
$('title').addEventListener('pointerdown', enter);
addEventListener('keydown', e => {
  if (entered) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  enter();
}, true);

const NAME_KEY = 'arena.name';
const LEVEL_KEY = 'arena.botLevel';
function savedName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
}
function remember(key: string, v: string) {
  try { localStorage.setItem(key, v) } catch { /* private mode */ }
}
const myName = () => me()?.name || savedName() || 'You';
const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?';

$<HTMLInputElement>('nameInput').value = savedName();
$<HTMLInputElement>('nameInput').onchange = e => {
  const name = (e.target as HTMLInputElement).value.trim();
  if (!name) return;
  remember(NAME_KEY, name);
  call(net?.conn.reducers.setName({ name }));
};
$('nameInput').onkeydown = e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() };

let botLevel = ((): BotLevel => {
  try { return (localStorage.getItem(LEVEL_KEY) as BotLevel) || 'normal' } catch { return 'normal' }
})();
function renderLevel() {
  for (const b of $('botLevel').querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.level === botLevel));
}
renderLevel();
$('botLevel').onclick = e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b?.dataset.level) return;
  botLevel = b.dataset.level as BotLevel;
  remember(LEVEL_KEY, botLevel);
  renderLevel();
};

// Every menu button ticks.
for (const id of ['lobby', 'pause', 'forfeitAsk', 'result']) {
  $(id).addEventListener('click', e => { if ((e.target as HTMLElement).closest('button')) sfx.play('click') });
}

$('createBtn').onclick = () => call(net?.conn.reducers.createRoom({}));
$('demoBtn').onclick = () => call(net?.conn.reducers.joinRoom({ code: 'DEMO' }));
$<HTMLFormElement>('joinForm').onsubmit = e => {
  e.preventDefault();
  const code = $<HTMLInputElement>('codeInput').value.trim();
  if (code) call(net?.conn.reducers.joinRoom({ code }));
};
$('startBtn').onclick = () => call(net?.conn.reducers.startMatch({}));
$('rematchBtn').onclick = () => {
  call(match()?.rematch());
  if (local) botStarted(local.level);
};
$('leaveBtn').onclick = $('lobbyBtn').onclick = () => {
  if (local?.status === 'playing') botEnded('left');
  call(match()?.leave());
};
$('botBtn').onclick = () => startBot(botLevel);
$('roomCode').onclick = () => {
  const code = myRoom()?.code;
  if (!code) return;
  navigator.clipboard?.writeText(code).then(() => {
    $('roomCode').title = 'Copied';
    $('lobbyError').textContent = '';
  }, () => {});
};
$('hubHelp').onclick = () => $('helpBtn').click();
$('hubSetup').onclick = () => setup.open();

function startBot(level: BotLevel) {
  lock = null;
  local = new LocalMatch(level, () => (local = null));
  botStarted(level);
}

// Bot rounds never reach the server, so they're reported from here.
let botOpen = false; // a bot round logged as started and not yet as ended
function botStarted(level: string) {
  logBotStart(level);
  botOpen = true;
}
function botEnded(reason: 'over' | 'left') {
  if (!local || !botOpen) return;
  botOpen = false;
  logBotEnd(local.report(), reason);
}

let restarting = false; // between the old bot match and its restart
let hadGuest = false;

function renderLobby() {
  const p = me(), r = myRoom();
  const inMatch = !!local || restarting || r?.status === 'playing' || r?.status === 'done';
  $('lobby').hidden = !entered || inMatch;
  document.body.classList.toggle('inHub', !inMatch);
  $('lobbyOut').hidden = !!r;
  $('lobbyIn').hidden = !r;
  for (const id of ['createBtn', 'demoBtn']) $<HTMLButtonElement>(id).disabled = !net;
  $('joinForm').querySelector('button')!.disabled = !net;
  if (p && document.activeElement !== $('nameInput')) $<HTMLInputElement>('nameInput').value = p.name;
  $('avatar').textContent = initial($<HTMLInputElement>('nameInput').value || '?');
  if (!!r?.guest !== hadGuest) {
    hadGuest = !!r?.guest;
    if (hadGuest && r?.status === 'lobby') sfx.play('joined');
  }
  if (!r || !net) return;
  $('roomCode').textContent = r.code;
  const slot = (id: typeof r.host | undefined, label: string, red: boolean) => {
    if (!id) return `<span class="avatar empty"></span><b class="sub">Waiting for a player…</b><span class="sub">${label}</span>`;
    const pl = net!.conn.db.player.identity.find(id);
    const name = pl?.name ?? '?';
    const you = id.isEqual(net!.identity) ? ' · you' : '';
    return `<span class="avatar${red ? ' red' : ''}">${escapeHtml(initial(name))}</span><b>${escapeHtml(name)}</b><span class="sub">${label}${you}${pl && !pl.online ? ' · offline' : ''}</span>`;
  };
  setHtml('slot0', slot(r.host, 'Blue', false));
  setHtml('slot1', slot(r.guest, 'Red', true));
  $<HTMLButtonElement>('startBtn').disabled = !r.guest;
  $('startBtn').textContent = r.guest ? 'Start match' : 'Waiting for opponent…';
}

// innerHTML only when it changes, so hover and focus survive the per-frame render.
function setHtml(id: string, html: string) {
  const el = $(id);
  if (el.dataset.html !== html) el.innerHTML = el.dataset.html = html;
}

// Won by the clock or a king tower, or handed over by a forfeit?
let iForfeited = false;
function byForfeit(m: MatchSource) {
  const kingsUp = m.towers().filter(t => t.lane === KING_LANE).every(t => t.hp > 0);
  return m.winner !== -1 && m.winner !== null && kingsUp && m.time < MATCH_SECONDS - 0.01;
}

function renderResult() {
  const m = match();
  const done = m?.status === 'done';
  $('result').hidden = !done;
  if (!done || !m) return;
  const side = m.side;
  const won = m.winner === side, forfeit = byForfeit(m);
  $('resultText').textContent = m.winner === -1 ? 'Draw' : won ? 'You win' : forfeit && iForfeited ? 'You forfeited' : 'You lose';
  $('resultText').className = m.winner === -1 ? '' : won ? 'win' : 'lose';
  const towers = m.towers();
  const lost = (s: number) => towers.filter(t => t.side === s && t.hp <= 0).length;
  $('resultDetail').textContent = forfeit && won ? 'Your opponent forfeited.' : `Towers destroyed: you ${lost(1 - side)}, them ${lost(side)}`;
  $<HTMLButtonElement>('rematchBtn').disabled = !local && !myRoom()?.guest;
}

// ---------- versus card, pause and forfeit ----------

let vsShown = false;
function renderVersus(m: MatchSource | null) {
  const t = m?.time ?? 0;
  const show = !!m && m.status === 'playing' && t < -COUNTDOWN;
  if (show && !vsShown) {
    iForfeited = false;
    const me = myName();
    let them = 'Opponent', tag = 'Opponent';
    if (local) {
      them = 'Bot';
      tag = `${local.level} bot`;
    } else {
      const r = myRoom(), id = m!.side === 0 ? r?.guest : r?.host;
      them = (id && net?.conn.db.player.identity.find(id)?.name) || them;
    }
    $('vsMe').textContent = me;
    $('vsMeAvatar').textContent = initial(me);
    $('vsThem').textContent = them;
    $('vsThemAvatar').textContent = initial(them);
    $('vsThemAvatar').classList.add('red');
    $('vsThemTag').textContent = tag;
    sfx.play('versus');
  }
  vsShown = show;
  $('versus').hidden = !show;
  $('versus').classList.toggle('leaving', show && t > -COUNTDOWN - 0.35);
}

function clockText(m: MatchSource) {
  const left = Math.min(MATCH_SECONDS, Math.max(0, MATCH_SECONDS - m.time));
  return `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
}

// Bot matches only: the clock, the bot and the music all wait.
function setPaused(p: boolean) {
  p &&= !!local && local.status === 'playing' && local.time >= 0;
  if (local) local.paused = p;
  sfx.holdMusic(p);
  $('pause').hidden = !p;
  if (p && local) $('pauseDetail').textContent = `${local.label} · ${clockText(local)} left`;
}
$('pauseBtn').onclick = e => {
  setPaused(true);
  (e.currentTarget as HTMLElement).blur();
};
$('resumeBtn').onclick = () => setPaused(false);
$('quitBtn').onclick = () => {
  setPaused(false);
  botEnded('left');
  call(local?.leave());
};
$('restartBtn').onclick = () => {
  if (!local) return;
  const level = local.level;
  setPaused(false);
  botEnded('left');
  call(local.leave());
  // One frame with no match in between, so the board and its sounds start over cleanly.
  restarting = true;
  setTimeout(() => {
    restarting = false;
    startBot(level);
  }, 80);
};
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true) });

// Online matches only: hand the win to the other side.
$('forfeitBtn').onclick = e => {
  $('forfeitAsk').hidden = false;
  (e.currentTarget as HTMLElement).blur();
};
$('keepBtn').onclick = () => ($('forfeitAsk').hidden = true);
$('forfeitYes').onclick = () => {
  $('forfeitAsk').hidden = true;
  iForfeited = true;
  sfx.play('forfeit');
  call(online?.forfeit(), msg => status(msg, true));
};

function renderTools(m: MatchSource | null) {
  const live = m?.status === 'playing';
  $('pauseBtn').hidden = !(local && live);
  $<HTMLButtonElement>('pauseBtn').disabled = !local || local.time < 0;
  $('forfeitBtn').hidden = !(!local && live);
  if (!live || local) $('forfeitAsk').hidden = true;
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

// Deploy attempts in flight, by nonce, for the logs. Each is logged once it settles.
const attempts = new Map<number, Attempt>();
let lastDeployed: Attempt | null = null; // what "that's wrong" flags

function attempt(nonce: number, by: string): Attempt {
  const a = new Attempt(nonce, by);
  attempts.set(nonce, a);
  return a;
}

function settle(nonce: number, outcome: string) {
  const a = attempts.get(nonce);
  if (!a) return;
  attempts.delete(nonce);
  a.settle(outcome);
  if (outcome === 'deployed') lastDeployed = a;
}

// Resolves true once the server took it. On a refusal, cancels the lock and says why.
async function sendDeploy(nonce: number, [x, y]: [number, number], description: string, d: TroopDesign, spriteUrl = ''): Promise<boolean> {
  const m = match();
  if (!m) {
    settle(nonce, 'no match');
    return false;
  }
  try {
    await m.deployTroop(nonce, x, y, description, d, spriteUrl);
    settle(nonce, 'deployed');
    drops.deployed(nonce, performance.now());
    return true;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    settle(nonce, msg);
    call(match()?.cancelDeploy(nonce), () => {});
    sfx.play('buzz');
    const m = msg.match(/(too expensive|not enough elixir): (\d+)/);
    if (m?.[1] === 'not enough elixir') sfx.play('tooExpensive');
    status(m ? `${d.name} would cost ${m[2]} — ${m[1] === 'too expensive' ? 'over the 10 limit' : 'not enough elixir'}` : msg, true);
    drops.refused(nonce, m ? `would cost ${m[2]}${m[1] === 'too expensive' ? ', over 10' : ''}` : 'refused', performance.now());
    return false;
  }
}

// Deploy with the art if it's already here, else deploy now and set the art when it lands.
async function deployWithArt(nonce: number, spot: [number, number], description: string, d: TroopDesign, art: Promise<string | null>) {
  const m = match();
  attempts.get(nonce)?.waitForArt(art.then(url => url ?? ''));
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
  const at = attempt(nonce, 'key');
  at.released(a.description, 'anchor');
  at.gotDesign({ design: a, cost: price(a), ms: 0, source: 'anchor' });
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
function beginAt(spot: [number, number], by: string): number | null {
  if (match()?.status !== 'playing') return null;
  const nonce = ++nonceSeq;
  call(match()?.beginDeploy(nonce, spot[0], spot[1]), msg => status(msg, true));
  attempt(nonce, by);
  drops.begin(nonce, spot, performance.now());
  return nonce;
}

// An empty message cancels quietly (a quick click that wasn't a hold-to-talk).
// An empty message cancels quietly: a quick click that picked a typing spot, not a deploy attempt,
// so it isn't logged.
function cancelAt(nonce: number, msg: string, transcript = '') {
  const a = attempts.get(nonce);
  if (a) a.transcript ||= transcript;
  if (msg) settle(nonce, msg);
  else attempts.delete(nonce);
  call(match()?.cancelDeploy(nonce), () => {});
  drops.cancelled(nonce);
  status(msg, !!msg);
}

async function designAt(nonce: number, spot: [number, number], description: string, how?: DeployHow) {
  status(`designing “${description}”…`);
  attempts.get(nonce)?.released(description, how?.from ?? 'typed', how?.transcript, how?.by);
  drops.heard(nonce, description, performance.now());
  const art = requestSprite(description); // in parallel with the designer; often already started
  void art.then(url => url && drops.art(nonce, performance.now()));
  try {
    const d = await designTroop(description);
    attempts.get(nonce)?.gotDesign(d);
    const { design, cost, ms, source, early } = d;
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
  const nonce = beginAt(spot, lock ? 'mouse' : 'form');
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
  heard: (text, nonce) => logUtterance(text, nonce),
  mismatch: flagMismatch,
  event: (kind, detail) => logEvent(kind, detail),
});

// "That's wrong" (or X): the last troop isn't what the player asked for. The best signal the
// logs get for tuning the designer and the art.
function flagMismatch() {
  const a = lastDeployed;
  logEvent('mismatch', a ? `${a.description} → ${a.design?.name ?? '?'}` : '', a?.nonce ?? 0);
  status(a ? `noted: ${a.design?.name ?? 'that troop'} wasn't what you asked for` : 'noted');
}

// First visit (after the title screen): camera and mic, then the how-to card.
const setup = initSetup(input, showTutorialOnce);

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
  if (local?.paused) {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') setPaused(false);
    return;
  }
  if ((e.key === 'p' || e.key === 'P') && local) return setPaused(true);
  if (/^[0-9]$/.test(e.key)) {
    if (input.mouseKeys) deployAnchor((Number(e.key) + 9) % 10);
  }
  else if (e.key === 'x' || e.key === 'X') flagMismatch();
  else if (e.key === 't' || e.key === 'T') $('timings').hidden = !$('timings').hidden;
  else if (e.key === 'Escape') lock = null;
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
  renderVersus(m);
  renderTools(m);
  if (!m) {
    $('roomInfo').textContent = '';
    board.draw({ mySide: 0, units: [], towers: [], troops: new Map(), pendings: [], aim: null, lock: null, status: 'lobby' });
    return;
  }
  const side = m.side;
  if (local?.status === 'done') botEnded('over');
  if (m.status === 'playing' && warmedFor !== m.key) {
    warmedFor = m.key;
    warmDesigner();
    input.warm();
  }
  const left = Math.min(MATCH_SECONDS, Math.max(0, MATCH_SECONDS - m.time));
  $('clock').textContent = clockText(m);
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
