#!/usr/bin/env node
// Designs and draws every troop in the duel script through the live game's own API, so the stats
// card and the B-roll start from exactly what the game makes. The sprite API caches by the words
// said, so summoning the same line in the game later shows this same art.
//
//   node video-assets/scripts/troops.mjs [--base https://artifice-game.vercel.app] [--force]
//
// Writes troops/<slug>.json (the design, its cost, who says it) and troops/<slug>.png.
// After the real duel is recorded, overwrite the .json files with the logged designs
// (npm run logs -- --jsonl) and re-render the stats cards.

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: { base: { type: 'string', default: 'https://artifice-game.vercel.app' }, force: { type: 'boolean', default: false } },
});

// In order, as said in the duel (meta: demo video story beats).
export const DUEL = [
  ['knight', 'Cindy', 'A knight with a flaming sword'],
  ['dragon', 'Isaac', 'A dragon. Bigger.'],
  ['ice-wizard', 'Cindy', 'An ice wizard'],
  ['fire-golem', 'Isaac', 'A fire golem'],
  ['frost-dragon', 'Cindy', 'A frost dragon with three heads'],
  ['geese', 'Isaac', 'An angry flock of geese charging at you with knives'],
  ['cybertruck', 'Cindy', 'A cybertruck'],
  ['taylor-swift', 'Isaac', 'Taylor Swift with a chainsaw'],
  ['skibidi', 'Cindy', 'Skibidi Toilet with knives'],
  ['titan', 'Isaac', 'An ancient frost titan, older than the mountains, crowned in lightning, leading an army of giants across the frozen wastes'],
  ['cat', 'Cindy', 'Innocent cat'],
];

async function post(path, description) {
  const r = await fetch(`${args.base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function one([slug, speaker, line]) {
  const json = join(root, 'troops', `${slug}.json`), png = join(root, 'troops', `${slug}.png`);
  if (!args.force && existsSync(json) && existsSync(png)) return;
  const [troop, art] = await Promise.all([post('/api/troop', line), post('/api/sprite', line)]);
  // A key.png still has its magenta background on; the browser keys it in the game.
  const r = await fetch(new URL(art.url, args.base));
  if (!r.ok) throw new Error(`sprite ${r.status}`);
  writeFileSync(png, Buffer.from(await r.arrayBuffer()));
  writeFileSync(json, JSON.stringify({ slug, speaker, line, cost: troop.cost, model: troop.model, source: troop.source, keyed: !art.removed, sprite: art.url, design: troop.design }, null, 2) + '\n');
  console.log(`ok  ${slug}: ${troop.design.name}, ${troop.cost} embers${art.removed ? '' : ' (background not removed)'}`);
}

let failed = 0;
const queue = [...DUEL];
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let t; (t = queue.shift());) {
    try { await one(t); } catch (e) { failed++; console.error(`ERR ${t[0]}: ${e.message}`); }
  }
}));
process.exit(failed ? 1 : 0);
