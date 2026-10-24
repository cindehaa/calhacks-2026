// SpacetimeDB module: rooms, deploys and the authoritative combat tick.
// Combat itself lives in shared/sim.ts; this file only moves rows in and out of it.
import { ScheduleAt, type Identity } from 'spacetimedb';
import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ELIXIR_MAX, MATCH_START, ELIXIR_START, TICK_HZ, canDeploy, clampDeploy, type Side } from '../../shared/arena';
import { arrivalDelay, priceDeploy, unitSpots } from '../../shared/deploy';
import { newTowers, newUnit, step, type SimState, type SimTower, type SimUnit } from '../../shared/sim';
import { newTally, tallyStep, troopsHit, type TroopTally } from '../../shared/tally';
import type { Attack, Element, Motion, OnHit, Targets, Trait, VoiceStyle } from '../../shared/troop';

const TICK_MICROS = BigInt(Math.round(1_000_000 / TICK_HZ));
const PENDING_TTL_MICROS = 15_000_000n; // a lock nobody followed up on
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const NO_WINNER = -2; // room.winner while undecided; -1 = draw

const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    online: t.bool(),
    roomCode: t.string().index('btree'), // '' when not in a room
  }
);

const room = table(
  { name: 'room', public: true },
  {
    code: t.string().primaryKey(),
    host: t.identity(), // side 0
    guest: t.option(t.identity()), // side 1
    status: t.string(), // 'lobby' | 'playing' | 'done'
    time: t.f64(), // match seconds elapsed
    elixir0: t.f64(),
    elixir1: t.f64(),
    winner: t.i8(),
    tick: t.u32(),
    lastTickAt: t.timestamp(),
  }
);

// One row per deployed description; its units point here. Art and audio attach later.
const troop = table(
  { name: 'troop', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index('btree'),
    owner: t.identity(),
    side: t.u8(),
    description: t.string(),
    name: t.string(),
    cost: t.u8(),
    health: t.u32(),
    damage: t.u32(),
    attackSpeed: t.f32(),
    moveSpeed: t.f32(),
    range: t.u8(),
    count: t.u8(),
    battleCry: t.string(),
    voiceStyle: t.string(),
    spriteUrl: t.string(), // '' until art arrives
    // Quirks (shared/troop.ts), as strings so the lists can grow without a migration. Defaults
    // let a database from before quirks take the new columns without wiping its rows.
    attack: t.string().default('single'),
    targets: t.string().default('any'),
    onHit: t.string().default('none'),
    windup: t.bool().default(false),
    trait: t.string().default('none'),
    motion: t.string().default('other'),
    element: t.string().default('none'),
    flavor: t.string().default(''),
  }
);

const unit = table(
  { name: 'unit', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index('btree'),
    troopId: t.u64(),
    side: t.u8(),
    x: t.f32(),
    y: t.f32(),
    hp: t.f32(),
    maxHp: t.f32(),
    damage: t.f32(),
    attackSpeed: t.f32(),
    moveSpeed: t.f32(),
    range: t.f32(),
    cooldown: t.f32(),
    delay: t.f32(), // seconds until it lands
    attackSeq: t.u32(),
    // Mirrors SimUnit (shared/sim.ts): quirks, then status timers, traits and the last hit.
    // Defaulted like troop's, so adding them needs no reset.
    attack: t.string().default('single'),
    targets: t.string().default('any'),
    onHit: t.string().default('none'),
    windup: t.bool().default(false),
    trait: t.string().default('none'),
    motion: t.string().default('other'),
    element: t.string().default('none'),
    burnT: t.f32().default(0),
    burnDps: t.f32().default(0),
    slowT: t.f32().default(0),
    stunT: t.f32().default(0),
    windupT: t.f32().default(0),
    shield: t.f32().default(0),
    maxShield: t.f32().default(0),
    spawnT: t.f32().default(0),
    chargeDist: t.f32().default(0),
    lastTargetX: t.f32().default(0),
    lastTargetY: t.f32().default(0),
    chainXs: t.array(t.f32()).default([]),
    chainYs: t.array(t.f32()).default([]),
  }
);

const tower = table(
  { name: 'tower', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index('btree'),
    side: t.u8(),
    lane: t.u8(),
    x: t.f32(),
    y: t.f32(),
    hp: t.f32(),
    maxHp: t.f32(),
    cooldown: t.f32(),
    attackSeq: t.u32(),
  }
);

