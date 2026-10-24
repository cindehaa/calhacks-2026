import { ANCHORS } from '../../shared/anchors';
import { COUNTDOWN, ELIXIR_MAX, KING_LANE, MATCH_SECONDS, MID_Y, TIEBREAK_AT, canDeploy, elixirRate, type Side } from '../../shared/arena';
import type { BotLevel } from '../../shared/bot';
import { price, type TroopDesign } from '../../shared/troop';
import { designTroop, prefetchDesign, warmDesigner } from './designer';
import { Drops, releaseToStats, timingLines } from './drops';
import { InputController, type DeployHow } from './input/controller';
import { LocalMatch } from './local';
import { OnlineMatch, type MatchSource } from './match';
import { connect, type Net } from './net';
import { PovBoard } from './pov';
import { burnSticks, initKindling, updateKindling } from './kindling';
import type { DrawTroop } from './render';
import { sfx } from './sfx';
import { initSetup, setupDone } from './setup';
import { prefetchSprite, requestSprite } from './sprites';
import { Attempt, attachLogs, logBotEnd, logBotStart, logEvent, logUtterance } from './telemetry';
import { crownSvg, shieldSvg } from './art';
import { clock, reasons, type RoundSummary } from './chronicle';
import { RANKS, applyDelta, emberDelta, loadEmbers, rankOf, saveEmbers, type Outcome } from './embers';
import { hubFx, resultFx } from './hubfx';
import { tapestry } from './banner';
import { showTutorialOnce } from './tutorial';
import { MvpTracker, renderMvp } from './mvp';
import { clearNotice, notice } from './notice';
import { boardReactions, homeReactions, menuReactions } from './react';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const board = new PovBoard($<HTMLCanvasElement>('board3d'), $<HTMLCanvasElement>('board'));
initKindling($('elixir'));
if (import.meta.env.DEV) Object.assign(window, { board }); // poke at the 3D view from the console

let net: Net | null = null;
let online: OnlineMatch | null = null;
let local: LocalMatch | null = null; // vs Bot, entirely in this tab
let aim: [number, number] | null = null; // hover point on your half, world coords
let lock: [number, number] | null = null; // clicked spot for typed troops
let warmedFor = '';
const drops = new Drops(); // your drops from let-go to landing: board feedback and timings
const arted = new WeakSet<DrawTroop>(); // bot-match troops already sent for art
const mvp = new MvpTracker(); // your best troop this round, for the result screen

// ---------- connection ----------

function dial() {
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
}
dial();

