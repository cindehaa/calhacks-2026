// Reads the private log tables (as the database owner, through the spacetime CLI) and lines up
// what players said with what got generated, round by round, plus the headline numbers.
//
//   npm run logs                     last 5 rounds and a summary
//   npm run logs -- --last 20
//   npm run logs -- --jsonl > out    one line per deploy attempt, with the words said after it,
//                                    any mismatch flag and how the troop fought: input for tuning
//   npm run logs -- --server maincloud --db <name>
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const SERVER = opt('server', 'local');
const DB = opt('db', 'arena');
const LAST = Number(opt('last', '5'));
const REACTION_MS = 10_000; // words said this soon after a troop lands count as a reaction to it

type Row = Record<string, unknown>;
interface Ty { [k: string]: unknown }

// The CLI's JSON is the raw SATS encoding: products as arrays, options as [tag, value].
function decode(ty: Ty, v: unknown): unknown {
  if ('Product' in ty) {
    const els = (ty.Product as { elements: { name: { some: string }; algebraic_type: Ty }[] }).elements;
    if (els.length === 1 && els[0].name.some === '__identity__') return (v as string[])[0];
    if (els.length === 1 && els[0].name.some === '__timestamp_micros_since_unix_epoch__') return (v as number[])[0] / 1000;
    return v;
  }
  if ('Sum' in ty) {
    const vars = (ty.Sum as { variants: { name: { some: string }; algebraic_type: Ty }[] }).variants;
    const [tag, inner] = v as [number, unknown];
    return vars[tag].name.some === 'none' ? null : decode(vars[tag].algebraic_type, inner);
  }
  return v;
}

const camel = (s: string) => s.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

function sql(query: string): Row[] {
  const out = execFileSync('spacetime', ['sql', '--server', SERVER, DB, query, '--format', 'json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 << 20,
  });
  const [res] = JSON.parse(out);
  const els = res.schema.elements as { name: { some: string }; algebraic_type: Ty }[];
  return (res.rows as unknown[][]).map(r => Object.fromEntries(els.map((e, i) => [camel(e.name.some), decode(e.algebraic_type, r[i])])));
}

const matches = sql('SELECT * FROM match_log').sort((a, b) => Number(a.id) - Number(b.id));
const gens = sql('SELECT * FROM generation');
const says = sql('SELECT * FROM utterance');
const events = sql('SELECT * FROM event');
const troops = sql('SELECT * FROM troop_log');

const by = <T extends Row>(rows: T[], key: string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = String(r[key]);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
};
const gensBy = by(gens, 'matchId'), saysBy = by(says, 'matchId'), eventsBy = by(events, 'matchId'), troopsBy = by(troops, 'matchId');
const short = (id: unknown) => String(id).slice(-4);
const n = (v: unknown) => Number(v ?? 0);

// A deploy attempt joined with everything that followed it.
function joined(g: Row) {
  const mid = String(g.matchId), player = g.player, nonce = n(g.nonce);
  const landAt = n(g.deployedAt) ? Math.max(n(g.lockedAt) + 2500, n(g.deployedAt) + 300) : 0;
  const reactions = landAt
    ? (saysBy.get(mid) ?? []).filter(u => u.player === player && !n(u.nonce) && n(u.at) >= landAt - 500 && n(u.at) <= landAt + REACTION_MS)
        .map(u => ({ afterMs: Math.round(n(u.at) - landAt), text: u.text }))
    : [];
  const flagged = (eventsBy.get(mid) ?? []).some(e => e.kind === 'mismatch' && e.player === player && n(e.nonce) === nonce);
  const fight = (troopsBy.get(mid) ?? []).find(t => t.player === player && n(t.nonce) === nonce && !t.bot);
  return { ...g, design: g.design ? JSON.parse(String(g.design)) : null, reactions, flagged, fight: fight ?? null };
}