// A spot locked while the troop is still being described or generated. The opponent sees it.
const pending = table(
  { name: 'pending', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index('btree'),
    owner: t.identity(),
    nonce: t.u32(), // client-chosen, ties begin_deploy to deploy_troop
    side: t.u8(),
    x: t.f32(),
    y: t.f32(),
    createdAt: t.timestamp(),
  }
);

const matchTimer = table(
  { name: 'match_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    roomCode: t.string(),
  }
);

// ---------- logs ----------
// Private: clients can write them through the log_* reducers but never read them, so nobody
// downloads anyone's transcripts. Read them as the database owner: `npm run logs`, or
// `spacetime sql arena "SELECT * FROM generation"`. Client times (`at`, `*At` in ms since the
// epoch) come from that player's own clock, so compare them only within one player.

// One row per round. Online rounds are opened by start_match and closed by the tick or a leave;
// bot rounds are reported by the browser.
const matchLog = table(
  { name: 'match_log' },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string(), // '' for bot rounds
    mode: t.string(), // 'online' | 'bot:<level>'
    player0: t.identity(),
    player1: t.option(t.identity()), // none vs the bot
    startedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
    endReason: t.string(), // '' while running (or abandoned), 'over' | 'left'
    winner: t.i8(), // NO_WINNER while running, -1 draw
    towersLost0: t.u8(),
    towersLost1: t.u8(),
    cappedSecs0: t.f32(), // seconds sat at full elixir (wasted refill)
    cappedSecs1: t.f32(),
  }
);

// The round each room and each player is in, so log rows attach to it without the client knowing
// ids. A player keeps their last round after it ends, so complaints made afterwards still land on it.
const roomMatch = table({ name: 'room_match' }, { roomCode: t.string().primaryKey(), matchId: t.u64() });
const playerMatch = table({ name: 'player_match' }, { identity: t.identity().primaryKey(), matchId: t.u64() });

// One row per deploy attempt, written by the browser once it has settled (deployed, rejected or
// cancelled, and the art has arrived or failed). Joins to troop_log on (matchId, player, nonce).
const generation = table(
  { name: 'generation' },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index('btree'),
    player: t.identity(),
    loggedAt: t.timestamp(),
    nonce: t.u32(),
    input: t.string(), // 'voice' | 'typed' | 'anchor'
    lockedBy: t.string(), // 'pinch' | 'voice' | 'mouse' | 'key' | 'form'
    transcript: t.string(), // everything heard during the lock
    description: t.string(), // what went to the designer
    outcome: t.string(), // 'deployed', 'too expensive: 12', 'cancelled (dragged off)', ...
    lockedAt: t.f64(), // client ms; 0 = never happened
    releasedAt: t.f64(),
    designedAt: t.f64(),
    deployedAt: t.f64(),
    spriteAt: t.f64(),
    artLateMs: t.f64(), // art arrival minus the troop landing; negative = it was there in time
    source: t.string(), // designer backend or 'offline'
    model: t.string(),
    prompt: t.string(), // system prompt hash
    early: t.bool(), // reused a design started on the partial transcript
    apiMs: t.u32(), // designer time inside the api
    waitMs: t.u32(), // how long the player waited for the design after letting go
    error: t.string(), // why the model wasn't used, if it wasn't
    raw: t.string(), // the model's answer before clamping
    design: t.string(), // JSON, after clamping
    cost: t.u8(),
    spriteUrl: t.string(),
  }
);

// Every finished speech segment, including ones said between deploys: that's where complaints are.
const utterance = table(
  { name: 'utterance' },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index('btree'),
    player: t.identity(),
    at: t.f64(), // client ms
    text: t.string(),
    nonce: t.u32(), // the deploy it was part of; 0 = said outside a lock
  }
);

// Funnel and friction: 'setup:done', 'mic:failed', 'speech:error', 'mismatch', ...
const event = table(
  { name: 'event' },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index('btree'), // 0 = before any round
    player: t.identity(),
    at: t.f64(), // client ms
    kind: t.string(),
    detail: t.string(),
    nonce: t.u32(), // 'mismatch': the deploy being flagged
  }
);

