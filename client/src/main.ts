import { ANCHORS } from '../../shared/anchors';
import { COUNTDOWN, ELIXIR, KING_LANE, MATCH_SECONDS, MID_Y, TIEBREAK_AT, canDeploy, elixirRate, onBoard, type Side } from '../../shared/arena';
import type { BotLevel } from '../../shared/bot';
import { newTowers } from '../../shared/sim';
import { MAX_COST, price, type TroopDesign } from '../../shared/troop';
import { designTroop, prefetchDesign, warmDesigner } from './designer';
import { elixirRules, initDevSettings } from './dev';
import { Drops, releaseToStats, timingLines } from './drops';
import { InputController, TOUCH, type DeployHow } from './input/controller';
import { warmHandTracker } from './input/hand';
import { isCancel, Transcript } from './input/speech';
import { spokenLetters } from './input/spell';
import { LocalMatch } from './local';
import { OnlineMatch, type MatchSource } from './match';
import { connect, type Net } from './net';
import { PovBoard } from './pov';
import { Recorder } from './recorder';
import { burnSticks, initKindling, updateKindling } from './kindling';
import type { DrawTroop } from './render';
import { sfx } from './sfx';
import { initSetup, setupDone } from './setup';
import { prefetchSprite, requestSprite, spriteError } from './sprites';
import { diag, dropArtDone, dropBegin, dropCancelled, dropDeployed, dropDesigned, dropFailed, dropStep, dropWords, explain } from './diag';
import { runHealthCheck } from './health';
import { Attempt, attachLogs, logBotEnd, logBotStart, logEvent, logUtterance } from './telemetry';
import { crownSvg, shieldSvg, type House } from './art';
import { clock } from './chronicle';
import { RANKS, applyDelta, emberDelta, loadEmbers, rankOf, saveEmbers, type Outcome } from './embers';
import { hubFx, resultFx } from './hubfx';
import { tapestry } from './banner';
import { heraldryCss } from './heraldry';
import { icon, mountIcons } from './icons';
import { homeDim } from './homedim';
import { showTutorialOnce } from './tutorial';
import { MvpTracker, renderMvp } from './mvp';
import { clearNotice, notice } from './notice';
import { boardReactions, homeReactions, menuReactions } from './react';
import { inject as injectAnalytics } from '@vercel/analytics';
import './mobile.css';

injectAnalytics(); // Vercel Web Analytics: page views on the deployed site; dev only logs them to the console

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const board = new PovBoard($<HTMLCanvasElement>('board3d'), $<HTMLCanvasElement>('board'));
const recorder = new Recorder($<HTMLCanvasElement>('board3d'), $<HTMLCanvasElement>('board')); // every match, to Blob
initKindling($('elixir'));
if (import.meta.env.DEV) Object.assign(window, { board, bot: () => local }); // poke at the 3D view and the bot match from the console

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
runHealthCheck();

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
  $('netStatus').textContent = s; // raw status, for debugging
}
heraldryCss();
mountIcons();
homeDim($('lobby'), (x, y, h) => board.toScreen(x, y, h));
hubFx(document.querySelector('#title .hubSky')!);
for (const [sel, house, rim, phase] of [['left', 'raven', 'right', 0], ['right', 'sun', 'left', 2.3]] as const) {
  tapestry(document.querySelector(`#lobby .tapestry.${sel} .cloth`)!, document.querySelector(`#lobby .tapestry.${sel} .bannerBody`)!, { house, rim, phase });
}
resultFx($<HTMLCanvasElement>('resultSky'), () => ($('result').classList.contains('win') ? 'win' : $('result').classList.contains('lose') ? 'lose' : 'draw'));
// The home menu's mist leans a little toward the cursor (the 3D arena under it leans in pov.ts).
// The hand cursor leans it the same way (see frame()).
function leanMist(x: number, y: number) {
  $('lobby').style.setProperty('--px', ((x / innerWidth) * 2 - 1).toFixed(3));
  $('lobby').style.setProperty('--py', ((y / innerHeight) * 2 - 1).toFixed(3));
}
$('lobby').addEventListener('pointermove', e => leanMist(e.clientX, e.clientY));
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
// Aimed past your own zone (your half and any pocket you've opened): only a spell can land there.
const spellSpot = ([x, y]: [number, number]) => onBoard(x, y) && !canDeployAt(x, y);
// Colours go by side on both screens: side 0 (the host, or you against the bot) is blue, side 1 red.
const SIDE_NAME = ['Blue side', 'Red side'];
const houseOf = (side: Side): House => (side === 0 ? 'raven' : 'sun');

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
if (TOUCH) $('enterBtn').textContent = 'Tap to start';
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

