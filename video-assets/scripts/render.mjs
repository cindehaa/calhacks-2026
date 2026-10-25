#!/usr/bin/env node
// Renders the video graphics (graphics/src/*.html) frame by frame in headless Chrome. Each page draws
// itself as a function of time (graphics/src/kit.js), so every frame is exact.
//
//   node scripts/render.mjs [--only callout,stats] [--stills] [--fps 30]
//
// Overlays come out as ProRes 4444 .mov with alpha (graphics/out/*.mov, not in git: re-render them),
// full-frame cards as H.264 .mp4, and every graphic also as a PNG still (graphics/out/stills/).
// --stills skips the videos.

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'graphics/out');
const { values: args } = parseArgs({
  options: { only: { type: 'string' }, stills: { type: 'boolean', default: false }, fps: { type: 'string', default: '30' }, concurrency: { type: 'string', default: '3' } },
});
const FPS = Number(args.fps);

const q = (o) => new URLSearchParams(o).toString();
const troops = readdirSync(join(root, 'troops')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(root, 'troops', f), 'utf8')));

// name, page, query, still time (s), alpha, video. Durations come from the page itself.
const JOBS = [
  // Feature callouts, in duel order (beats 2.2 to 2.7).
  ['callout-aim', 'callout', { text: 'Aim with|your finger' }, 1.2, true],
  ['callout-imagine', 'callout', { text: 'If you can imagine it,|you can summon it' }, 1.2, true],
  ['callout-deploy', 'callout', { text: 'Open your hand,|and your imagination|comes to life' }, 1.2, true],
  ['callout-cost', 'callout', { text: 'The more powerful the troop,|the more embers it costs' }, 1.2, true],
  ['callout-live', 'callout', { text: 'Play your friends|live' }, 1.2, true],
  ['callout-start', 'callout', { text: 'Start!', dur: 1.6 }, 0.8, true],
  // Small sponsor credits under the features.
  ['credit-cartesia', 'credit', { by: 'speech by', name: 'Cartesia' }, 1.5, true],
  ['credit-claude', 'credit', { by: 'designed by', name: 'Claude' }, 1.5, true],
  ['credit-spacetimedb', 'credit', { by: 'live multiplayer on', name: 'SpacetimeDB' }, 1.5, true],
  // The stats-and-attributes highlight: animated for the knight (beat 2.5), stills for every troop.
  ...troops.map((t) => [`stats-${t.slug}`, 'stats', { troop: t.slug }, 7, true, ['knight', 'titan', 'cat'].includes(t.slug)]),
  // Duel captions, one still per line.
  ...troops.map((t) => [`caption-${t.slug}`, 'caption', { speaker: t.speaker, text: t.line }, 0, true, false]),
  ['caption-innocent-whisper', 'caption', { speaker: 'Cindy', text: '…innocent cat.' }, 0, true, false],
  // Cold-open banners, from below (beat 1.2 and 1.3): over the night sky, and alone with alpha.
  ['banner-raven', 'banner', { side: 'blue', name: 'Cindy' }, 2, false],
  ['banner-sun', 'banner', { side: 'red', name: 'Isaac' }, 2, false],
  ['banner-raven-alpha', 'banner', { side: 'blue', name: 'Cindy', alpha: 1 }, 2, true],
  ['banner-sun-alpha', 'banner', { side: 'red', name: 'Isaac', alpha: 1 }, 2, true],
  // Title card, URL reveal, end card.
  ['title', 'title', {}, 2.5, false],
  ['title-alpha', 'title', { alpha: 1 }, 2.5, true],
  ['url', 'url', {}, 3, true],
  ['endcard', 'endcard', {}, 8, false],
].map(([name, page, query, still, alpha, video = true]) => ({ name, page, query, still, alpha, video }));

// Bundle the game's banner and heraldry for the banner pages.
execFileSync(join(root, '../node_modules/.bin/esbuild'), [join(root, 'graphics/src/game-entry.ts'), '--bundle', '--format=iife', `--outfile=${join(root, 'graphics/src/game.js')}`, '--log-level=warning'], { stdio: 'inherit' });

// Pages load troops/ and broll/ over http, so serve the whole folder.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(root) || !existsSync(path)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
}).listen(0);
const base = `http://localhost:${server.address().port}/graphics/src`;

const only = args.only?.split(',').map((s) => s.trim());
const jobs = JOBS.filter((j) => !only || only.some((o) => j.name.startsWith(o)));
mkdirSync(join(out, 'stills'), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });

async function render(job) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error(`  ${job.name}: ${e.message}`));
  await page.goto(`${base}/${job.page}.html?${q(job.query)}`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.ready);
  const D = await page.evaluate(() => window.DURATION);
  const shot = (path) => page.screenshot({ path, omitBackground: job.alpha });
  const t0 = performance.now();

  if (args.stills || !job.video) {
    // Pages that animate from state (the banners) need the frames before the still too.
    for (let t = 0; t < job.still; t += 1 / FPS) await page.evaluate((x) => window.seek(x), t);
    await page.evaluate((x) => window.seek(x), job.still);
    await shot(join(out, 'stills', `${job.name}.png`));
  } else {
    const frames = mkdtempSync(join(tmpdir(), `gfx-${job.name}-`));
    const n = Math.round(D * FPS), stillFrame = Math.min(n - 1, Math.round(job.still * FPS));
    for (let i = 0; i < n; i++) {
      await page.evaluate((x) => window.seek(x), i / FPS);
      await shot(join(frames, `${String(i).padStart(5, '0')}.png`));
    }
    const input = ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(frames, '%05d.png')];
    const enc = job.alpha
      ? ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', join(out, `${job.name}.mov`)]
      : ['-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, `${job.name}.mp4`)];
    execFileSync('ffmpeg', [...input, ...enc]);
    execFileSync('cp', [join(frames, `${String(stillFrame).padStart(5, '0')}.png`), join(out, 'stills', `${job.name}.png`)]);
    rmSync(frames, { recursive: true });
  }
  await page.close();
  console.log(`ok  ${job.name} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}

const queue = [...jobs];
let failed = 0;
await Promise.all(Array.from({ length: Number(args.concurrency) }, async () => {
  for (let j; (j = queue.shift());) {
    try { await render(j); } catch (e) { failed++; console.error(`ERR ${j.name}: ${e.message}`); }
  }
}));
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