// What each troop did in the fight. Online rows are kept by the server; bot rounds are reported.
const troopLog = table(
  { name: 'troop_log' },
  {
    id: t.u64().primaryKey().autoInc(),
    matchId: t.u64().index('btree'),
    troopId: t.u64().index('btree'), // the troop row online, bot mode's own id otherwise
    player: t.identity(),
    side: t.u8(),
    bot: t.bool(), // deployed by the bot
    nonce: t.u32(),
    description: t.string(),
    name: t.string(),
    design: t.string(), // JSON, after clamping
    cost: t.u8(),
    count: t.u8(),
    deployedAt: t.f32(), // match seconds
    landsAt: t.f32(),
    unitDamage: t.f32(),
    towerDamage: t.f32(),
    kills: t.u16(),
    towersDestroyed: t.u8(),
    alive: t.u8(),
    diedAt: t.f32(), // match seconds the last unit fell; -1 if it outlived the round
  }
);

const spacetimedb = schema({
  player, room, troop, unit, tower, pending, matchTimer,
  matchLog, roomMatch, playerMatch, generation, utterance, event, troopLog,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type RoomRow = NonNullable<ReturnType<Ctx['db']['room']['code']['find']>>;
type TroopLogRow = NonNullable<ReturnType<Ctx['db']['troopLog']['id']['find']>>;

// ---------- presence ----------

export const onConnect = spacetimedb.clientConnected(ctx => {
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) {
    ctx.db.player.identity.update({ ...existing, online: true });
  } else {
    ctx.db.player.insert({
      identity: ctx.sender,
      name: `Player ${ctx.sender.toHexString().slice(-4)}`,
      online: true,
      roomCode: '',
    });
  }
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) ctx.db.player.identity.update({ ...existing, online: false });
});

export const setName = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const me = ctx.db.player.identity.find(ctx.sender);
  const trimmed = name.trim().slice(0, 20);
  if (!me || !trimmed) throw new SenderError('bad name');
  ctx.db.player.identity.update({ ...me, name: trimmed });
});

// ---------- rooms ----------

export const createRoom = spacetimedb.reducer(ctx => {
  const me = mustPlayer(ctx);
  leave(ctx, me.roomCode);
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_LETTERS[ctx.random.integerInRange(0, CODE_LETTERS.length - 1)];
  } while (ctx.db.room.code.find(code));
  insertRoom(ctx, code);
  ctx.db.player.identity.update({ ...me, roomCode: code });
});

// Joining 'DEMO' creates it if missing, so both table laptops can just join it.
export const joinRoom = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  const me = mustPlayer(ctx);
  code = code.trim().toUpperCase();
  if (me.roomCode === code) return;
  const target = ctx.db.room.code.find(code);
  if (!target) {
    if (code !== 'DEMO') throw new SenderError('no such room');
    leave(ctx, me.roomCode);
    insertRoom(ctx, code);
  } else {
    if (target.guest) throw new SenderError('room is full');
    leave(ctx, me.roomCode);
    ctx.db.room.code.update({ ...target, guest: ctx.sender });
  }
  ctx.db.player.identity.update({ ...me, roomCode: code });
});

export const leaveRoom = spacetimedb.reducer(ctx => {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) return;
  leave(ctx, me.roomCode);
  ctx.db.player.identity.update({ ...me, roomCode: '' });
});

// Either player can start (or rematch) once both are in.
export const startMatch = spacetimedb.reducer(ctx => {
  const r = myRoom(ctx);
  if (!r.guest) throw new SenderError('waiting for opponent');
  if (r.status === 'playing') return;
  clearMatch(ctx, r.code);
  for (const tw of newTowers()) ctx.db.tower.insert({ ...tw, id: 0n, roomCode: r.code });
  ctx.db.room.code.update({
    ...r,
    status: 'playing',
    time: MATCH_START,
    elixir0: ELIXIR_START,
    elixir1: ELIXIR_START,
    winner: NO_WINNER,
    tick: 0,
    lastTickAt: ctx.timestamp,
  });
  ctx.db.matchTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_MICROS), roomCode: r.code });
  const m = openMatch(ctx, r.code, 'online', r.host, r.guest);
  setRoomMatch(ctx, r.code, m.id);
  setPlayerMatch(ctx, r.host, m.id);
  setPlayerMatch(ctx, r.guest, m.id);
});

