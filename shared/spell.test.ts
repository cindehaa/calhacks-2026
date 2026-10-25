import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY_DELAY, KING_LANE, TICK_HZ, type Side } from './arena.js';
import { designOfflineAny, designOfflineSpell, soundsLikeSpell } from './offline_spell.js';
import { SPELL_REFS, SYSTEM_PROMPT } from './prompt.js';
import { CURSE_MULT, KNOCKBACK, SPELL_TOWER_SHARE, newMatch, newSpell, newUnit, step, type SimState, type SimUnit } from './sim.js';
import { INSTANT, SPELL_EFFECTS, priceSpell, sanitizeSpell, type SpellSpec } from './spell.js';
import { DESIGN_SCHEMA, MAX_COST, SPELL_SCHEMA, price, sanitizeDesign } from './troop.js';

const DT = 1 / TICK_HZ;
const body = { health: 1000, damage: 50, attack_speed: 1, move_speed: 1, range: 1 };
let id = 5000;
function unit(s: SimState, side: Side, x: number, y: number, d: Partial<typeof body> = {}): SimUnit {
  const u = newUnit(id++, side, x, y, { ...body, ...d }, 0);
  s.units.push(u);
  return u;
}
function cast(s: SimState, side: Side, x: number, y: number, spec: Partial<SpellSpec>, delay = 0) {
  (s.spells ??= []).push(newSpell(id++, side, x, y, sanitizeSpell(spec), delay));
}
const run = (s: SimState, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) step(s, DT); };
// A match with nothing moving: units far from towers, standing still.
function quiet(): SimState {
  const s = newMatch();
  s.time = 1;
  return s;
}

test('reference spells sit inside the clamps and under MAX_COST, and the prompt lists them', () => {
  for (const r of SPELL_REFS) {
    const { description: _d, name: _n, ...spec } = r;
    assert.deepEqual(sanitizeSpell(spec), spec, r.name);
    assert.ok(priceSpell(spec) >= 1 && priceSpell(spec) <= MAX_COST, r.name);
    assert.ok(SYSTEM_PROMPT.includes(r.description), r.name);
  }
  // Fireball-sized blast without burn is the 4-ember reference.
  assert.equal(priceSpell(sanitizeSpell({ effect: 'blast', radius: 2.5, amount: 300 })), 4);
  assert.equal(priceSpell(sanitizeSpell({ effect: 'freeze', radius: 2.5, duration: 4 })), 4);
});

test('price grows with amount, radius and duration', () => {
  const p = (s: Partial<SpellSpec>) => priceSpell(sanitizeSpell(s));
  assert.ok(p({ effect: 'blast', amount: 600 }) > p({ effect: 'blast', amount: 300 }));
  assert.ok(p({ effect: 'blast', amount: 300, radius: 4 }) > p({ effect: 'blast', amount: 300, radius: 2 }));
  assert.ok(p({ effect: 'freeze', duration: 8 }) > p({ effect: 'freeze', duration: 2 }));
  assert.ok(p({ effect: 'blast', amount: 1200, radius: 4, on_hit: 'stun' }) > MAX_COST, 'the biggest blast is refused');
});

test('sanitizeSpell clamps, fixes instant durations and keeps on_hit to attack spells', () => {
  const s = sanitizeSpell({ effect: 'nuke' as never, radius: 99, duration: 50, amount: 1e9, on_hit: 'stun' });
  assert.deepEqual(s, { effect: 'blast', radius: 4, duration: 0, amount: 1200, on_hit: 'stun' });
  assert.equal(sanitizeSpell({ effect: 'freeze', duration: 0.1, on_hit: 'burn' }).on_hit, 'none');
  assert.equal(sanitizeSpell({ effect: 'freeze', duration: 0.1 }).duration, 1);
  assert.equal(sanitizeSpell({ effect: 'rage', amount: 500 }).amount, 0, 'rage has no amount');
  for (const e of INSTANT) assert.equal(sanitizeSpell({ effect: e, duration: 5 }).duration, 0);
});

