// Headless balance sim: `npm run balance -- [flags]`. Runs every troop against the anchor field
// on the real step(), with no rendering, and reports cost-efficiency. See sim/README.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ANCHORS } from '../shared/anchors';
import { MAX_COST } from '../shared/troop';
import { DEFAULT_KNOBS, PLACEMENTS, evaluate, prepare, type Knobs, type Row, type Troop } from './harness';
import { FLAG_HIGH, FLAG_LOW } from './metrics';

const HELP = `Usage: npm run balance -- [flags]

  --troops <file>      extra designs: JSON array of {name, health, damage, attack_speed, move_speed, range, count}
  --anchors <file>     replace the 10 anchors (same format), to try anchor stat tweaks
  --field anchors|all  opponents for the duels (default anchors; all = every troop priced 10 or less)
  --K <n>              pricing divisor (default ${DEFAULT_KNOBS.pricing.K})
  --ranged <n>         f_range for ranged troops (default ${DEFAULT_KNOBS.pricing.ranged})
  --rangePerTile <n>   added to f_range per tile above 1 (default ${DEFAULT_KNOBS.pricing.rangePerTile})
  --speedSlope <n>     f_speed = 1 + slope × (move_speed − 1) (default ${DEFAULT_KNOBS.pricing.speedSlope})
  --towerHealth <n>    (default ${DEFAULT_KNOBS.tower.health})
  --towerDamage <n>    per shot (default ${DEFAULT_KNOBS.tower.damage})
  --towerSpeed <n>     tower shots per second (default ${DEFAULT_KNOBS.tower.attack_speed})
  --towerRange <n>     tiles, edge to edge (default ${DEFAULT_KNOBS.tower.range})
  --budget <n>         elixir per side in elixir-matched duels (default ${DEFAULT_KNOBS.budget})
  --timeout <s>        seconds per duel (default ${DEFAULT_KNOBS.timeout})
  --out <dir>          where results.json and summary.md go (default sim/out)
  --quiet              skip the table on stdout`;

const num = { type: 'string' } as const;
const { values: args } = parseArgs({
  options: {
    troops: num, anchors: num, field: num, K: num, ranged: num, rangePerTile: num, speedSlope: num, towerHealth: num, towerDamage: num,
    towerSpeed: num, towerRange: num, budget: num, timeout: num, out: num,
    quiet: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});
if (args.help) { console.log(HELP); process.exit(0) }

function n(v: string | undefined, dflt: number, name: string): number {
  if (v === undefined) return dflt;
  const x = Number(v);
  if (!Number.isFinite(x)) { console.error(`--${name} needs a number, got "${v}"`); process.exit(1) }
  return x;
}

const D = DEFAULT_KNOBS;
const knobs: Knobs = {
  pricing: { K: n(args.K, D.pricing.K, 'K'), ranged: n(args.ranged, D.pricing.ranged, 'ranged'),
    rangePerTile: n(args.rangePerTile, D.pricing.rangePerTile, 'rangePerTile'), speedSlope: n(args.speedSlope, D.pricing.speedSlope, 'speedSlope') },
  tower: {
    health: n(args.towerHealth, D.tower.health, 'towerHealth'), damage: n(args.towerDamage, D.tower.damage, 'towerDamage'),
    attack_speed: n(args.towerSpeed, D.tower.attack_speed, 'towerSpeed'), range: n(args.towerRange, D.tower.range, 'towerRange'),
  },
  budget: n(args.budget, D.budget, 'budget'),
  timeout: n(args.timeout, D.timeout, 'timeout'),
};
const fieldAll = args.field === 'all';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = args.out ?? join(here, 'out');

// ---- troops ----

function load(file: string, anchor: boolean): Troop[] {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) { console.error(`${file}: expected a JSON array of designs`); process.exit(1) }
  return raw.map((d, i) => prepare({ ...d, name: String(d?.name ?? `troop ${i + 1}`) }, knobs.pricing, anchor));
}
const anchors = args.anchors ? load(args.anchors, true) : ANCHORS.map(a => prepare(a, knobs.pricing, true));
const extras = args.troops ? load(args.troops, false) : [];
const troops = [...anchors, ...extras];
const field = fieldAll ? troops.filter(t => !t.rejected) : anchors;

// ---- run ----

const t0 = performance.now();

const { rows, medRatio, medTower } = evaluate(troops, field, knobs);
const valid = rows.filter(r => !r.troop.rejected).sort((a, b) => b.ratio - a.ratio);
const rejected = rows.filter(r => r.troop.rejected);
const seconds = (performance.now() - t0) / 1000;

// ---- report ----

function advice(r: Row): string {
  const out: string[] = [];
  if (r.duelFlag === 'strong') out.push(`too strong for its cost in fights (plays like ~${r.fair.toFixed(1)}): raise cost or trim stats`);
  if (r.duelFlag === 'weak') out.push(`too weak for its cost in fights (plays like ~${r.fair.toFixed(1)}): lower cost or buff stats`);
  if (r.towerFlag === 'strong') out.push('high tower pressure for its cost');
  if (r.towerFlag === 'weak') out.push('little tower pressure for its cost');
  return out.join('; ');
}

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '-');
const took = (r: Row) => `${r.side.towersTaken}/${r.middle.towersTaken}`;
const alive = (r: Row) => `${Math.round(r.side.timeAlive)}/${Math.round(r.middle.timeAlive)}`;