// Give up a running online match: the other side wins on the spot.
export const forfeit = spacetimedb.reducer(ctx => {
  const r = myRoom(ctx);
  if (r.status !== 'playing') throw new SenderError('match not running');
  const winner = r.host.equals(ctx.sender) ? 1 : 0;
  for (const tm of [...ctx.db.matchTimer.iter()]) if (tm.roomCode === r.code) ctx.db.matchTimer.scheduledId.delete(tm.scheduledId);
  for (const p of [...ctx.db.pending.roomCode.filter(r.code)]) ctx.db.pending.id.delete(p.id);
  ctx.db.room.code.update({ ...r, status: 'done', winner });
  closeMatch(ctx, r.code, 'forfeit', winner, [...ctx.db.tower.roomCode.filter(r.code)]);
});

// ---------- deploys ----------

// The pinch (or the first sound) locks a spot. The deploy delay counts from here, so
// troop generation overlaps the wait instead of adding to it.
export const beginDeploy = spacetimedb.reducer(
  { nonce: t.u32(), x: t.f32(), y: t.f32() },
  (ctx, { nonce, x, y }) => {
    const { r, side } = myMatch(ctx);
    const towers = [...ctx.db.tower.roomCode.filter(r.code)];
    if (!canDeploy(side, x, y, towers)) throw new SenderError('deploy on your own half');
    for (const p of ctx.db.pending.roomCode.filter(r.code)) {
      if (p.owner.equals(ctx.sender) && p.nonce === nonce) return;
    }
    const [cx, cy] = clampDeploy(side, x, y, towers);
    ctx.db.pending.insert({ id: 0n, roomCode: r.code, owner: ctx.sender, nonce, side, x: cx, y: cy, createdAt: ctx.timestamp });
  }
);

export const cancelDeploy = spacetimedb.reducer({ nonce: t.u32() }, (ctx, { nonce }) => {
  const p = findPending(ctx, nonce);
  if (p) ctx.db.pending.id.delete(p.id);
});

// Stats come from the client (Claude runs in the api proxy), so re-clamp and re-price here.
// Errors roll the whole call back: on 'too expensive' the client should cancelDeploy.
export const deployTroop = spacetimedb.reducer(
  {
    nonce: t.u32(),
    x: t.f32(),
    y: t.f32(),
    description: t.string(),
    name: t.string(),
    health: t.u32(),
    damage: t.u32(),
    attackSpeed: t.f32(),
    moveSpeed: t.f32(),
    range: t.u8(),
    count: t.u8(),
    battleCry: t.string(),
    voiceStyle: t.string(),
    spriteUrl: t.string(),
    attack: t.string(),
    targets: t.string(),
    onHit: t.string(),
    windup: t.bool(),
    trait: t.string(),
    motion: t.string(),
    element: t.string(),
    flavor: t.string(),
  },
  (ctx, a) => {
    const { r, side } = myMatch(ctx);
    const elixir = side === 0 ? r.elixir0 : r.elixir1;
    const { design, cost, error } = priceDeploy({
      name: a.name,
      health: a.health,
      damage: a.damage,
      attack_speed: a.attackSpeed,
      move_speed: a.moveSpeed,
      range: a.range,
      count: a.count,
      battle_cry: a.battleCry,
      voice_style: a.voiceStyle as VoiceStyle,
      attack: a.attack as Attack,
      targets: a.targets as Targets,
      on_hit: a.onHit as OnHit,
      windup: a.windup,
      trait: a.trait as Trait,
      motion: a.motion as Motion,
      element: a.element as Element,
      flavor: a.flavor,
    }, elixir);
    if (error) throw new SenderError(error);

    // Land where the spot was locked, DEPLOY_DELAY after the lock.
    const p = findPending(ctx, a.nonce);
    const towers = [...ctx.db.tower.roomCode.filter(r.code)];
    let x = a.x, y = a.y, delay = arrivalDelay(0);
    if (p) {
      x = p.x; y = p.y;
      delay = arrivalDelay(Number(ctx.timestamp.microsSinceUnixEpoch - p.createdAt.microsSinceUnixEpoch) / 1e6);
      ctx.db.pending.id.delete(p.id);
    } else if (!canDeploy(side, x, y, towers)) {
      throw new SenderError('deploy on your own half');
    }

    const tr = ctx.db.troop.insert({
      id: 0n,
      roomCode: r.code,
      owner: ctx.sender,
      side,
      description: a.description.slice(0, 300),
      name: design.name,
      cost,
      health: design.health,
      damage: design.damage,
      attackSpeed: design.attack_speed,
      moveSpeed: design.move_speed,
      range: design.range,
      count: design.count,
      battleCry: design.battle_cry,
      voiceStyle: design.voice_style,
      spriteUrl: a.spriteUrl.slice(0, 2048),
      attack: design.attack,
      targets: design.targets,
      onHit: design.on_hit,
      windup: design.windup,
      trait: design.trait,
      motion: design.motion,
      element: design.element,
      flavor: design.flavor,
    });
    const mid = ctx.db.roomMatch.roomCode.find(r.code)?.matchId;
    if (mid !== undefined) {
      ctx.db.troopLog.insert({
        id: 0n, matchId: mid, troopId: tr.id, player: ctx.sender, side, bot: false, nonce: a.nonce,
        description: tr.description, name: design.name, design: JSON.stringify(design), cost, count: design.count,
        deployedAt: r.time, landsAt: r.time + delay, ...newTally(design.count),
      });
    }
    for (const [ux, uy] of unitSpots(side, x, y, design.count, towers)) {
      const { id: _id, side: _side, ...u } = newUnit(0, side, ux, uy, design, delay);
      ctx.db.unit.insert({ ...u, id: 0n, roomCode: r.code, troopId: tr.id, side });
    }
    ctx.db.room.code.update(side === 0 ? { ...r, elixir0: r.elixir0 - cost } : { ...r, elixir1: r.elixir1 - cost });
  }
);