test('a spell design survives sanitizing twice and prices as a spell', () => {
  const raw = { kind: 'spell' as const, name: 'Meteor', effect: 'blast', radius: 3, duration: 0, amount: 400, on_hit: 'burn', element: 'fire', flavor: 'a flaming rock falls', wish: '' };
  const once = sanitizeDesign(raw as never);
  assert.equal(once.kind, 'spell');
  assert.deepEqual(once.spell, { effect: 'blast', radius: 3, duration: 0, amount: 400, on_hit: 'burn' });
  assert.equal(once.on_hit, 'none', 'troop quirks stay plain');
  const twice = sanitizeDesign(once);
  assert.deepEqual(twice, once);
  assert.equal(price(twice), priceSpell(once.spell!));
  assert.equal(sanitizeDesign({ name: 'x', health: 100 } as never).kind, undefined, 'a design without kind is a troop');
});

test('schemas: the union offers both, every effect is listed', () => {
  assert.equal(DESIGN_SCHEMA.anyOf.length, 2);
  assert.deepEqual([...SPELL_SCHEMA.properties.effect.enum], [...SPELL_EFFECTS]);
  for (const k of SPELL_SCHEMA.required) assert.ok(k in SPELL_SCHEMA.properties, k);
});

test('blast: hits enemies in the circle once, towers at a share, never your own', () => {
  const s = quiet();
  const near = unit(s, 1, 9, 20), far = unit(s, 1, 9, 25), friend = unit(s, 0, 3, 8);
  const princess = s.towers.find(t => t.side === 1 && t.lane === 0)!;
  cast(s, 0, 9, 20, { effect: 'blast', radius: 2, amount: 300 });
  cast(s, 0, 3, 8, { effect: 'blast', radius: 2, amount: 300 });
  cast(s, 0, princess.x, princess.y, { effect: 'blast', radius: 1, amount: 300 });
  run(s, 0.5);
  assert.equal(near.hp, 700);
  assert.equal(far.hp, 1000);
  assert.equal(friend.hp, 1000);
  assert.equal(princess.hp, princess.maxHp - 300 * SPELL_TOWER_SHARE);
  run(s, 1);
  assert.equal(near.hp, 700, 'instant: once');
  assert.equal(s.spells!.length, 0);
});

test('a spell waits out its delay, then lands', () => {
  const s = quiet();
  const e = unit(s, 1, 9, 20);
  e.moveSpeed = 0;
  cast(s, 0, 9, 20, { effect: 'blast', radius: 2, amount: 300 }, DEPLOY_DELAY);
  run(s, DEPLOY_DELAY - 0.2);
  assert.equal(e.hp, 1000);
  run(s, 0.4);
  assert.equal(e.hp, 700);
});

test('storm pulses every second for its duration', () => {
  const s = quiet();
  const e = unit(s, 1, 9, 20);
  e.moveSpeed = 0; // stand in it
  cast(s, 0, 9, 20, { effect: 'storm', radius: 3, duration: 3, amount: 100 });
  run(s, 5);
  assert.equal(e.hp, 700, 'pulses at 0, 1 and 2 s');
  assert.equal(s.spells!.length, 0);
});

test('freeze stops units and towers inside, and lets go after', () => {
  const s = quiet();
  const king = s.towers.find(t => t.side === 1 && t.lane === KING_LANE)!;
  const e = unit(s, 1, 9, 20);
  const y0 = e.y;
  cast(s, 0, 9, 20, { effect: 'freeze', radius: 2, duration: 2 });
  cast(s, 0, king.x, king.y, { effect: 'freeze', radius: 1, duration: 2 });
  run(s, 1.5);
  assert.equal(e.y, y0, 'frozen in place');
  assert.ok((king.stunT ?? 0) > 0, 'tower frozen');
  run(s, 1.5);
  assert.ok(e.y !== y0, 'walks again');
});

