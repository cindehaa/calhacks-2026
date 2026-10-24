// SpacetimeDB module: rooms, deploys and the authoritative combat tick.
// Combat itself lives in shared/sim.ts; this file only moves rows in and out of it.
import { ScheduleAt } from 'spacetimedb';
import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import {
  DEPLOY_DELAY,
  ELIXIR_START,
  MIN_DEPLOY_DELAY,
  TICK_HZ,
  clampToHalf,
  formation,
  onOwnHalf,
  type Side,
} from '../../shared/arena';
import { newTowers, step, type SimState, type SimTower, type SimUnit } from '../../shared/sim';
import { MAX_COST, price, sanitizeDesign, type VoiceStyle } from '../../shared/troop';

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

const spacetimedb = schema({ player, room, troop, unit, tower, pending, matchTimer });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type RoomRow = NonNullable<ReturnType<Ctx['db']['room']['code']['find']>>;

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
    time: 0,
    elixir0: ELIXIR_START,
    elixir1: ELIXIR_START,
    winner: NO_WINNER,
    tick: 0,
    lastTickAt: ctx.timestamp,
  });
  ctx.db.matchTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_MICROS), roomCode: r.code });
});

// ---------- deploys ----------

// The pinch (or the first sound) locks a spot. The deploy delay counts from here, so
// troop generation overlaps the wait instead of adding to it.
export const beginDeploy = spacetimedb.reducer(
  { nonce: t.u32(), x: t.f32(), y: t.f32() },
  (ctx, { nonce, x, y }) => {
    const { r, side } = myMatch(ctx);
    if (!onOwnHalf(side, y)) throw new SenderError('deploy on your own half');
    for (const p of ctx.db.pending.roomCode.filter(r.code)) {
      if (p.owner.equals(ctx.sender) && p.nonce === nonce) return;
    }
    const [cx, cy] = clampToHalf(side, x, y);
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
  },
  (ctx, a) => {
    const { r, side } = myMatch(ctx);
    const design = sanitizeDesign({
      name: a.name,
      health: a.health,
      damage: a.damage,
      attack_speed: a.attackSpeed,
      move_speed: a.moveSpeed,
      range: a.range,
      count: a.count,
      battle_cry: a.battleCry,
      voice_style: a.voiceStyle as VoiceStyle,
    });
    const cost = price(design);
    if (cost > MAX_COST) throw new SenderError(`too expensive: ${cost}`);
    const elixir = side === 0 ? r.elixir0 : r.elixir1;
    if (cost > elixir) throw new SenderError(`not enough elixir: ${cost}`);

    // Land where the spot was locked, DEPLOY_DELAY after the lock.
    const p = findPending(ctx, a.nonce);
    let x = a.x, y = a.y, delay = DEPLOY_DELAY;
    if (p) {
      x = p.x; y = p.y;
      const waited = Number(ctx.timestamp.microsSinceUnixEpoch - p.createdAt.microsSinceUnixEpoch) / 1e6;
      delay = Math.max(MIN_DEPLOY_DELAY, DEPLOY_DELAY - waited);
      ctx.db.pending.id.delete(p.id);
    } else if (!onOwnHalf(side, y)) {
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
    });
    for (const [dx, dy] of formation(design.count)) {
      const [ux, uy] = clampToHalf(side, x + dx, y + dy);
      ctx.db.unit.insert({
        id: 0n,
        roomCode: r.code,
        troopId: tr.id,
        side,
        x: ux,
        y: uy,
        hp: design.health,
        maxHp: design.health,
        damage: design.damage,
        attackSpeed: design.attack_speed,
        moveSpeed: design.move_speed,
        range: design.range,
        cooldown: 0,
        delay,
        attackSeq: 0,
      });
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
        id: Number(u.id), side: u.side as Side, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp, damage: u.damage,
        attackSpeed: u.attackSpeed, moveSpeed: u.moveSpeed, range: u.range, cooldown: u.cooldown, delay: u.delay,
        attackSeq: u.attackSeq,
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
  for (const id of res.deadUnitIds) ctx.db.unit.id.delete(byId.get(id)!.id);
  for (const u of state.units) {
    const row = byId.get(u.id)!;
    ctx.db.unit.id.update({
      ...row, x: u.x, y: u.y, hp: u.hp, cooldown: u.cooldown, delay: u.delay, attackSeq: u.attackSeq,
    });
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
  if (res.over) ctx.db.matchTimer.scheduledId.delete(timer.scheduledId);
});

// ---------- helpers ----------

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