const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
let botLevel = ((): BotLevel => {
  try { return (localStorage.getItem(LEVEL_KEY) as BotLevel) || 'normal' } catch { return 'normal' }
})();
// Practice asks for a difficulty, the last one picked lit amber, and starts straight away.
function openPractice(open: boolean) {
  $('practice').hidden = !open;
  if (!open) return;
  for (const b of $('botLevel').querySelectorAll<HTMLElement>('[data-level]')) {
    const last = b.dataset.level === botLevel;
    b.classList.toggle('amber', last);
    b.classList.toggle('stone', !last);
    if (last) b.focus();
  }
}
$('botLevel').onclick = e => {
  const level = (e.target as HTMLElement).closest<HTMLElement>('[data-level]')?.dataset.level as BotLevel | undefined;
  if (!level || !LEVELS.includes(level)) return;
  botLevel = level;
  remember(LEVEL_KEY, botLevel);
  openPractice(false);
  startBot(level);
};
initDevSettings();
$('practiceBack').onclick = () => openPractice(false);
$('practice').onclick = e => { if (e.target === e.currentTarget) openPractice(false) };

// Every menu button ticks.
for (const id of ['lobby', 'practice', 'raven', 'pause', 'forfeitAsk', 'result']) {
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
  $('emberNext').textContent = rank.nextAt === null ? 'The highest rank' : `${rank.nextAt - embers} XP to ${rank.next}`;
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

$('botBtn').onclick = () => openPractice(true);
// No matchmaking yet: Play online opens a room, with code boxes to join a friend's instead.
$('battleBtn').onclick = () => openRaven();
// Home's camera button, where the virtual hand goes: asks for the camera, and if that fails opens
// setup, which says how to allow it.
$('handBtn').onclick = async e => {
  (e.currentTarget as HTMLElement).blur();
  await input.setCamera(true);
  if (!input.setupState().camera) setup.open();
};
// Phones don't aim with the camera, so the button is just the mic, on and off in one tap.
$('camBtn').onclick = e => {
  (e.currentTarget as HTMLElement).blur();
  if (TOUCH) void input.setMic(!input.setupState().mic);
  else setup.open();
};
if (TOUCH) {
  $('camBtn').innerHTML = icon('mic', 'light', 20);
  $('camBtn').setAttribute('aria-label', 'Mic');
  $('camBtn').title = 'Mic';
}
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
  local = new LocalMatch(level, () => (local = null), true, Math.random, elixirRules());
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
  // On home the virtual hand sits in the button row, beside Play online; in a match, bottom right.
  const hv = document.getElementById('handView'), home = $('lobby').hidden ? document.body : $('handSlot');
  if (hv && hv.parentElement !== home) home.appendChild(hv);
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
// With a code box focused, saying the letters fills them in; the fourth letter joins. Words
// add on to the letters already there, and a full code starts over.
const codeWords = new Transcript();
let codeBase = '';
function codeAfresh() {
  codeWords.reset();
  const v = codeIns.map(c => c.value).join('');
  codeBase = v.length < codeIns.length ? v : '';
}
function dictateCode(raw: string, final: boolean, epoch: number): boolean {
  if ($('raven').hidden || !codeIns.includes(document.activeElement as HTMLInputElement)) return false;
  if (/^(clear|clear it|start over)$/i.test(raw.trim().replace(/[.,!?]/g, '')) || isCancel(raw)) {
    codeIns.forEach(c => (c.value = ''));
    codeIns[0].focus();
    codeAfresh();
    return true;
  }
  if (final) codeWords.final(raw, epoch);
  else codeWords.interim(raw, epoch);
  const code = (codeBase + spokenLetters(codeWords.text)).slice(0, codeIns.length);
  codeIns.forEach((c, k) => (c.value = code[k] ?? ''));
  codeIns[Math.min(code.length, codeIns.length - 1)].focus();
  if (code.length === codeIns.length && final && !codeWords.pending) {
    codeAfresh();
    $<HTMLFormElement>('joinForm').requestSubmit();
  }
  return true;
}
$('joinForm').addEventListener('focusin', e => {
  if (!codeIns.includes((e as FocusEvent).relatedTarget as HTMLInputElement)) codeAfresh();
  $('codeHint').hidden = !input.listening;
});
$('joinForm').addEventListener('focusout', e => {
  if (!codeIns.includes((e as FocusEvent).relatedTarget as HTMLInputElement)) $('codeHint').hidden = true;
});
codeIns.forEach((el, i) => {
  el.oninput = () => {
    el.value = el.value.replace(/[^a-z0-9]/gi, '').slice(-1).toUpperCase();
    if (el.value && i < codeIns.length - 1) codeIns[i + 1].focus();
    codeAfresh();
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

// A player's slot in the room pop-up: shield on the outside edge, blue on the left and red on the right.
function houseSlot(side: Side, name: string, sub: string, waiting = false) {
  const text = `<div><span class="hName${waiting ? ' waiting' : ''}">${escapeHtml(name)}</span><span class="hHouse">${sub}</span></div>`;
  const shield = shieldSvg(houseOf(side), waiting ? '' : initial(name), 50, waiting);
  return side === 0 ? shield + text : text + shield;
}

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
    : 'Send this code to a friend. They enter it under Play online.';
  setHtml('codeSlabs', (r?.code ?? '····').split('').map(c => `<span class="code">${escapeHtml(c)}</span>`).join(''));
  // The host plays the blue side and the guest the red one: blue's slot is on the left.
  const meName = myName(), mine: Side = r && !hosting ? 1 : 0;
  const [mySlot, foeSlot] = mine === 0 ? ['slotBlue', 'slotRed'] : ['slotRed', 'slotBlue'];
  setHtml(mySlot, houseSlot(mine, meName, `${SIDE_NAME[mine]} · You`));
  const foeId = r ? (hosting ? r.guest : r.host) : undefined;
  const foe = foeId && net ? net.conn.db.player.identity.find(foeId) : undefined;
  const foeAway = !!foe && !foe.online;
  if (foe && foeAway !== hadAway) notice(foeAway ? `${foe.name} disconnected` : `${foe.name} is back`, { tone: foeAway ? 'warn' : 'good', key: 'foeAway' });
  hadAway = foeAway;
  $(mySlot).classList.remove('away');
  $(foeSlot).classList.toggle('away', foeAway);
  setHtml(foeSlot, foe
    ? houseSlot(1 - mine as Side, foe.name, foeAway ? 'Disconnected' : SIDE_NAME[1 - mine])
    : houseSlot(1 - mine as Side, 'Waiting for a friend…', SIDE_NAME[1 - mine], true));
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
  shown: boolean; // result screen filled and XP awarded
}
const newRound = (): Round => ({ cappedSecs: 0, myKingFellAt: null, theirKingFellAt: null, deploys: 0, elixirSpent: 0, shown: false });
let round = newRound();
let lastTick = 0;

function trackRound(m: MatchSource) {
  const now = performance.now();
  const dt = lastTick ? Math.min(0.25, (now - lastTick) / 1000) : 0;
  lastTick = now;
  if (m.status !== 'playing' || m.time < 0) return;
  if (m.elixir >= m.rules.max - 1e-6 && !local?.paused) round.cappedSecs += dt;
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

const END_HOLD_MS = 1800;
let endAt = 0; // when the match ended, for the frozen-board pause before the result screen
const resultBanners = {
  me: tapestry(document.querySelector('#resBanMe .cloth')!, document.querySelector('#resBanMe .bannerBody')!, { house: 'raven', rim: 'right' }),
  foe: tapestry(document.querySelector('#resBanFoe .cloth')!, document.querySelector('#resBanFoe .bannerBody')!, { house: 'sun', rim: 'left', phase: 2.3 }),
};

function renderResult() {
  const m = match();
  const done = m?.status === 'done';
  // The match ends on a frozen board: it holds for a moment, then the result screen fades in over it.
  if (done && !endAt) {
    endAt = performance.now();
    document.body.dataset.ending = m.winner === -1 ? 'draw' : m.winner === m.side ? 'win' : 'lose';
  }
  if (!done) {
    endAt = 0;
    delete document.body.dataset.ending;
  }
  const reveal = done && (performance.now() - endAt > END_HOLD_MS || matchMedia('(prefers-reduced-motion: reduce)').matches);
  $('result').hidden = !reveal;
  if (!reveal || !m) return;
  $<HTMLButtonElement>('rematchBtn').disabled = !local && !myRoom()?.guest;
  if (round.shown) return;
  round.shown = true;
  const side = m.side;
  const outcome: Outcome = m.winner === -1 ? 'draw' : m.winner === side ? 'win' : 'lose';
  const before = embers;
  embers = applyDelta(embers, emberDelta(outcome, local ? local.level : 'online'));
  saveEmbers(embers);
  renderEmbers();

  const towers = m.towers();
  const towersTaken = towers.filter(t => t.side !== side && t.hp <= 0).length, towersLost = towers.filter(t => t.side === side && t.hp <= 0).length;
  const forfeit = byForfeit(m);

  remember(LAST_KEY, JSON.stringify({ foe: foeName(m), outcome, score: `${towersTaken}–${towersLost}` } satisfies LastMatch));
  renderLast();
  const res = $('result');
  res.className = `screen gScreen result ${outcome}`;
  $<HTMLImageElement>('resultBg').src = `/ui/${outcome === 'win' ? 'gold' : outcome === 'lose' ? 'ice' : 'home'}.svg`;
  $('resultLabel').textContent = `${m.label} · ${clockText(m, true)}`;
  $('resultText').textContent = { win: 'Victory', lose: 'Defeat', draw: 'Draw' }[outcome].toUpperCase();
  $('resultLine').textContent = !forfeit ? '' : outcome === 'lose' && iForfeited ? 'You forfeited.' : outcome === 'win' ? 'Your opponent forfeited.' : '';
  const tone = outcome === 'lose' ? 'ice' : 'gold';
  $('crowns').innerHTML = [0, 1, 2].map(i => crownSvg(i < towersTaken ? tone : `empty-${tone}`, 64)).join('');
  // XP's star and the damage swords, gold on a win or draw, ice on a loss.
  $('erIcon').innerHTML = icon('star', outcome === 'lose' ? 'ice' : 'gold', 34);
  $('dmgIcon').innerHTML = icon('swords', outcome === 'lose' ? 'ice' : 'gold', 34);
  const rk = rankOf(embers);
  $('erRank').textContent = rk.name;
  countUp(before, embers);
  // Each tapestry in its player's side colour; the loser's freezes over.
  resultBanners.me.set({ house: houseOf(side), frozen: outcome === 'lose' });
  resultBanners.foe.set({ house: houseOf(1 - side as Side), frozen: outcome === 'win' });
  $('resMeSide').textContent = SIDE_NAME[side];
  $('resFoeSide').textContent = SIDE_NAME[1 - side];
  $('resMeName').textContent = myName();
  $('resFoeName').textContent = foeName(m);
  const tag = (won: boolean) => outcome === 'draw' ? 'Draw' : won ? 'Winner' : 'Defeated';
  $('resMeTag').textContent = tag(outcome === 'win');
  $('resFoeTag').textContent = tag(outcome === 'lose');
  const report = local?.report().troops;
  renderMvp(mvp.best(side, report), mvp.total(side, report));
  $('rematchText').textContent = 'Rematch';
  $('rematchSub').textContent = local ? '' : 'Same opponent';
  $('rematchSub').hidden = !!local;
}

// Once the points slab has risen, the points tick up one at a time with a tick each (rising in
// pitch), the total and its rank line count with them, and a chime and a pop land on the last one.
const pointsLine = (total: number) => {
  const rk = rankOf(total);
  return rk.next ? `${total.toLocaleString('en-US')} / ${rk.nextAt!.toLocaleString('en-US')} XP to ${rk.next}` : `${total.toLocaleString('en-US')} XP`;
};
let countRaf = 0;
function countUp(before: number, after: number) {
  const delta = after - before, el = $('emberDelta'), slab = $('emberReward');
  cancelAnimationFrame(countRaf);
  slab.classList.remove('counted');
  const show = (n: number) => {
    el.textContent = `+${n}`;
    $('erNext').textContent = pointsLine(before + n);
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || delta <= 0) return void show(delta);
  show(0);
  const start = performance.now() + 1300, dur = Math.min(1400, 60 * delta + 300);
  let shown = 0;
  const step = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - start) / dur));
    const n = Math.round(delta * (1 - (1 - k) ** 2));
    if (n > shown) {
      shown = n;
      show(n);
      sfx.play('tick', undefined, 0.8 + 0.5 * (n / delta));
    }
    if (k < 1) countRaf = requestAnimationFrame(step);
    else {
      sfx.play('chime');
      void slab.offsetWidth; // restart the pop
      slab.classList.add('counted');
    }
  };
  countRaf = requestAnimationFrame(step);
}