test('slow and rage change pace; weaken, might and curse change damage', () => {
  const pace = (effect: SpellSpec['effect'], side: Side) => {
    const s = quiet();
    const u = unit(s, side, 9, side === 1 ? 20 : 10);
    const y0 = u.y;
    cast(s, 0, 9, u.y, { effect, radius: 4, duration: 8 });
    run(s, 1);
    return Math.abs(u.y - y0);
  };
  const plain = pace('slow', 0); // a slow from your own side doesn't touch you
  assert.ok(pace('slow', 1) < plain * 0.7);
  assert.ok(pace('rage', 0) > plain * 1.2);
  assert.ok(Math.abs(pace('rage', 1) - plain) < 1e-6, 'rage only helps your own');

  const dealt = (effect: SpellSpec['effect'], on: Side) => {
    const s = quiet();
    const a = unit(s, 0, 9, 18), b = unit(s, 1, 9, 18.8);
    a.moveSpeed = b.moveSpeed = 0;
    cast(s, on, 9, 18.4, { effect, radius: 2, duration: 8 });
    run(s, 0.1);
    return [1000 - b.hp, 1000 - a.hp]; // damage side 0 dealt, damage side 1 dealt
  };
  assert.equal(dealt('weaken', 1)[0], 50 * 0.6, 'cast by side 1: side 0 deals less');
  assert.equal(dealt('might', 0)[0], 50 * 1.4);
  assert.equal(dealt('curse', 0)[0], 50 * CURSE_MULT, 'cursed side 1 takes more');
});

test('heal, shield, shockwave and vortex', () => {
  let s = quiet();
  const hurt = unit(s, 0, 9, 10);
  hurt.hp = 500;
  cast(s, 0, 9, 10, { effect: 'heal', radius: 2, duration: 2, amount: 100 });
  run(s, 3);
  assert.ok(Math.abs(hurt.hp - 700) < 1e-6);

  s = quiet();
  const ward = unit(s, 0, 9, 10);
  cast(s, 0, 9, 10, { effect: 'shield', radius: 2, amount: 250 });
  run(s, 0.1);
  assert.equal(ward.shield, 250);

  s = quiet();
  const pushed = unit(s, 1, 10, 20);
  pushed.moveSpeed = 0;
  cast(s, 0, 9, 20, { effect: 'shockwave', radius: 2, amount: 100 });
  run(s, 0.05);
  assert.ok(Math.abs(pushed.x - (10 + KNOCKBACK)) < 0.2, 'thrown out of the circle');
  assert.equal(pushed.hp, 900);

  s = quiet();
  const pulled = unit(s, 1, 11, 20);
  pulled.moveSpeed = 0;
  cast(s, 0, 9, 20, { effect: 'vortex', radius: 3, duration: 1, amount: 50 });
  run(s, 1);
  assert.ok(pulled.x < 10, 'dragged toward the centre');
  assert.equal(pulled.hp, 950);
});

test('offline spells: words pick the effect, junk fizzles, troops stay troops', () => {
  assert.equal(designOfflineSpell('a fireball').spell?.effect, 'blast');
  assert.equal(designOfflineSpell('a fireball').spell?.on_hit, 'burn');
  assert.equal(designOfflineSpell('freeze them').spell?.effect, 'freeze');
  assert.equal(designOfflineSpell('a tornado').spell?.effect, 'vortex');
  assert.equal(designOfflineSpell('heal my army').spell?.effect, 'heal');
  assert.equal(designOfflineSpell('poison cloud').spell?.effect, 'storm');
  assert.equal(designOfflineSpell('asdf').name, 'Fizzle');
  assert.equal(designOfflineSpell('a dragon').kind, 'spell', 'a creature aimed over the river still casts');
  assert.ok(soundsLikeSpell('a fireball') && !soundsLikeSpell('a fire wizard'));
  assert.equal(designOfflineAny('a fire wizard').kind, undefined);
  assert.equal(designOfflineAny('a fire wizard', true).kind, 'spell');
  for (const d of ['a fireball', 'a meteor', 'a blizzard', 'rage', 'earthquake', 'curse', 'a dragon', 'asdf']) {
    const sp = designOfflineAny(d, true);
    assert.ok(price(sp) >= 1 && price(sp) <= MAX_COST, d);
    assert.deepEqual(designOfflineAny(d, true), sp, 'deterministic');
  }
});