// Art arrives after the troop is already fighting.
export const setTroopSprite = spacetimedb.reducer({ troopId: t.u64(), spriteUrl: t.string() }, (ctx, a) => {
  const tr = ctx.db.troop.id.find(a.troopId);
  if (!tr || !tr.owner.equals(ctx.sender)) throw new SenderError('not your troop');
  ctx.db.troop.id.update({ ...tr, spriteUrl: a.spriteUrl.slice(0, 2048) });
});

// ---------- the tick ----------

export const tick = spacetimedb.reducer({ onSchedule: matchTimer }, { timer: matchTimer.rowType }, (ctx, { timer }) => {
  // Clients can call scheduled reducers too; only the scheduler may tick.
  if (!ctx.sender.equals(ctx.databaseIdentity)) throw new SenderError('scheduler only');
  const r = ctx.db.room.code.find(timer.roomCode);
  if (!r || r.status !== 'playing') {
    ctx.db.matchTimer.scheduledId.delete(timer.scheduledId);
    return;
  }
  const now = ctx.timestamp.microsSinceUnixEpoch;
  // Cap dt so a stalled server doesn't teleport units.
  const dt = Math.min(0.25, Number(now - r.lastTickAt.microsSinceUnixEpoch) / 1e6);

  const unitRows = [...ctx.db.unit.roomCode.filter(r.code)];
  const towerRows = [...ctx.db.tower.roomCode.filter(r.code)];
  const state: SimState = {
    time: r.time,
    elixir: [r.elixir0, r.elixir1],
    units: unitRows.map(
      (u): SimUnit => ({
        ...u, id: Number(u.id), side: u.side as Side,
        attack: u.attack as Attack, targets: u.targets as Targets, onHit: u.onHit as OnHit, trait: u.trait as Trait,
        motion: u.motion as Motion, element: u.element as Element, chainXs: [...u.chainXs], chainYs: [...u.chainYs],
      })
    ),
    towers: towerRows.map(
      (tw): SimTower => ({
        id: Number(tw.id), side: tw.side as Side, lane: tw.lane, x: tw.x, y: tw.y, hp: tw.hp, maxHp: tw.maxHp,
        cooldown: tw.cooldown, attackSeq: tw.attackSeq,
      })
    ),
  };

  const res = step(state, dt);

  const byId = new Map(unitRows.map(u => [Number(u.id), u]));
  logTick(ctx, r.code, state, res, dt, id => byId.get(id)?.troopId);
  for (const id of res.deadUnitIds) ctx.db.unit.id.delete(byId.get(id)!.id);
  const born = new Set(res.spawned.map(b => b.unit));
  for (const u of state.units) {
    if (born.has(u)) continue;
    const row = byId.get(u.id)!;
    const { id: _id, side: _side, ...state } = u;
    ctx.db.unit.id.update({ ...row, ...state });
  }
  // Spawner minions belong to their spawner's troop; the row id comes from autoInc.
  for (const { unit, parentId } of res.spawned) {
    const parent = byId.get(parentId)!;
    const { id: _id, side: _side, ...u } = unit;
    ctx.db.unit.insert({ ...u, id: 0n, roomCode: r.code, troopId: parent.troopId, side: unit.side });
  }
  const towerById = new Map(towerRows.map(tw => [Number(tw.id), tw]));
  for (const tw of state.towers) {
    const row = towerById.get(tw.id)!;
    if (row.hp !== tw.hp || row.cooldown !== tw.cooldown || row.attackSeq !== tw.attackSeq) {
      ctx.db.tower.id.update({ ...row, hp: tw.hp, cooldown: tw.cooldown, attackSeq: tw.attackSeq });
    }
  }
  for (const p of [...ctx.db.pending.roomCode.filter(r.code)]) {
    if (now - p.createdAt.microsSinceUnixEpoch > PENDING_TTL_MICROS) ctx.db.pending.id.delete(p.id);
  }

  ctx.db.room.code.update({
    ...r,
    time: state.time,
    elixir0: state.elixir[0],
    elixir1: state.elixir[1],
    tick: r.tick + 1,
    lastTickAt: ctx.timestamp,
    status: res.over ? 'done' : 'playing',
    winner: res.over ? (res.winner ?? -1) : NO_WINNER,
  });
  // Interval timers are not deleted automatically.
  if (res.over) {
    ctx.db.matchTimer.scheduledId.delete(timer.scheduledId);
    closeMatch(ctx, r.code, 'over', res.winner ?? -1, state.towers);
  }
});

