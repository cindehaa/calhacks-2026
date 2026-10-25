#!/usr/bin/env node
// Renders the scripted duel (film/duel.mjs) from the real game, frame by frame, as if it had been
// screen-recorded: the client's film mode (client/src/film.ts) plays both players, and this drives
// it on a virtual clock, so every frame is exact and every render is the same match.
//
//   ../node_modules/.bin/tsx scripts/film.mjs [--view cindy|isaac] [--url http://localhost:5178]
//        [--from 0 --to 20] [--fps 30]
//
// Needs the client's dev server (`npx vite --config client/vite.config.ts --port 5178` in the repo
// root, or the "client" launch config); no API or database. /api is answered here from troops/.
// Writes film/out/duel-<view>.mp4 and duel-<view>.cues.json: every game sound with its time in
// the video, for scripts/film-audio.mjs.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { normalise, price } from '../../shared/troop.ts';
import { CAP, SCRIPT, SLOW } from '../film/duel.mjs';
import { CLOCK } from './clock.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    view: { type: 'string', default: 'cindy' },
    url: { type: 'string', default: 'http://localhost:5178' },
    fps: { type: 'string', default: '30' },
    from: { type: 'string' }, // seconds of action: only keep frames in this range (for quick checks)
    to: { type: 'string' },
    tail: { type: 'string', default: '7' }, // seconds to keep rolling after the match ends (the result screen)
  },
});
const FPS = Number(args.fps);
const view = args.view === 'isaac' ? 1 : 0;

// ---- The troops, as the API would answer for them ----------------------------------------------
const troops = Object.fromEntries(readdirSync(join(root, 'troops')).filter((f) => f.endsWith('.json')).map((f) => {
  const t = JSON.parse(readFileSync(join(root, 'troops', f), 'utf8'));
  const design = { ...t.design };
  // Over the cap: trim health (then damage) until it prices in.
  for (const cap = CAP[t.slug]; cap && price(design) > cap;) {
    if (design.health > 1200) design.health = Math.round(design.health * 0.95);
    else design.damage = Math.round(design.damage * 0.95);
  }
  // The board only draws art from /api/sprite/<20 hex>.png (client/src/render.ts).
  const id = createHash('sha1').update(`film|${t.slug}`).digest('hex').slice(0, 20);
  return [t.slug, { line: t.line, design, sprite: `/api/sprite/${id}.png`, model: t.model }];
}));
for (const [slug, cap] of Object.entries(CAP)) console.log(`${slug}: ${price(troops[slug].design)} embers (cap ${cap}), health ${troops[slug].design.health}, damage ${troops[slug].design.damage}`);
const byLine = new Map(Object.entries(troops).map(([slug, t]) => [normalise(t.line), slug]));
const bySprite = new Map(Object.entries(troops).map(([slug, t]) => [t.sprite, slug]));

// ---- Run ------------------------------------------------------------------------------------------
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(CLOCK);
await ctx.addInitScript(([name]) => {
  localStorage.setItem('arena.name', name);
  localStorage.setItem('arena.setupDone', '1');
  localStorage.setItem('arena.tutorialSeen', '1');
  localStorage.setItem('arena.handPracticeDone', '1');
}, [SCRIPT.names[view]]);
await ctx.route('**/_vercel/**', (r) => r.fulfill({ status: 204 }));
await ctx.route('**/api/**', async (r) => {
  const url = new URL(r.request().url()), body = r.request().postDataJSON?.() ?? {};
  const json = (o) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
  if (bySprite.has(url.pathname)) return r.fulfill({ contentType: 'image/png', body: readFileSync(join(root, 'troops', `${bySprite.get(url.pathname)}.png`)) });
  const slug = byLine.get(normalise(String(body.description ?? '')));
  if (url.pathname === '/api/troop' && slug) {
    const t = troops[slug];
    return json({ design: t.design, cost: price(t.design), ms: 900, source: 'claude', model: t.model, prompt: '', raw: '', error: '' });
  }
  if (url.pathname === '/api/sprite' && slug) return json({ url: troops[slug].sprite, removed: true, cached: true, ms: 400 });
  return json({});
});

const page = await ctx.newPage();
page.on('pageerror', (e) => console.error(`page: ${e.message}`));
await page.goto(`${args.url}/?film`, { waitUntil: 'load' });
const advance = (ms) => page.evaluate((x) => window.__advance(x), ms);
// Let the page settle: fonts, the title, the board's first frames.
for (let i = 0; i < 60; i++) { await advance(33); await page.waitForTimeout(15); }
await page.keyboard.press('Space');
for (let i = 0; i < 90; i++) { await advance(33); await page.waitForTimeout(10); }
await page.waitForFunction(() => window.film);
await page.evaluate((s) => window.film.start(s), { ...SCRIPT, view, troops });

const frames = mkdtempSync(join(tmpdir(), 'film-'));
const from = args.from === undefined ? -Infinity : Number(args.from), to = args.to === undefined ? Infinity : Number(args.to);
const times = []; // the virtual clock at each kept frame, to place the sounds
const speed = (t) => SLOW.find((s) => t >= s.from && t < s.to)?.speed ?? 1;
let n = 0, endedAt = null;
for (;;) {
  const t = await page.evaluate(() => window.film.time());
  const now = await advance((1000 / FPS) * speed(t));
  if (endedAt === null && (await page.evaluate(() => window.film.status())) === 'done') endedAt = now;
  if (t > to || (endedAt !== null && now - endedAt > Number(args.tail) * 1000)) break;
  if (t < from) continue;
  // Art and designs come back over (real) network: give them a moment to land.
  await page.waitForTimeout(4);
  await page.screenshot({ path: join(frames, `${String(n++).padStart(5, '0')}.png`) });
  times.push(now);
  if (n % (FPS * 5) === 0) console.log(`  ${(n / FPS).toFixed(0)} s of video, action at ${t.toFixed(1)} s`);
}

const out = join(root, 'film/out');
mkdirSync(out, { recursive: true });
const name = `duel-${args.view}${args.from !== undefined || args.to !== undefined ? `-${args.from ?? 0}-${args.to ?? 'end'}` : ''}`;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(frames, '%05d.png'), '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, `${name}.mp4`)]);
rmSync(frames, { recursive: true });

// Each game sound at its place in the video.
const cues = (await page.evaluate(() => window.film.cues)).flatMap((c) => {
  const i = times.findIndex((x) => x >= c.t);
  return i < 0 || (i === 0 && c.t < times[0] - 50) ? [] : [{ at: +(i / FPS).toFixed(3), name: c.name, kind: c.kind, pitch: c.pitch }];
});
writeFileSync(join(out, `${name}.cues.json`), JSON.stringify(cues, null, 1) + '\n');
console.log(`ok  film/out/${name}.mp4 (${(n / FPS).toFixed(1)} s, ${cues.length} sounds)`);
await browser.close();
