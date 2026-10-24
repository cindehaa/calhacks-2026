import { ANCHORS } from '../../shared/anchors';
import { ARENA_W, ELIXIR_MAX, MATCH_SECONDS, MID_Y, onOwnHalf, TICK_HZ, type Side } from '../../shared/arena';
import type { TroopDesign } from '../../shared/troop';
import { designTroop, warmDesigner } from './designer';
import { InputController } from './input/controller';
import { connect, type Net } from './net';
import { Board, type DrawUnit } from './render';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const board = new Board($<HTMLCanvasElement>('board'));

let net: Net | null = null;
let aim: [number, number] | null = null; // hover point on your half, world coords
let lock: [number, number] | null = null; // clicked spot for typed troops
let warmedFor = '';

// ---------- connection ----------

connect(
  n => {
    net = n;
    $('netStatus').textContent = '';
    hookInterpolation(n);
    requestAnimationFrame(frame);
  },
  s => ($('netStatus').textContent = s)
);

const me = () => (net ? net.conn.db.player.identity.find(net.identity) : undefined);
const myRoom = () => {
  const p = me();
  return p?.roomCode && net ? net.conn.db.room.code.find(p.roomCode) : undefined;
};
const mySide = (): Side => {
  const r = myRoom();
  return r && net && r.guest && r.guest.isEqual(net.identity) ? 1 : 0;
};

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
$('rematchBtn').onclick = () => call(net?.conn.reducers.startMatch({}));
$('leaveBtn').onclick = $('lobbyBtn').onclick = () => call(net?.conn.reducers.leaveRoom({}));
$<HTMLInputElement>('nameInput').onchange = e => {
  const name = (e.target as HTMLInputElement).value;
  if (name.trim()) call(net?.conn.reducers.setName({ name }));
};

function renderLobby() {
  const p = me(), r = myRoom();
  const playing = r?.status === 'playing';
  $('lobby').hidden = playing || r?.status === 'done';
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
  const r = myRoom();
  const done = r?.status === 'done';
  $('result').hidden = !done;
  if (!done || !r) return;
  const side = mySide();
  $('resultText').textContent = r.winner === -1 ? 'Draw' : r.winner === side ? 'You win' : 'You lose';
  const towers = towersFor(r.code);
  const lost = (s: number) => towers.filter(t => t.side === s && t.hp <= 0).length;
  $('resultDetail').textContent = `Towers destroyed: you ${lost(1 - side)}, them ${lost(side)}`;
}

// ---------- interpolation ----------
// The server ticks at 20 Hz; glide each unit from where it was drawn to its new position.

const glide = new Map<bigint, { fx: number; fy: number; tx: number; ty: number; at: number }>();
const TICK_MS = 1000 / TICK_HZ;

function hookInterpolation(n: Net) {
  n.conn.db.unit.onUpdate((_ctx, _old, row) => {
    const [cx, cy] = drawnPos(row.id, row.x, row.y);
    glide.set(row.id, { fx: cx, fy: cy, tx: row.x, ty: row.y, at: performance.now() });
  });
  n.conn.db.unit.onDelete((_ctx, row) => glide.delete(row.id));
}

function drawnPos(id: bigint, x: number, y: number): [number, number] {
  const g = glide.get(id);
  if (!g) return [x, y];
  const k = Math.min(1, (performance.now() - g.at) / TICK_MS);
  return [g.fx + (g.tx - g.fx) * k, g.fy + (g.ty - g.fy) * k];
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
    net?.conn.reducers.deployTroop({
      nonce, x, y, description, name: d.name, health: d.health, damage: d.damage, attackSpeed: d.attack_speed,
      moveSpeed: d.move_speed, range: d.range, count: d.count, battleCry: d.battle_cry, voiceStyle: d.voice_style,
      spriteUrl: '',
    }),
    msg => {
      call(net?.conn.reducers.cancelDeploy({ nonce }), () => {});
      const m = msg.match(/(too expensive|not enough elixir): (\d+)/);
      status(m ? `${d.name} would cost ${m[2]} — ${m[1] === 'too expensive' ? 'over the 10 limit' : 'not enough elixir'}` : msg, true);
    }
  );
}