// ---------- logging (the browser's side) ----------

export const logUtterance = spacetimedb.reducer({ at: t.f64(), text: t.string(), nonce: t.u32() }, (ctx, a) => {
  const text = a.text.trim().slice(0, 500);
  if (!text) return;
  ctx.db.utterance.insert({ id: 0n, matchId: currentMatch(ctx), player: ctx.sender, at: a.at, text, nonce: a.nonce });
});

export const logEvent = spacetimedb.reducer(
  { at: t.f64(), kind: t.string(), detail: t.string(), nonce: t.u32() },
  (ctx, a) => {
    ctx.db.event.insert({
      id: 0n, matchId: currentMatch(ctx), player: ctx.sender, at: a.at,
      kind: a.kind.slice(0, 40), detail: a.detail.slice(0, 500), nonce: a.nonce,
    });
  }
);

export const logGeneration = spacetimedb.reducer(
  {
    nonce: t.u32(),
    input: t.string(),
    lockedBy: t.string(),
    transcript: t.string(),
    description: t.string(),
    outcome: t.string(),
    lockedAt: t.f64(),
    releasedAt: t.f64(),
    designedAt: t.f64(),
    deployedAt: t.f64(),
    spriteAt: t.f64(),
    artLateMs: t.f64(),
    source: t.string(),
    model: t.string(),
    prompt: t.string(),
    early: t.bool(),
    apiMs: t.u32(),
    waitMs: t.u32(),
    error: t.string(),
    raw: t.string(),
    design: t.string(),
    cost: t.u8(),
    spriteUrl: t.string(),
  },
  (ctx, a) => {
    const cut = (s: string, n = 300) => s.slice(0, n);
    ctx.db.generation.insert({
      ...a,
      id: 0n,
      matchId: currentMatch(ctx),
      player: ctx.sender,
      loggedAt: ctx.timestamp,
      input: cut(a.input, 20),
      lockedBy: cut(a.lockedBy, 20),
      transcript: cut(a.transcript, 1000),
      description: cut(a.description),
      outcome: cut(a.outcome, 200),
      source: cut(a.source, 40),
      model: cut(a.model, 80),
      prompt: cut(a.prompt, 40),
      error: cut(a.error),
      raw: cut(a.raw, 2000),
      design: cut(a.design, 1000),
      spriteUrl: cut(a.spriteUrl, 2048),
    });
  }
);

