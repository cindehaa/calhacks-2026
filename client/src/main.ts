import { ANCHORS } from '../../shared/anchors';
import { ELIXIR_MAX, MATCH_SECONDS, MID_Y, canDeploy, type Side } from '../../shared/arena';
import type { BotLevel } from '../../shared/bot';
import { price, type TroopDesign } from '../../shared/troop';
import { designTroop, prefetchDesign, warmDesigner } from './designer';
import { InputController, type DeployHow } from './input/controller';
import { LocalMatch } from './local';
import { OnlineMatch, type MatchSource } from './match';
import { connect, type Net } from './net';
import { PovBoard } from './pov';
import type { DrawUnit } from './render';
import { sfx } from './sfx';
import { initSetup, setupDone } from './setup';
import { readySprite, spriteFor } from './sprites';
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

// ---------- connection ----------

connect(
  n => {
    net = n;
    online = new OnlineMatch(n);
    attachLogs(n);
    $('netStatus').textContent = '';
  },
  s => ($('netStatus').textContent = s)
);
// Start drawing right away: vs Bot works even if the server never answers.
requestAnimationFrame(frame);

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
$('rematchBtn').onclick = () => {
  call(match()?.rematch());
  if (local) botStarted(local.level);
};
$('leaveBtn').onclick = $('lobbyBtn').onclick = () => {
  if (local?.status === 'playing') botEnded('left');
  call(match()?.leave());
};
$('botBtn').onclick = () => {
  lock = null;
  local = new LocalMatch($<HTMLSelectElement>('botLevel').value as BotLevel, () => (local = null));
  botStarted(local.level);
};

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

// The sprite rides along if it's already here, else it's attached once both have landed.
function sendDeploy(nonce: number, [x, y]: [number, number], description: string, d: TroopDesign) {
  const m = match();
  if (!m) return settle(nonce, 'no match');
  const art = spriteFor(description);
  attempts.get(nonce)?.waitForArt(art);
  const ready = readySprite(description);
  const deployed = m.deployTroop(nonce, x, y, description, d, ready);
  deployed.then(() => settle(nonce, 'deployed'), () => {});
  if (!ready) Promise.all([art, deployed]).then(([url]) => (url ? m.attachSprite(description, url) : undefined)).catch(() => {});
  call(
    deployed,
    msg => {
      settle(nonce, msg);
      call(match()?.cancelDeploy(nonce), () => {});
      sfx.play('buzz');
      const m = msg.match(/(too expensive|not enough elixir): (\d+)/);
      if (m?.[1] === 'not enough elixir') sfx.play('tooExpensive');
      status(m ? `${d.name} would cost ${m[2]} — ${m[1] === 'too expensive' ? 'over the 10 limit' : 'not enough elixir'}` : msg, true);
    }
  );
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
  sendDeploy(nonce, spot, a.description, a);
  status(`${a.name}`);
}

// Lock first so the deploy delay overlaps generation, then design, then deploy.
function beginAt(spot: [number, number], by: string): number | null {
  if (match()?.status !== 'playing') return null;
  const nonce = ++nonceSeq;
  call(match()?.beginDeploy(nonce, spot[0], spot[1]), msg => status(msg, true));
  attempt(nonce, by);
  return nonce;
}

function cancelAt(nonce: number, msg: string, transcript = '') {
  const a = attempts.get(nonce);
  if (a) a.transcript ||= transcript;
  settle(nonce, msg);
  call(match()?.cancelDeploy(nonce), () => {});
  status(msg, true);
}

async function designAt(nonce: number, spot: [number, number], description: string, how?: DeployHow) {
  status(`designing “${description}”…`);
  attempts.get(nonce)?.released(description, how?.from ?? 'typed', how?.transcript, how?.by);
  spriteFor(description); // in parallel with the design
  try {
    const d = await designTroop(description);
    attempts.get(nonce)?.gotDesign(d);
    const { design, cost, ms, source, early } = d;
    const tags = [source === 'offline' && 'offline', early && 'early'].filter(Boolean).join(', ');
    status(`${design.name} (${cost}) · “${design.battle_cry}” · ${ms} ms${tags ? ` (${tags})` : ''}`);
    sendDeploy(nonce, spot, description, design);
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
  prefetch: prefetchDesign,
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
  else if (e.key === 'x' || e.key === 'X') flagMismatch();
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
  if (!aim) return;
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
  if (local?.status === 'done') botEnded('over');
  if (m.status === 'playing' && warmedFor !== m.key) {
    warmedFor = m.key;
    warmDesigner();
  }
  const left = Math.min(MATCH_SECONDS, Math.max(0, MATCH_SECONDS - m.time));
  $('clock').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  $('roomInfo').textContent = `${m.label}${left <= 30 && m.status === 'playing' ? ' · double elixir' : ''}`;
  const elixir = m.elixir;
  $('elixirFill').style.width = `${(elixir / ELIXIR_MAX) * 100}%`;
  $('elixirText').textContent = String(Math.floor(elixir));

  const units: DrawUnit[] = m.units();

  board.draw({
    mySide: side,
    units,
    towers: m.towers(),
    troops: m.troops(),
    pendings: m.pendings(),
    aim: m.status === 'playing' ? aim : null,
    lock: m.status === 'playing' ? lock : null,
    input: input.view(),
    time: m.time,
    status: m.status,
    winner: m.winner ?? undefined,
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