if (args.includes('--jsonl')) {
  for (const g of gens) console.log(JSON.stringify(joined(g), (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
  process.exit(0);
}

// ---------- timeline of the last rounds ----------

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour12: false });

for (const m of matches.slice(-LAST)) {
  const mid = String(m.id);
  const ended = m.endedAt ? `${m.endReason}, winner ${m.winner === -1 ? 'draw' : m.winner === -2 ? '-' : `side ${m.winner}`}` : 'running or abandoned';
  console.log(`\n━━ round ${mid} · ${m.mode}${m.roomCode ? ` ${m.roomCode}` : ''} · ${time(n(m.startedAt))} · ${ended} · towers lost ${m.towersLost0}/${m.towersLost1} · full-elixir s ${n(m.cappedSecs0).toFixed(0)}/${n(m.cappedSecs1).toFixed(0)}`);
  const lines: [number, string][] = [];
  for (const g of gensBy.get(mid) ?? []) {
    const j = joined(g);
    const d = j.design as { name?: string } | null;
    const art = !j.spriteUrl ? 'no art' : n(j.artLateMs) > 0 ? `art ${Math.round(n(j.artLateMs))} ms late` : 'art on time';
    const fight = j.fight ? ` · dealt ${Math.round(n(j.fight.unitDamage))}+${Math.round(n(j.fight.towerDamage))} tower` : '';
    lines.push([n(j.releasedAt || j.lockedAt),
      `${short(j.player)} ${j.flagged ? '⚑' : '▸'} “${j.description}” → ${d?.name ?? '-'} (${j.cost}) · ${j.source}${j.early ? ' early' : ''} ${j.waitMs} ms · ${art} · ${j.outcome}${fight}`]);
  }
  for (const u of saysBy.get(mid) ?? []) if (!n(u.nonce)) lines.push([n(u.at), `${short(u.player)}   said “${u.text}”`]);
  for (const e of eventsBy.get(mid) ?? []) if (e.kind === 'mismatch') lines.push([n(e.at), `${short(e.player)}   ⚑ flagged ${e.detail}`]);
  for (const [, l] of lines.sort((a, b) => a[0] - b[0])) console.log(`  ${l}`);
}

// ---------- summary ----------

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const quant = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);
const designed = gens.filter(g => g.input !== 'anchor' && n(g.designedAt));
const deployed = gens.filter(g => g.outcome === 'deployed');
const waits = designed.map(g => n(g.waitMs));
const withArt = deployed.filter(g => g.spriteUrl);
const count = (xs: Row[], f: (r: Row) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
};
const value = troops.filter(t => n(t.cost) > 0).map(t => (n(t.unitDamage) + n(t.towerDamage)) / n(t.cost));

console.log(`\n━━ summary: ${matches.length} rounds, ${gens.length} deploy attempts, ${says.length} utterances`);
console.log(`  input           ${count(gens, g => String(g.input))}`);
console.log(`  outcomes        ${count(gens, g => String(g.outcome).replace(/: \d+$/, '').replace(/ \(.*\)$/, ''))}`);
console.log(`  cancels         ${count(gens.filter(g => String(g.outcome).startsWith('cancel')), g => String(g.outcome))}`);
console.log(`  design wait     p50 ${quant(waits, 0.5)} ms · p90 ${quant(waits, 0.9)} ms · early hits ${pct(designed.filter(g => g.early).length, designed.length)} · offline ${pct(designed.filter(g => g.source === 'offline').length, designed.length)}`);
console.log(`  art             on time ${pct(withArt.filter(g => n(g.artLateMs) <= 0).length, deployed.length)} · late ${pct(withArt.filter(g => n(g.artLateMs) > 0).length, deployed.length)} · missing ${pct(deployed.length - withArt.length, deployed.length)}`);
console.log(`  mismatch flags  ${events.filter(e => e.kind === 'mismatch').length} (${pct(events.filter(e => e.kind === 'mismatch').length, deployed.length)} of deploys)`);
console.log(`  damage/elixir   p50 ${quant(value, 0.5).toFixed(0)} · p10 ${quant(value, 0.1).toFixed(0)} · p90 ${quant(value, 0.9).toFixed(0)} over ${value.length} troops`);
console.log(`  funnel          ${count(events.filter(e => e.kind !== 'mismatch'), e => String(e.kind))}`);