const HEAD = ['Troop', 'Cost', 'Power', 'Win1v1', 'WinEM', 'Trade', 'Net/e', 'HP/e', 'Twr/e', 'Took', 'Alive s', '~Fair', 'Flag'];
function cells(r: Row): string[] {
  const t = r.troop;
  const mark = r.duelFlag === 'strong' ? '++' : r.duelFlag === 'weak' ? '--' : '';
  const tmark = r.towerFlag === 'strong' ? 'T+' : r.towerFlag === 'weak' ? 'T-' : '';
  return [
    (t.anchor ? '' : '* ') + t.name, String(t.cost), f(t.power, 0), pct(r.win1v1), pct(r.winMatched), f(r.ratio),
    f(r.vpe), f(r.dpe, 0), f(r.towerPE, 0), took(r), alive(r), f(r.fair, 1), [mark, tmark].filter(Boolean).join(' '),
  ];
}
function table(rs: Row[], sep: string): string[] {
  const body = rs.map(cells);
  const w = HEAD.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const line = (c: string[]) => c.map((x, i) => (i === 0 ? x.padEnd(w[i]) : x.padStart(w[i]))).join(sep);
  return [line(HEAD), w.map(x => '-'.repeat(x)).join(sep), ...body.map(line)];
}

const tw = knobs.tower;
const header = [
  `Balance sim · K ${knobs.pricing.K}, f_range ${knobs.pricing.ranged} + ${knobs.pricing.rangePerTile}/tile, speed slope ${knobs.pricing.speedSlope} · ` +
    `towers ${tw.health} hp, ${tw.damage} × ${tw.attack_speed}/s, range ${tw.range}`,
  `${troops.length} troops vs ${fieldAll ? 'every affordable troop' : `the ${anchors.length} anchors`}, ` +
    `${PLACEMENTS.length} placements per pair (2 lanes × who acts first × sideways offset), ${seconds.toFixed(1)} s`,
  '',
  'Win1v1  one copy each, deployed at once 8 tiles apart in one lane (towers inert); draws count half',
  `WinEM   same, elixir-matched: copies chosen so both sides spend about the same (up to ${knobs.budget} elixir each)`,
  'Trade   elixir-matched: enemy elixir destroyed / own elixir lost, where a troop at x% HP has lost (100−x)% of',
  '        its cost. 1.00 is an even trade. This is the efficiency the table is sorted and flagged by.',
  'Net/e   (destroyed − lost) / spent, elixir-matched: −1 = wiped for nothing, +1 = wiped them for free',
  'HP/e    enemy HP destroyed per elixir spent, elixir-matched',
  'Twr/e   enemy tower HP removed per elixir, alone from its own bridge; mean of side and middle lane',
  'Took    towers destroyed alone, side/middle lane     Alive s  seconds alive in those runs (90 = whole match)',
  `~Fair   rough cost that would make its trade ratio match the anchor median: cost × sqrt(Trade / ${f(medRatio)})`,
  `Flag    ++ / -- Trade above ${FLAG_HIGH}× or below ${FLAG_LOW}× the anchor median (${f(medRatio)}); ` +
    `T+ / T- same for Twr/e (median ${f(medTower, 0)})`,
  '* = not an anchor',
];

const notes = valid.filter(r => advice(r)).map(r => `${r.troop.name} (${r.troop.cost}): ${advice(r)}`);
const rej = rejected.map(r => `${r.troop.name}: costs ${r.troop.cost} (> ${MAX_COST}), the game would refuse it` +
  ` · 1v1 win ${pct(r.win1v1)}, Twr/e ${f(r.towerPE, 0)}`);

if (!args.quiet) {
  console.log([...header, '', ...table(valid, '  '), ''].join('\n'));
  if (notes.length) console.log(['Outliers', ...notes.map(x => `  ${x}`), ''].join('\n'));
  if (rej.length) console.log(['Rejected (priced above 10)', ...rej.map(x => `  ${x}`), ''].join('\n'));
}

mkdirSync(outDir, { recursive: true });
const json = {
  generated: new Date().toISOString(), seconds, knobs, field: fieldAll ? 'all' : 'anchors',
  placements: PLACEMENTS, medians: { trade: medRatio, towerPerElixir: medTower },
  troops: [...valid, ...rejected].map(r => ({ ...r, advice: advice(r) || null })),
};
writeFileSync(join(outDir, 'results.json'), JSON.stringify(json, null, 2));
const md = [
  '# Balance sim results', '', ...header.slice(0, 2).map(h => `${h}  `), '', '```', ...header.slice(3), '```', '',
  `| ${HEAD.join(' | ')} |`, `|${HEAD.map((_, i) => (i ? '---:' : '---')).join('|')}|`,
  ...valid.map(r => `| ${cells(r).join(' | ')} |`), '',
  ...(notes.length ? ['## Outliers', '', ...notes.map(x => `- ${x}`), ''] : []),
  ...(rej.length ? ['## Rejected', '', ...rej.map(x => `- ${x}`), ''] : []),
];
writeFileSync(join(outDir, 'summary.md'), md.join('\n'));
console.log(`Wrote ${join(outDir, 'results.json')} and summary.md`);