// Bot rounds run in the browser, so it reports their start, each troop and the result.
export const logBotStart = spacetimedb.reducer({ level: t.string() }, (ctx, { level }) => {
  const m = openMatch(ctx, '', `bot:${level.slice(0, 20)}`, ctx.sender, undefined);
  setPlayerMatch(ctx, ctx.sender, m.id);
});

export const logBotTroop = spacetimedb.reducer(
  {
    troopId: t.u64(),
    side: t.u8(),
    bot: t.bool(),
    nonce: t.u32(),
    description: t.string(),
    name: t.string(),
    design: t.string(),
    cost: t.u8(),
    count: t.u8(),
    deployedAt: t.f32(),
    landsAt: t.f32(),
    unitDamage: t.f32(),
    towerDamage: t.f32(),
    kills: t.u16(),
    towersDestroyed: t.u8(),
    alive: t.u8(),
    diedAt: t.f32(),
  },
  (ctx, a) => {
    const m = myBotMatch(ctx);
    if (!m) return;
    ctx.db.troopLog.insert({
      ...a, id: 0n, matchId: m.id, player: ctx.sender,
      description: a.description.slice(0, 300), name: a.name.slice(0, 40), design: a.design.slice(0, 1000),
    });
  }
);

export const logBotEnd = spacetimedb.reducer(
  { winner: t.i8(), towersLost0: t.u8(), towersLost1: t.u8(), cappedSecs0: t.f32(), cappedSecs1: t.f32(), reason: t.string() },
  (ctx, a) => {
    const m = myBotMatch(ctx);
    if (!m || m.endedAt) return;
    ctx.db.matchLog.id.update({
      ...m, endedAt: ctx.timestamp, endReason: a.reason.slice(0, 20), winner: a.winner,
      towersLost0: a.towersLost0, towersLost1: a.towersLost1, cappedSecs0: a.cappedSecs0, cappedSecs1: a.cappedSecs1,
    });
  }
);

// ---------- helpers ----------

function openMatch(ctx: Ctx, roomCode: string, mode: string, p0: Identity, p1: Identity | undefined) {
  return ctx.db.matchLog.insert({
    id: 0n, roomCode, mode, player0: p0, player1: p1, startedAt: ctx.timestamp, endedAt: undefined, endReason: '',
    winner: NO_WINNER, towersLost0: 0, towersLost1: 0, cappedSecs0: 0, cappedSecs1: 0,
  });
}

function setRoomMatch(ctx: Ctx, roomCode: string, matchId: bigint) {
  if (ctx.db.roomMatch.roomCode.find(roomCode)) ctx.db.roomMatch.roomCode.update({ roomCode, matchId });
  else ctx.db.roomMatch.insert({ roomCode, matchId });
}

function setPlayerMatch(ctx: Ctx, identity: Identity | undefined, matchId: bigint) {
  if (!identity) return;
  if (ctx.db.playerMatch.identity.find(identity)) ctx.db.playerMatch.identity.update({ identity, matchId });
  else ctx.db.playerMatch.insert({ identity, matchId });
}

const currentMatch = (ctx: Ctx) => ctx.db.playerMatch.identity.find(ctx.sender)?.matchId ?? 0n;

function myBotMatch(ctx: Ctx) {
  const m = ctx.db.matchLog.id.find(currentMatch(ctx));
  return m && m.mode.startsWith('bot:') && m.player0.equals(ctx.sender) ? m : undefined;
}

// The running round of a room, if it's still open.
function openRoomMatch(ctx: Ctx, roomCode: string) {
  const id = ctx.db.roomMatch.roomCode.find(roomCode)?.matchId;
  const m = id === undefined ? undefined : ctx.db.matchLog.id.find(id);
  return m && !m.endedAt ? m : undefined;
}

function closeMatch(ctx: Ctx, roomCode: string, reason: string, winner: number, towers: { side: number; hp: number }[]) {
  const m = openRoomMatch(ctx, roomCode);
  if (!m) return;
  const lost = (side: number) => towers.filter(tw => tw.side === side && tw.hp <= 0).length;
  ctx.db.matchLog.id.update({ ...m, endedAt: ctx.timestamp, endReason: reason, winner, towersLost0: lost(0), towersLost1: lost(1) });
}

