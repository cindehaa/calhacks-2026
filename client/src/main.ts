import { ANCHORS } from '../../shared/anchors';
import { ARENA_W, ELIXIR_MAX, MATCH_SECONDS, MID_Y, onOwnHalf, type Side } from '../../shared/arena';
import type { BotLevel } from '../../shared/bot';
import type { TroopDesign } from '../../shared/troop';
import { designTroop, warmDesigner } from './designer';
import { LocalMatch } from './local';
import { OnlineMatch, type MatchSource } from './match';
import { connect, type Net } from './net';
import { Board, type DrawUnit } from './render';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const board = new Board($<HTMLCanvasElement>('board'));

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

function sendDeploy(nonce: number, [x, y]: [number, number], description: string, d: TroopDesign) {
  call(
    match()?.deployTroop(nonce, x, y, description, d),
    msg => {
      call(match()?.cancelDeploy(nonce), () => {});
      const m = msg.match(/(too expensive|not enough elixir): (\d+)/);
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
  sendDeploy(nonce, spot, a.description, a);
  status(`${a.name}`);
}

// Lock first so the deploy delay overlaps generation, then design, then deploy.
async function deployDescription(description: string) {
  if (match()?.status !== 'playing') return;
  const spot = spotOrDefault();
  const nonce = ++nonceSeq;
  call(match()?.beginDeploy(nonce, spot[0], spot[1]), msg => status(msg, true));
  status(`designing “${description}”…`);
  try {
    const { design, cost, ms } = await designTroop(description);
    status(`${design.name} (${cost}) · “${design.battle_cry}” · ${ms} ms`);
    sendDeploy(nonce, spot, description, design);
  } catch (e) {
    call(match()?.cancelDeploy(nonce), () => {});
    status(`designer failed: ${(e as Error).message}`, true);
  }
}

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
  if (/^[0-9]$/.test(e.key)) deployAnchor((Number(e.key) + 9) % 10);
  else if (e.key === 'Escape') lock = null;
  else if (e.key === 'Enter' || e.key === '/') {
    e.preventDefault();
    $('descInput').focus();
  }
});

board.canvas.addEventListener('mousemove', e => {
  const [x, y] = board.toWorld(e.clientX, e.clientY);
  aim = onOwnHalf(mySide(), y) && x > 0 && x < ARENA_W ? [x, y] : null;
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
    board.draw({ mySide: 0, units: [], towers: [], troops: new Map(), pendings: [], aim: null, lock: null });
    return;
  }
  const side = m.side;
  if (m.status === 'playing' && warmedFor !== m.key) {
    warmedFor = m.key;
    warmDesigner();
  }
  const left = Math.max(0, MATCH_SECONDS - m.time);
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
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