// Anchors skip Claude: lock and deploy in one go.
function deployAnchor(i: number) {
  const a = ANCHORS[i];
  if (!a || myRoom()?.status !== 'playing') return;
  const spot = spotOrDefault();
  const nonce = ++nonceSeq;
  call(net?.conn.reducers.beginDeploy({ nonce, x: spot[0], y: spot[1] }), msg => status(msg, true));
  sendDeploy(nonce, spot, a.description, a);
  status(`${a.name}`);
}

// Lock first so the deploy delay overlaps generation, then design, then deploy.
function beginAt(spot: [number, number]): number | null {
  if (myRoom()?.status !== 'playing') return null;
  const nonce = ++nonceSeq;
  call(net?.conn.reducers.beginDeploy({ nonce, x: spot[0], y: spot[1] }), msg => status(msg, true));
  return nonce;
}

function cancelAt(nonce: number, msg: string) {
  call(net?.conn.reducers.cancelDeploy({ nonce }), () => {});
  status(msg, true);
}

async function designAt(nonce: number, spot: [number, number], description: string) {
  status(`designing “${description}”…`);
  try {
    const { design, cost, ms } = await designTroop(description);
    status(`${design.name} (${cost}) · “${design.battle_cry}” · ${ms} ms`);
    sendDeploy(nonce, spot, description, design);
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
  playing: () => myRoom()?.status === 'playing',
  side: mySide,
  toWorld: (px, py) => board.toWorld(px, py),
  begin: beginAt,
  deploy: designAt,
  cancel: cancelAt,
  status,
  typedText: () => $<HTMLInputElement>('descInput').value,
  clearTyped: () => ($<HTMLInputElement>('descInput').value = ''),
});

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

function towersFor(code: string) {
  return net ? [...net.conn.db.tower.iter()].filter(t => t.roomCode === code) : [];
}

function frame() {
  requestAnimationFrame(frame);
  renderLobby();
  renderResult();
  const r = myRoom();
  if (!net || !r) {
    $('roomInfo').textContent = '';
    board.draw({ mySide: 0, units: [], towers: [], troops: new Map(), pendings: [], aim: null, lock: null });
    return;
  }
  const side = mySide();
  if (r.status === 'playing' && warmedFor !== r.code) {
    warmedFor = r.code;
    warmDesigner();
  }
  const left = Math.max(0, MATCH_SECONDS - r.time);
  $('clock').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  $('roomInfo').textContent = `room ${r.code}${left <= 30 && r.status === 'playing' ? ' · double elixir' : ''}`;
  const elixir = side === 0 ? r.elixir0 : r.elixir1;
  $('elixirFill').style.width = `${(elixir / ELIXIR_MAX) * 100}%`;
  $('elixirText').textContent = String(Math.floor(elixir));

  const units: DrawUnit[] = [];
  for (const u of net.conn.db.unit.iter()) {
    if (u.roomCode !== r.code) continue;
    const [x, y] = drawnPos(u.id, u.x, u.y);
    units.push({ id: u.id, troopId: u.troopId, side: u.side, x, y, hp: u.hp, maxHp: u.maxHp, delay: u.delay });
  }
  const troops = new Map(
    [...net.conn.db.troop.iter()].filter(t => t.roomCode === r.code).map(t => [t.id, { name: t.name, cost: t.cost, spriteUrl: t.spriteUrl }])
  );
  const nowMicros = BigInt(Date.now()) * 1000n;
  const pendings = [...net.conn.db.pending.iter()]
    .filter(p => p.roomCode === r.code)
    .map(p => ({ side: p.side, x: p.x, y: p.y, age: Number(nowMicros - p.createdAt.microsSinceUnixEpoch) / 1e6 }));

  board.draw({
    mySide: side,
    units,
    towers: towersFor(r.code),
    troops,
    pendings,
    aim: r.status === 'playing' ? aim : null,
    lock: r.status === 'playing' ? lock : null,
    input: input.view(),
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