// ---------- versus card, pause and forfeit ----------

let vsShown = false;
function renderVersus(m: MatchSource | null) {
  const t = m?.time ?? 0;
  const show = !!m && m.status === 'playing' && t < -COUNTDOWN;
  if (show && !vsShown) {
    iForfeited = false;
    round = newRound();
    // Blue on the left, red on the right, whichever you are.
    const me = myName(), them = foeName(m!);
    const [blue, red] = m!.side === 0 ? [me, them] : [them, me];
    $('vsBlue').textContent = blue;
    $('vsBlueShield').innerHTML = shieldSvg('raven', initial(blue), 92);
    $('vsBlueTag').textContent = m!.side === 0 ? 'Blue side · You' : 'Blue side';
    $('vsRed').textContent = red;
    $('vsRedShield').innerHTML = shieldSvg('sun', initial(red), 92);
    $('vsRedTag').textContent = m!.side === 1 ? 'Red side · You' : 'Red side';
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
  if (TOUCH) $('camBtn').classList.toggle('off', !input.setupState().mic);
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
  input.deployDone(nonce);
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
  if (cancelledNonces.has(nonce)) return false; // cancelled while it was being designed: never sent, nothing paid
  input.deploySent(nonce);
  dropStep(nonce, 'DB', `deploy_troop sent (${d.name}, cost ${price(d)}${spriteUrl ? ', with art' : ''})`);
  try {
    await m.deployTroop(nonce, x, y, description, d, spriteUrl);
    dropStep(nonce, 'DB', 'deploy_troop ok');
    dropDeployed(nonce, true);
    settle(nonce, 'deployed');
    round.deploys++;
    round.elixirSpent += price(d);
    const to = board.toScreen(x, y);
    if (to) burnSticks(had - price(d), price(d), to[0], to[1]);
    drops.deployed(nonce, performance.now());
    return true;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    const expected = /too expensive|not enough elixir/.test(msg);
    dropStep(nonce, 'DB', `deploy_troop refused by reducer: ${msg}`, expected ? 'info' : 'error', e);
    const m = msg.match(/(too expensive|not enough elixir): (\d+)/);
    // Short of embers but it fits the cap: back in the queue, to go out when they're there.
    if (m?.[1] === 'not enough elixir' && Number(m[2]) <= (match()?.rules.max ?? ELIXIR.max)) {
      input.deployQueued(nonce);
      enqueue({ nonce, spot: [x, y], description, d, art: Promise.resolve(spriteUrl || null), need: Number(m[2]) });
      return false;
    }
    dropDeployed(nonce, false, `deploy_troop: ${msg}`);
    settle(nonce, msg);
    call(match()?.cancelDeploy(nonce), err => diag.warn('DB', `cancel_deploy #${nonce} failed: ${err}`));
    sfx.play('buzz');
    if (m?.[1] === 'not enough elixir') {
      sfx.play('tooExpensive');
      const need = Number(m[2]), have = match()?.elixir ?? 0;
      const secs = elixirWait(need, have);
      status(`${d.name} needs ${need} embers, you have ${Math.floor(have)}`, true);
      notice(`Need ${need} embers, have ${Math.floor(have)} · ready in about ${secs} s`, { tone: 'bad', ms: 2600, key: 'elixir' });
      starve(need);
      drops.refused(nonce, `need ${need} · have ${Math.floor(have)}`, performance.now()); // no coin: that's for over MAX_COST
    } else {
      status(m ? `${d.name} would cost ${m[2]} — over the ${MAX_COST} limit` : msg, true);
      drops.refused(nonce, m ? `would cost ${m[2]}, over ${MAX_COST}` : 'refused', performance.now());
    }
    return false;
  }
}

// Seconds until `need` elixir is in hand at the current rate (double in the last 30 s, triple in
// overtime), rounded up.
function elixirWait(need: number, have: number): number {
  const m = match();
  const rate = elixirRate(m?.time ?? 0, m?.rules.perSec);
  return Math.max(1, Math.ceil((need - have) / rate));
}

// The elixir bar flashes and shivers, and a gold marker shows where it has to fill to.
let starveTimer: ReturnType<typeof setTimeout> | undefined;
function starve(need: number) {
  const row = $('elixirRow'), max = match()?.rules.max ?? ELIXIR.max;
  $('elixirNeed').style.left = `${(Math.min(max, need) / max) * 100}%`;
  row.classList.remove('starved');
  void row.offsetWidth;
  row.classList.add('starved');
  clearTimeout(starveTimer);
  starveTimer = setTimeout(() => row.classList.remove('starved'), 2500);
}

// Deploy with the art if it's already here, else deploy now and set the art when it lands.
async function deployWithArt(nonce: number, spot: [number, number], description: string, d: TroopDesign, art: Promise<string | null>) {
  const m = match();
  if (d.kind === 'spell') art = Promise.resolve(null); // a spell is drawn by the board, not fal
  attempts.get(nonce)?.waitForArt(art.then(url => url ?? ''));
  void art.then(url => {
    const why = spriteError(description);
    if (url) dropStep(nonce, 'ART', `art ready ${url.slice(0, 60)}`);
    else dropStep(nonce, 'ART', `no art: ${why ? explain(why) : 'art off (api has no FAL_KEY) or failed earlier'}`, why ? 'warn' : 'info', why || undefined);
    dropArtDone(nonce);
  });
  const need = price(d);
  if (m && need <= Math.min(MAX_COST, m.rules.max) && (queue.length > 0 || m.elixir < need)) return enqueue({ nonce, spot, description, d, art, need });
  await sendWithArt(nonce, spot, description, d, art);
}

async function sendWithArt(nonce: number, spot: [number, number], description: string, d: TroopDesign, art: Promise<string | null>) {
  const m = match();
  const ready = await Promise.race([art, Promise.resolve(undefined)]); // undefined: still drawing
  const ok = await sendDeploy(nonce, spot, description, d, ready ?? '');
  if (!ok || ready !== undefined || d.kind === 'spell') return;
  const url = await art;
  if (url && m) call(m.attachSprite(description, url), err => diag.warn('DB', `set_troop_sprite for "${description}" failed: ${err}`));
}

// ---------- the queue ----------

// A troop you can't afford yet still goes through: it waits here, in the order it was summoned,
// and goes out the moment the embers are there, one at a time. Thumbs down (or "cancel", Esc)
// takes back the first in line, then the next. Its lock is let go while it waits, so the
// opponent sees nothing coming, and it lands DEPLOY_DELAY after it goes out.
interface Queued { nonce: number; spot: [number, number]; description: string; d: TroopDesign; art: Promise<string | null>; need: number }
const queue: Queued[] = [];
let queueKey = ''; // the match the queue belongs to
let queueSending = false;

function enqueue(q: Queued) {
  const m = match();
  if (!m) return void settle(q.nonce, 'no match');
  if (cancelledNonces.has(q.nonce)) return;
  if (!queue.length) queueKey = m.key;
  const at = queue.findIndex(o => o.nonce > q.nonce);
  queue.splice(at < 0 ? queue.length : at, 0, q);
  call(m.cancelDeploy(q.nonce), err => diag.warn('DB', `cancel_deploy #${q.nonce} (queued) failed: ${err}`));
  dropStep(q.nonce, 'DB', `queued ${q.d.name}: needs ${q.need}, have ${Math.floor(m.elixir)}, ${queue.length} in line`);
  status(`${q.d.name} queued · ${q.need} embers`);
  notice(queue.length > 1 ? `${q.d.name} queued, ${queue.length} in line · thumbs down clears the first` : `${q.d.name} queued · out in about ${elixirWait(q.need, m.elixir)} s`, { ms: 2200, key: 'elixir' });
  starve(q.need);
  relabelQueue();
}

function unqueue(nonce: number) {
  const i = queue.findIndex(q => q.nonce === nonce);
  if (i < 0) return;
  queue.splice(i, 1);
  relabelQueue();
}

// What each queued drop says on the board: the first counts down, the rest give their place.
function relabelQueue() {
  const m = match();
  let have = m?.elixir ?? 0;
  queue.forEach((q, i) => {
    drops.queued(q.nonce, i === 0 ? `${q.need} embers · ${elixirWait(q.need, have)} s` : `queued · #${i + 1}`);
  });
}

// Every frame: send the first in line once it's affordable; drop the lot if the match ended.
function pumpQueue(m: MatchSource) {
  if (!queue.length) return;
  if (m.key !== queueKey || m.status !== 'playing') {
    for (const q of queue.splice(0)) {
      dropCancelled(q.nonce, 'match over');
      drops.cancelled(q.nonce);
      settle(q.nonce, 'queued at match end');
    }
    return;
  }
  if (queueSending || local?.paused) return;
  const q = queue[0];
  if (m.elixir < q.need) return relabelQueue();
  queue.shift();
  relabelQueue();
  queueSending = true;
  dropStep(q.nonce, 'DB', `queue: ${q.d.name} affordable, sending`);
  status(queue.length ? `${q.d.name} going out · ${queue.length} still queued` : `${q.d.name} going out`);
  void sendWithArt(q.nonce, q.spot, q.description, q.d, q.art).finally(() => (queueSending = false));
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
  dropBegin(nonce, by);
  call(match()?.beginDeploy(nonce, spot[0], spot[1]), msg => {
    dropStep(nonce, 'DB', `begin_deploy failed: ${msg}`, 'error');
    status(msg, true);
  });
  attempt(nonce, by);
  drops.begin(nonce, spot, performance.now());
  return nonce;
}

// An empty message cancels quietly: a quick click that picked a typing spot, not a deploy attempt,
// so it isn't logged.
const cancelledNonces = new Set<number>(); // cancelled before deploy_troop went out
function cancelAt(nonce: number, msg: string, transcript = '') {
  cancelledNonces.add(nonce);
  unqueue(nonce);
  const a = attempts.get(nonce);
  if (a) a.transcript ||= transcript;
  if (msg) settle(nonce, msg);
  else attempts.delete(nonce);
  if (transcript) dropWords(nonce, transcript);
  dropCancelled(nonce, msg);
  call(match()?.cancelDeploy(nonce), err => diag.warn('DB', `cancel_deploy #${nonce} failed: ${err}`));
  drops.cancelled(nonce);
  status(msg, !!msg);
}

// The first drop past your own half each session says what's happening, so a troop that comes
// back a spell doesn't read as the game mishearing you.
let spellHinted = false;
function spellHintOnce() {
  if (spellHinted) return;
  spellHinted = true;
  notice('Over the river, whatever you say becomes a spell', { ms: 3200, key: 'spell' });
}

async function designAt(nonce: number, spot: [number, number], description: string, how?: DeployHow) {
  status(`designing “${description}”…`);
  attempts.get(nonce)?.released(description, how?.from ?? 'typed', how?.transcript, how?.by);
  drops.heard(nonce, description, performance.now());
  dropWords(nonce, description);
  dropStep(nonce, 'STT', `final words "${description}" (${how?.from ?? 'typed'}${how?.transcript && how.transcript !== description ? `, heard "${how.transcript}"` : ''})`);
  dropStep(nonce, 'DESIGN', 'design request → /api/troop');
  // Aimed past your zone: a spell, which has no sprite to draw. Anywhere else the designer decides.
  const spellOnly = spellSpot(spot);
  if (spellOnly) spellHintOnce();
  if (!spellOnly) dropStep(nonce, 'ART', 'art request → /api/sprite');
  const art = spellOnly ? Promise.resolve(null) : requestSprite(description); // in parallel with the designer; often already started
  void art.then(url => url && drops.art(nonce, performance.now()));
  try {
    const d = await designTroop(description, spellOnly);
    attempts.get(nonce)?.gotDesign(d);
    const { design, ms, source, early } = d;
    dropDesigned(nonce, source);
    if (source === 'offline' && d.error) dropStep(nonce, 'DESIGN', `model NOT used, offline troop instead: ${explain(d.error)}`, 'warn', d.error);
    dropStep(nonce, 'DESIGN', `design response: ${design.kind === 'spell' ? `spell (${design.spell?.effect}) ` : ''}${design.name} · source ${source}${d.model ? ` (${d.model})` : ''} · cost ${price(design)} · ${ms} ms${d.apiMs !== undefined ? ` (api ${d.apiMs} ms)` : ''}${early ? ' · early' : ''}`, ms > 3000 ? 'warn' : 'info');
    const tags = [source === 'offline' && 'improvised', early && 'early'].filter(Boolean).join(', ');
    drops.designed(nonce, design.name, tags, performance.now());
    status(`${design.name} · ${ms} ms${tags ? ` (${tags})` : ''}`); // the cost waits for the landing reveal
    void deployWithArt(nonce, spot, description, design, art);
  } catch (e) {
    dropStep(nonce, 'DESIGN', `designer threw: ${(e as Error).message}`, 'error', e);
    dropFailed(nonce, 'DESIGN', (e as Error).message);
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
  canDeploy: ([x, y]) => onBoard(x, y),
  toWorld: (px, py) => board.toWorld(px, py),
  begin: beginAt,
  deploy: designAt,
  cancel: cancelAt,
  status,
  typedText: () => $<HTMLInputElement>('descInput').value,
  clearTyped: () => ($<HTMLInputElement>('descInput').value = ''),
  prefetch: words => {
    dropStep(null, 'STT', `partial "${words}"`);
    const at = input.cursorSpot();
    const spellOnly = !!at && spellSpot(at);
    prefetchDesign(words, spellOnly);
    if (!spellOnly) prefetchSprite(words);
  },
  released: (nonce, words) => {
    dropStep(nonce, 'MIC', `fire cut (released) with "${words}"`);
    drops.release(nonce, words, performance.now());
  },
  heard: (text, nonce) => {
    dropStep(nonce || null, 'STT', `utterance "${text}"`);
    logUtterance(text, nonce);
  },
  mismatch: flagMismatch,
  dictate: dictateCode,
  event: (kind, detail, nonce) => {
    inputEvent(kind, detail ?? '');
    logEvent(kind, detail, nonce);
  },
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
// The hand model is ~17 MB: fetch it while the title and menu are up, once the page itself has
// loaded, so the camera starts quickly. Touch-only devices type instead, so they skip it.
if (!TOUCH) addEventListener('load', () => setTimeout(() => void warmHandTracker().catch(e => diag.warn('HAND', `hand tracker preload failed (will retry when the camera starts): ${(e as Error).message}`)), 500), { once: true });

// Input events from the controller, in the console under their stage.
function inputEvent(kind: string, detail: string) {
  const [dev, what = ''] = kind.split(':');
  const tag = dev === 'camera' || dev === 'hand' || dev === 'pinch' ? 'HAND' : dev === 'mic' ? 'MIC' : dev === 'speech' || dev === 'stt' ? 'STT' : null;
  if (!tag) return diag.info('DEPLOY', `event ${kind}${detail ? `: ${detail}` : ''}`);
  const bad = /fail|error|blocked|unavailable/i.test(`${what} ${detail}`);
  (bad ? diag.error : diag.info)(tag, `${kind}${detail ? `: ${detail}` : ''}`);
}
if (import.meta.env.DEV && new URLSearchParams(location.search).has('lab')) void import('./lab').then(m => m.openLab(input));

$<HTMLFormElement>('describe').onsubmit = e => {
  e.preventDefault();
  const input = $<HTMLInputElement>('descInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  if (TOUCH) input.blur(); // put the keyboard away so the board shows again
  deployDescription(text);
};
if (TOUCH) {
  $<HTMLInputElement>('descInput').placeholder = 'Type a troop';
  document.body.classList.add('touch');
  input.setMouseKeys(true); // a tap is the mouse here: it aims, and fires what was said or typed
}

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (!$('practice').hidden) {
    if (e.key === 'Escape') openPractice(false);
    return;
  }
  if (local?.paused) {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') setPaused(false);
    return;
  }
  if ((e.key === 'p' || e.key === 'P') && local) return setPaused(true);
  if (e.key === 'x' || e.key === 'X') flagMismatch();
  else if (e.key === 't' || e.key === 'T') $('timings').hidden = !$('timings').hidden;
  else if (e.key === 'Escape') lock = null;
  else if (e.key === 'Enter' || e.key === '/') {
    e.preventDefault();
    $('descInput').focus();
  }
});

// pointermove, not mousemove, so a finger dragging on a phone moves the aim too.
board.canvas.addEventListener('pointermove', e => {
  if (!input.mouseKeys) return void (aim = lock = null);
  const [x, y] = board.toWorld(e.clientX, e.clientY);
  aim = onBoard(x, y) ? [x, y] : null;
});
board.canvas.addEventListener('mouseleave', () => (aim = null));
board.canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' || !input.mouseKeys) return;
  const [x, y] = board.toWorld(e.clientX, e.clientY);
  aim = onBoard(x, y) ? [x, y] : null;
});
board.canvas.addEventListener('click', () => {
  const taken = input.tookClick();
  if (TOUCH) setTimeout(() => (aim = null)); // no hover on a phone: the ring goes with the finger
  if (taken || !aim) return; // a hold-to-talk press already deployed or cancelled
  lock = aim;
  $('descInput').focus();
});