// Per tick: what each troop did, and how long each side sat on full elixir.
function logTick(ctx: Ctx, roomCode: string, s: SimState, res: ReturnType<typeof step>, dt: number, troopOf: (unitId: number) => bigint | undefined) {
  if (s.time <= 0) return;
  const m = openRoomMatch(ctx, roomCode);
  if (!m) return;
  const capped0 = s.elixir[0] >= ELIXIR_MAX, capped1 = s.elixir[1] >= ELIXIR_MAX;
  if (capped0 || capped1) {
    ctx.db.matchLog.id.update({
      ...m, cappedSecs0: m.cappedSecs0 + (capped0 ? dt : 0), cappedSecs1: m.cappedSecs1 + (capped1 ? dt : 0),
    });
  }
  const touched = troopsHit(res, troopOf);
  if (!touched.size) return;
  const rows = new Map<bigint, TroopLogRow>();
  for (const troopId of touched) {
    for (const row of ctx.db.troopLog.troopId.filter(troopId)) if (row.matchId === m.id) rows.set(troopId, { ...row });
  }
  tallyStep<bigint>(rows as Map<bigint, TroopTally>, res, troopOf, s.time);
  for (const row of rows.values()) ctx.db.troopLog.id.update(row);
}

function insertRoom(ctx: Ctx, code: string) {
  ctx.db.room.insert({
    code,
    host: ctx.sender,
    guest: undefined,
    status: 'lobby',
    time: 0,
    elixir0: ELIXIR_START,
    elixir1: ELIXIR_START,
    winner: NO_WINNER,
    tick: 0,
    lastTickAt: ctx.timestamp,
  });
}

function mustPlayer(ctx: Ctx) {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) throw new SenderError('not connected');
  return me;
}

function myRoom(ctx: Ctx): RoomRow {
  const me = ctx.db.player.identity.find(ctx.sender);
  const r = me && me.roomCode ? ctx.db.room.code.find(me.roomCode) : undefined;
  if (!r) throw new SenderError('not in a room');
  return r;
}

function myMatch(ctx: Ctx) {
  const r = myRoom(ctx);
  if (r.status !== 'playing') throw new SenderError('match not running');
  if (r.time < 0) throw new SenderError('match starting');
  const side: Side = r.host.equals(ctx.sender) ? 0 : 1;
  return { r, side };
}

function findPending(ctx: Ctx, nonce: number) {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me || !me.roomCode) return undefined;
  for (const p of ctx.db.pending.roomCode.filter(me.roomCode)) {
    if (p.owner.equals(ctx.sender) && p.nonce === nonce) return p;
  }
  return undefined;
}

function clearMatch(ctx: Ctx, code: string) {
  for (const u of [...ctx.db.unit.roomCode.filter(code)]) ctx.db.unit.id.delete(u.id);
  for (const tw of [...ctx.db.tower.roomCode.filter(code)]) ctx.db.tower.id.delete(tw.id);
  for (const tr of [...ctx.db.troop.roomCode.filter(code)]) ctx.db.troop.id.delete(tr.id);
  for (const p of [...ctx.db.pending.roomCode.filter(code)]) ctx.db.pending.id.delete(p.id);
}

// Host leaving closes the room; guest leaving frees the seat (and ends a running match).
function leave(ctx: Ctx, code: string) {
  if (!code) return;
  const r = ctx.db.room.code.find(code);
  if (!r) return;
  if (r.status === 'playing' && (r.host.equals(ctx.sender) || r.guest?.equals(ctx.sender))) {
    closeMatch(ctx, code, 'left', NO_WINNER, [...ctx.db.tower.roomCode.filter(code)]);
  }
  if (r.host.equals(ctx.sender)) {
    clearMatch(ctx, code);
    if (r.guest) {
      const g = ctx.db.player.identity.find(r.guest);
      if (g) ctx.db.player.identity.update({ ...g, roomCode: '' });
    }
    ctx.db.room.code.delete(code);
  } else if (r.guest && r.guest.equals(ctx.sender)) {
    clearMatch(ctx, code);
    ctx.db.room.code.update({ ...r, guest: undefined, status: 'lobby', winner: NO_WINNER });
  }
}