// The connection dropped: "reconnecting…" while it redials every few seconds, and if that's
// taking a while mid-match, an offer to switch to Play vs Bot. Clears once it's back.
let droppedAt = 0;
let redial: ReturnType<typeof setTimeout> | undefined;
function dropped() {
  const midMatch = !local && myRoom()?.status === 'playing';
  if (!droppedAt) droppedAt = performance.now();
  const offer = (local: boolean) => {
    if (local) return;
    if (performance.now() - droppedAt > 4000) notice('Still reconnecting…', { tone: 'bad', hold: true, rank: 2, key: 'net', action: { label: 'Play vs Bot', run: switchToBot } });
    else notice('Reconnecting…', { tone: 'bad', hold: true, rank: 2, key: 'net' });
  };
  if (midMatch) offer(false);
  clearTimeout(redial);
  redial = setTimeout(() => {
    if (!droppedAt) return;
    if (myRoom()?.status === 'playing') offer(!!local);
    dial();
  }, 2500);
}
function switchToBot() {
  clearNotice('net');
  droppedAt = 0;
  clearTimeout(redial);
  startBot(botLevel);
}
function netMsg(s: string) {
  if (s === 'disconnected' || (droppedAt && s.startsWith("can't reach"))) dropped();
  else if (!s && droppedAt) {
    droppedAt = 0;
    clearTimeout(redial);
    clearNotice('net');
    notice('Back online', { tone: 'good', ms: 1600, key: 'netBack' });
  }
  $('netStatus').textContent = s;
  // The hub says it plainly; the HUD keeps the raw status for debugging.
  const state = !s ? 'online' : s === 'connected' || s === 'connecting…' ? 'joining' : 'off';
  $('hubNet').textContent = { online: 'Online', joining: 'Connecting…', off: 'Offline · practice still works' }[state];
  $('hubNet').className = `hubNet ${state}`;
  $('hubNet').title = s;
}
hubFx(document.querySelector('#title .hubSky')!);
for (const [sel, house, rim, phase] of [['left', 'raven', 'right', 0], ['right', 'sun', 'left', 2.3]] as const) {
  tapestry(document.querySelector(`#lobby .tapestry.${sel} .cloth`)!, document.querySelector(`#lobby .tapestry.${sel} .bannerBody`)!, { house, rim, phase });
}
resultFx($<HTMLCanvasElement>('resultSky'), () => ($('result').classList.contains('win') ? 'win' : $('result').classList.contains('lose') ? 'lose' : 'draw'));
// The home scene leans a little toward the cursor: ranges least, the island most.
$('lobby').addEventListener('pointermove', e => {
  $('lobby').style.setProperty('--px', ((e.clientX / innerWidth) * 2 - 1).toFixed(3));
  $('lobby').style.setProperty('--py', ((e.clientY / innerHeight) * 2 - 1).toFixed(3));
});
hubFx(document.querySelector('#lobby .hubSky')!, { embers: document.querySelector<HTMLElement>('#lobby .islandWrap')! });
// Things react to pokes (react.ts): buttons, the home banners and wordmark, and the board.
menuReactions();
homeReactions();
boardReactions(board, { playing: () => match()?.status === 'playing', mySide: () => mySide(), canDeploy: (x, y) => canDeployAt(x, y) });
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
let entered = false, entering = false;
function enter() {
  if (entering) return;
  entering = true;
  // The title's wordmark glides up into the home screen's (view-transition-name: wordmark). The
  // home screen stays hidden until the transition has its snapshot of the title.
  const show = () => {
    entered = true;
    $('title').hidden = true;
    renderLobby();
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(show);
  else show();
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
const icon = (body: string) => `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const FLAME_ICON = icon('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>');
const SNOW_ICON = icon('<path d="M12 2v20"/><path d="m4.93 7 14.14 10"/><path d="m4.93 17 14.14-10"/><path d="m9 4 3 3 3-3"/><path d="m9 20 3-3 3 3"/>');

$<HTMLInputElement>('nameInput').value = savedName();
$<HTMLInputElement>('nameInput').onchange = e => {
  const name = (e.target as HTMLInputElement).value.trim();
  if (!name) return;
  remember(NAME_KEY, name);
  call(net?.conn.reducers.setName({ name }));
};
$('nameInput').onkeydown = e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() };

const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
let botLevel = ((): BotLevel => {
  try { return (localStorage.getItem(LEVEL_KEY) as BotLevel) || 'normal' } catch { return 'normal' }
})();
function renderLevel() {
  for (const b of $('botLevel').querySelectorAll<HTMLElement>('[data-level]')) b.setAttribute('aria-checked', String(b.dataset.level === botLevel));
}
renderLevel();
$('botLevel').onclick = e => {
  const level = (e.target as HTMLElement).closest<HTMLElement>('[data-level]')?.dataset.level as BotLevel | undefined;
  if (!level || !LEVELS.includes(level)) return;
  botLevel = level;
  remember(LEVEL_KEY, botLevel);
  renderLevel();
};

// Every menu button ticks.
for (const id of ['lobby', 'raven', 'pause', 'forfeitAsk', 'result']) {
  $(id).addEventListener('click', e => { if ((e.target as HTMLElement).closest('button')) sfx.play('click') });
}

// Points and rank, kept in this browser.
let embers = loadEmbers();
function renderEmbers() {
  const rank = rankOf(embers);
  $('emberCount').textContent = embers.toLocaleString('en-US');
  $('emberRank').textContent = rank.name;
  const from = RANKS.find(r => r.name === rank.name)!.at;
  $('emberBar').style.width = rank.nextAt === null ? '100%' : `${((embers - from) / (rank.nextAt - from)) * 100}%`;
  $('emberNext').textContent = rank.nextAt === null ? 'The highest rank' : `${rank.nextAt - embers} more to ${rank.next}`;
}
renderEmbers();

// The last match, shown on the red banner between matches.
const LAST_KEY = 'arena.lastMatch';
interface LastMatch { foe: string; outcome: Outcome; score: string }
function renderLast() {
  let last: LastMatch | null = null;
  try { last = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') } catch { /* private mode or junk */ }
  $('lastMatch').classList.toggle('empty', !last);
  if (!last) return;
  $('lastFoe').textContent = `vs ${last.foe}`;
  $('lastScore').textContent = `${{ win: 'Won', lose: 'Lost', draw: 'Drew' }[last.outcome]} ${last.score}`;
  $('lastScore').className = `bLastScore ${last.outcome}`;
}
renderLast();

$('botBtn').onclick = () => startBot(botLevel);
// No matchmaking yet: Play online and Join a room open the same room pop-up; Join starts at the code boxes.
$('battleBtn').onclick = () => openRaven();
$('ravenBtn').onclick = () => {
  openRaven();
  renderRaven();
  codeIns[0].focus();
};
$('camBtn').onclick = e => {
  setup.open();
  (e.currentTarget as HTMLElement).blur();
};
$('rematchBtn').onclick = () => {
  call(match()?.rematch());
  if (local) botStarted(local.level);
};
$('lobbyBtn').onclick = () => {
  ravenOpen = false;
  if (local?.status === 'playing') botEnded('left');
  call(match()?.leave());
};

function startBot(level: BotLevel) {
  lock = null;
  ravenOpen = false;
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

function renderLobby() {
  const p = me(), r = myRoom();
  const inMatch = !!local || restarting || r?.status === 'playing' || r?.status === 'done';
  $('lobby').hidden = !entered || inMatch;
  document.body.classList.toggle('inHub', !inMatch);
  if (p && document.activeElement !== $('nameInput')) $<HTMLInputElement>('nameInput').value = p.name;
  if (r?.status === 'playing') ravenOpen = false;
  renderRaven();
}

// ---------- send a raven: a room for you and a friend ----------

let ravenOpen = false;
let hadGuest = false;
let hadAway = false; // the other player in the room had dropped their connection
let wasGuest = false; // in someone else's room, still in its lobby
const ravenErr = (msg: string) => ($('ravenError').textContent = msg);
const codeIns = [...document.querySelectorAll<HTMLInputElement>('.codeIn')];

function openRaven() {
  ravenOpen = true;
  ravenErr('');
  if (net && !myRoom()) call(net.conn.reducers.createRoom({}), ravenErr);
}
$('ravenClose').onclick = () => {
  ravenOpen = false;
  if (myRoom()?.status === 'lobby') call(online?.leave(), () => {});
};
$('copyBtn').onclick = () => {
  const code = myRoom()?.code;
  if (!code) return;
  navigator.clipboard?.writeText(code).then(() => {
    const b = $('copyBtn').querySelector('b')!;
    b.textContent = 'Copied';
    setTimeout(() => (b.textContent = 'Copy'), 1200);
  }, () => {});
};
codeIns.forEach((el, i) => {
  el.oninput = () => {
    el.value = el.value.replace(/[^a-z0-9]/gi, '').slice(-1).toUpperCase();
    if (el.value && i < codeIns.length - 1) codeIns[i + 1].focus();
  };
  el.onkeydown = e => { if (e.key === 'Backspace' && !el.value && i > 0) codeIns[i - 1].focus() };
  el.onpaste = e => {
    const t = (e.clipboardData?.getData('text') ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 4);
    if (!t) return;
    e.preventDefault();
    codeIns.forEach((c, k) => (c.value = t[k] ?? ''));
    codeIns[Math.min(t.length, codeIns.length - 1)].focus();
  };
});
$<HTMLFormElement>('joinForm').onsubmit = e => {
  e.preventDefault();
  const code = codeIns.map(c => c.value).join('');
  if (code.length < 4) return ravenErr('Enter all four letters of their code');
  ravenErr('');
  call(net?.conn.reducers.joinRoom({ code }), ravenErr);
  codeIns.forEach(c => (c.value = ''));
};
$('startBtn').onclick = () => call(net?.conn.reducers.startMatch({}), ravenErr);

function renderRaven() {
  const r = myRoom();
  // The host closing the room clears the guest's room too; say so instead of showing blank code slabs.
  // Skipped until my player row is in, so a redial's empty tables don't read as the room closing.
  if (me()) {
    if (!r && wasGuest && ravenOpen) {
      ravenOpen = false;
      notice('The other player left the room', { tone: 'warn', key: 'foeLeft' });
    }
    wasGuest = r?.status === 'lobby' && !!net && !r.host.isEqual(net.identity);
  }
  const show = entered && !local && (ravenOpen || r?.status === 'lobby');
  $('raven').hidden = !show;
  if (!!r?.guest !== hadGuest) {
    hadGuest = !!r?.guest;
    if (hadGuest && r?.status === 'lobby') sfx.play('joined');
  }
  if (!show) return;
  const hosting = !!r && !!net && r.host.isEqual(net.identity);
  $('ravenSub').textContent = !net
    ? 'Can’t reach the server right now. Practice against the bot still works.'
    : r && !hosting ? 'You joined their room. Either of you can start the match.'
    : 'Send this code to a friend. They enter it under Join a room.';
  setHtml('codeSlabs', (r?.code ?? '····').split('').map(c => `<span class="code">${escapeHtml(c)}</span>`).join(''));
  const meName = myName();
  setHtml('slotMe', `${shieldSvg('raven', initial(meName), 50)}<div><span class="hName">${escapeHtml(meName)}</span><span class="hHouse">Blue side</span></div>`);
  const foeId = r ? (hosting ? r.guest : r.host) : undefined;
  const foe = foeId && net ? net.conn.db.player.identity.find(foeId) : undefined;
  const foeAway = !!foe && !foe.online;
  if (foe && foeAway !== hadAway) notice(foeAway ? `${foe.name} disconnected` : `${foe.name} is back`, { tone: foeAway ? 'warn' : 'good', key: 'foeAway' });
  hadAway = foeAway;
  $('slotFoe').classList.toggle('away', foeAway);
  setHtml('slotFoe', foe
    ? `<div><span class="hName">${escapeHtml(foe.name)}</span><span class="hHouse">${foeAway ? 'Disconnected' : 'Red side'}</span></div>${shieldSvg('sun', initial(foe.name), 50)}`
    : `<div><span class="hName waiting">Waiting for a friend…</span><span class="hHouse">Red side</span></div>${shieldSvg('sun', '', 50, true)}`);
  $<HTMLButtonElement>('startBtn').disabled = !r?.guest || foeAway;
  $('startSub').textContent = foeAway ? 'Your friend disconnected. Waiting for them to come back'
    : r?.guest ? 'Both players are here' : 'Waiting for your friend to join';
  $<HTMLButtonElement>('copyBtn').disabled = !r;
  $<HTMLButtonElement>('answerBtn').disabled = !net;
}

// innerHTML only when it changes, so hover and focus survive the per-frame render.
function setHtml(id: string, html: string) {
  const el = $(id);
  if (el.dataset.html !== html) el.innerHTML = el.dataset.html = html;
}

// ---------- the round: what happened, for the result screen ----------

interface Round {
  cappedSecs: number;
  myKingFellAt: number | null;
  theirKingFellAt: number | null;
  deploys: number;
  elixirSpent: number;
  shown: boolean; // result screen filled and points awarded
}
const newRound = (): Round => ({ cappedSecs: 0, myKingFellAt: null, theirKingFellAt: null, deploys: 0, elixirSpent: 0, shown: false });
let round = newRound();
let lastTick = 0;

function trackRound(m: MatchSource) {
  const now = performance.now();
  const dt = lastTick ? Math.min(0.25, (now - lastTick) / 1000) : 0;
  lastTick = now;
  if (m.status !== 'playing' || m.time < 0) return;
  if (m.elixir >= ELIXIR_MAX - 1e-6 && !local?.paused) round.cappedSecs += dt;
  for (const t of m.towers()) {
    if (t.lane !== KING_LANE || t.hp > 0) continue;
    if (t.side === m.side) round.myKingFellAt ??= m.time;
    else round.theirKingFellAt ??= m.time;
  }
}

// Won by the clock or a king tower, or handed over by a forfeit?
let iForfeited = false;
function byForfeit(m: MatchSource) {
  const kingsUp = m.towers().filter(t => t.lane === KING_LANE).every(t => t.hp > 0);
  return m.winner !== -1 && m.winner !== null && kingsUp && m.time < MATCH_SECONDS - 0.01;
}

function foeName(m: MatchSource) {
  if (local) return `Bot (${local.level})`;
  const r = myRoom(), id = m.side === 0 ? r?.guest : r?.host;
  return (id && net?.conn.db.player.identity.find(id)?.name) || 'Opponent';
}

function renderResult() {
  const m = match();
  const done = m?.status === 'done';
  $('result').hidden = !done;
  if (!done || !m) return;
  $<HTMLButtonElement>('rematchBtn').disabled = !local && !myRoom()?.guest;
  if (round.shown) return;
  round.shown = true;
  const side = m.side;
  const outcome: Outcome = m.winner === -1 ? 'draw' : m.winner === side ? 'win' : 'lose';
  const before = embers;
  embers = applyDelta(embers, emberDelta(outcome, local ? local.level : 'online'));
  saveEmbers(embers);
  renderEmbers();
  const delta = embers - before;

  const towers = m.towers();
  const theirs = towers.filter(t => t.side !== side), mine = towers.filter(t => t.side === side);
  const king = (ts: typeof towers) => ts.find(t => t.lane === KING_LANE);
  let myBest: RoundSummary['myBest'] = null, theirBest: RoundSummary['theirBest'] = null;
  if (local) {
    const troops = local.report().troops;
    const top = <T,>(xs: T[], f: (x: T) => number) => xs.reduce<T | null>((a, x) => (!a || f(x) > f(a) ? x : a), null);
    const a = top(troops.filter(t => t.side === side), t => t.unitDamage + t.towerDamage);
    const b = top(troops.filter(t => t.side !== side), t => t.towerDamage);
    if (a) myBest = { name: a.name, damage: a.unitDamage + a.towerDamage };
    if (b) theirBest = { name: b.name, towerDamage: b.towerDamage };
  }
  const summary: RoundSummary = {
    outcome, forfeit: byForfeit(m),
    towersTaken: theirs.filter(t => t.hp <= 0).length, towersLost: mine.filter(t => t.hp <= 0).length,
    theirKingDown: (king(theirs)?.hp ?? 1) <= 0, myKingDown: (king(mine)?.hp ?? 1) <= 0,
    myKingStruck: !!king(mine) && king(mine)!.hp < king(mine)!.maxHp,
    theirKingFellAt: round.theirKingFellAt, myKingFellAt: round.myKingFellAt, cappedSecs: round.cappedSecs, endedAt: m.time, myBest, theirBest,
  };

  remember(LAST_KEY, JSON.stringify({ foe: foeName(m), outcome, score: `${summary.towersTaken}–${summary.towersLost}` } satisfies LastMatch));
  renderLast();
  const res = $('result');
  res.className = `screen gScreen result ${outcome}`;
  $<HTMLImageElement>('resultBg').src = `/ui/${outcome === 'win' ? 'gold' : outcome === 'lose' ? 'ice' : 'home'}.svg`;
  $('resultLabel').textContent = `${m.label} · ${clockText(m, true)}`;
  $('resultText').textContent = { win: 'Victory', lose: 'Defeat', draw: 'Draw' }[outcome].toUpperCase();
  $('resultLine').textContent = !summary.forfeit ? '' : outcome === 'lose' && iForfeited ? 'You forfeited.' : outcome === 'win' ? 'Your opponent forfeited.' : '';
  const tone = outcome === 'lose' ? 'ice' : 'gold';
  $('crowns').innerHTML = [0, 1, 2].map(i => crownSvg(i < summary.towersTaken ? tone : `empty-${tone}`, 64)).join('');
  $('erIcon').innerHTML = outcome === 'lose' ? SNOW_ICON : FLAME_ICON;
  countUp($('emberDelta'), delta);
  const rk = rankOf(embers);
  $('erRank').textContent = rk.name;
  $('erNext').textContent = rk.next ? `${embers.toLocaleString('en-US')} / ${rk.nextAt!.toLocaleString('en-US')} to ${rk.next}` : `${embers.toLocaleString('en-US')} points`;
  $('whyLabel').textContent = { win: 'Why you won', lose: 'Why you lost', draw: 'How it ended' }[outcome];
  $('whyList').innerHTML = reasons(summary).map(r => `<li>${escapeHtml(r)}</li>`).join('');
  const damage = theirs.reduce((n, t) => n + Math.max(0, t.maxHp - Math.max(0, t.hp)), 0);
  $('stats').innerHTML = [[`${summary.towersTaken}–${summary.towersLost}`, 'Towers'], [Math.round(damage).toLocaleString('en-US'), 'Tower damage'],
    [String(round.deploys), 'Troops'], [String(round.elixirSpent), 'Embers']].map(([v, l]) => `<div><b>${v}</b><small>${l}</small></div>`).join('');
  const banner = (id: string, house: 'raven' | 'sun', frosted: boolean) => {
    $(id).classList.toggle('frosted', frosted);
    $(id).querySelector('img')!.src = `/ui/banner-${house}${frosted ? '-frosted' : ''}.svg`;
  };
  banner('resBanMe', 'raven', outcome === 'lose');
  banner('resBanFoe', 'sun', outcome === 'win');
  $('resMeName').textContent = myName();
  $('resFoeName').textContent = foeName(m);
  const tag = (won: boolean) => outcome === 'draw' ? 'Draw' : won ? 'Winner' : 'Defeated';
  $('resMeTag').textContent = tag(outcome === 'win');
  $('resFoeTag').textContent = tag(outcome === 'lose');
  renderMvp(mvp.best(side, local?.report().troops));
  $('rematchText').textContent = 'Rematch';
  $('rematchSub').textContent = local ? `Same bot, ${local.level}` : 'Same opponent';
}

// The points tick up (or down) once the crowns have landed.
function countUp(el: HTMLElement, delta: number) {
  const fmt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !delta) return void (el.textContent = fmt(delta));
  const start = performance.now() + 1100, dur = 700;
  el.textContent = '0';
  const step = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - start) / dur));
    el.textContent = fmt(Math.round(delta * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- versus card, pause and forfeit ----------

let vsShown = false;
function renderVersus(m: MatchSource | null) {
  const t = m?.time ?? 0;
  const show = !!m && m.status === 'playing' && t < -COUNTDOWN;
  if (show && !vsShown) {
    iForfeited = false;
    round = newRound();
    const me = myName(), them = foeName(m!);
    $('vsMe').textContent = me;
    $('vsMeShield').innerHTML = shieldSvg('raven', initial(me), 92);
    $('vsThem').textContent = them;
    $('vsThemShield').innerHTML = shieldSvg('sun', initial(them), 92);
    $('vsThemTag').textContent = 'Red side';
    sfx.play('versus');
  }
  vsShown = show;
  $('versus').hidden = !show;
  $('versus').classList.toggle('leaving', show && t > -COUNTDOWN - 0.35);
}

// Time left on the match clock (overtime counts down its own 30 s), or (elapsed) time into the match.
function clockText(m: MatchSource, elapsed = false) {
  const t = Math.max(0, m.time);
  if (elapsed) return clock(Math.min(TIEBREAK_AT, t));
  return clock(Math.max(0, t < MATCH_SECONDS ? MATCH_SECONDS - t : TIEBREAK_AT - t));
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
  const had = m.elixir; // for the burnt sticks, before the payment shows
  try {
    await m.deployTroop(nonce, x, y, description, d, spriteUrl);
    settle(nonce, 'deployed');
    round.deploys++;
    round.elixirSpent += price(d);
    const to = board.toScreen(x, y);
    if (to) burnSticks(had - price(d), price(d), to[0], to[1]);
    drops.deployed(nonce, performance.now());
    return true;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    settle(nonce, msg);
    call(match()?.cancelDeploy(nonce), () => {});
    sfx.play('buzz');
    const m = msg.match(/(too expensive|not enough elixir): (\d+)/);
    if (m?.[1] === 'not enough elixir') {
      sfx.play('tooExpensive');
      const need = Number(m[2]), have = match()?.elixir ?? 0;
      const secs = elixirWait(need, have);
      status(`${d.name} needs ${need} embers, you have ${Math.floor(have)}`, true);
      notice(`Need ${need} embers, have ${Math.floor(have)} · ready in about ${secs} s`, { tone: 'bad', ms: 2600, key: 'elixir' });
      starve(need);
      drops.refused(nonce, `need ${need} · have ${Math.floor(have)}`, performance.now()); // no coin: that's for over 10
    } else {
      status(m ? `${d.name} would cost ${m[2]} — over the 10 limit` : msg, true);
      drops.refused(nonce, m ? `would cost ${m[2]}, over 10` : 'refused', performance.now());
    }
    return false;
  }
}

// Seconds until `need` elixir is in hand at the current rate (double in the last 30 s, triple in
// overtime), rounded up.
function elixirWait(need: number, have: number): number {
  const m = match();
  const rate = elixirRate(m?.time ?? 0);
  return Math.max(1, Math.ceil((need - have) / rate));
}

// The elixir bar flashes and shivers, and a gold marker shows where it has to fill to.
let starveTimer: ReturnType<typeof setTimeout> | undefined;
function starve(need: number) {
  const row = $('elixirRow');
  $('elixirNeed').style.left = `${(Math.min(ELIXIR_MAX, need) / ELIXIR_MAX) * 100}%`;
  row.classList.remove('starved');
  void row.offsetWidth;
  row.classList.add('starved');
  clearTimeout(starveTimer);
  starveTimer = setTimeout(() => row.classList.remove('starved'), 2500);
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
    const { design, ms, source, early } = d;
    const tags = [source === 'offline' && 'improvised', early && 'early'].filter(Boolean).join(', ');
    drops.designed(nonce, design.name, tags, performance.now());
    status(`${design.name} · ${ms} ms${tags ? ` (${tags})` : ''}`); // the cost waits for the landing reveal
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
  started: () => (match()?.time ?? -1) > 0.5,
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
  notice(a ? 'Noted — the game learns from this' : 'Noted — nothing of yours to flag yet', { tone: 'good', ms: 2200, key: 'flag' });
  sfx.play('noted');
  if (a?.description) board.juice.flag(a.description);
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
  (a, i) => `<button data-i="${i}">${i < 10 ? `<kbd>${(i + 1) % 10}</kbd>` : ''}${escapeHtml(a.name)}</button>`
).join('');
$('hand').onclick = e => {
  const b = (e.target as HTMLElement).closest('button');
  if (b) deployAnchor(Number(b.dataset.i));
};

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Escape') e.target.blur();
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
  if (m) trackRound(m);
  // The title, home and result screens are opaque: no need to draw the board under them.
  const visible = $('title').hidden && $('lobby').hidden && $('result').hidden;
  if (!m) {
    $('roomInfo').textContent = '';
    board.draw({ mySide: 0, units: [], towers: [], troops: new Map(), pendings: [], aim: null, lock: null, status: 'lobby' }, visible);
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
  const playing = m.status === 'playing';
  const phase = !playing ? null : m.time >= TIEBREAK_AT ? 'Tiebreaker' : m.time >= MATCH_SECONDS ? 'Overtime · triple embers' : left <= 30 ? 'Double embers' : null;
  $('roomInfo').textContent = phase ?? m.label;
  $('roomInfo').classList.toggle('double', !!phase);
  $('dock').classList.toggle('double', !!phase);
  $('clock').classList.toggle('overtime', playing && m.time >= MATCH_SECONDS);
  // The raw connection state only matters online, and only when something is wrong.
  $('netStatus').hidden = !!local || !$('netStatus').textContent || droppedAt > 0; // the reconnect banner says it plainly
  const elixir = m.elixir;
  $('elixirFill').style.width = `${(elixir / ELIXIR_MAX) * 100}%`;
  $('elixirText').textContent = String(Math.floor(elixir));
  updateKindling($('elixirRow'), elixir, ELIXIR_MAX);

  showTimings();
  const units = m.units();
  const troops = m.troops();
  if (m.status === 'playing') mvp.observe(units, troops, m.time);
  if (local) artForBot(local);

  board.draw({
    mySide: side,
    units,
    towers: m.towers(),
    troops,
    pendings: m.pendings(),
    aim: m.status === 'playing' ? aim : null,
    lock: m.status === 'playing' ? lock : null,
    input: input.view(),
    drops: m.status === 'playing' ? drops.views(performance.now()) : [],
    time: m.time,
    status: m.status,
    winner: m.winner ?? undefined,
  }, visible);
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