// ---------- frame ----------

// The home screen's arena has a match's towers; the red side's princesses show the frost climbing.
const HOME_TOWERS = newTowers().map(t => ({ ...t, hp: t.side === 1 && t.lane !== KING_LANE ? t.hp * (t.lane === 0 ? 0.5 : 0.1) : t.hp }));

function frame() {
  requestAnimationFrame(frame);
  renderLobby();
  renderResult();
  const m = match();
  renderVersus(m);
  renderTools(m);
  if (m) trackRound(m);
  if (m) pumpQueue(m);
  // The title screen is opaque (no need to draw the board under it). The home screen is a window
  // onto the same arena the match is played on, and the result screen shows the frozen board.
  const visible = $('title').hidden;
  if (!m || !$('lobby').hidden) {
    if (!m) $('roomInfo').textContent = '';
    const hand = input.handPoint();
    if (hand) leanMist(hand.x, hand.y);
    board.draw({ mySide: 0, units: [], towers: HOME_TOWERS, troops: new Map(), pendings: [], aim: null, lock: null, status: 'lobby', point: hand }, visible);
    recorder.update(false, false);
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
  $('elixirFill').style.width = `${(elixir / m.rules.max) * 100}%`;
  $('elixirText').textContent = String(Math.floor(elixir));
  updateKindling($('elixirRow'), elixir, m.rules.max);

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
    spells: m.spells(),
    aim: m.status === 'playing' ? aim : null,
    lock: m.status === 'playing' ? lock : null,
    input: input.view(),
    drops: m.status === 'playing' ? drops.views(performance.now()) : [],
    time: m.time,
    status: m.status,
    winner: m.winner ?? undefined,
  }, visible);
  recorder.update(m.status === 'playing', m.status === 'done');
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
