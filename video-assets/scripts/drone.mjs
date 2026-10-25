#!/usr/bin/env node
// The cold open's drone shot: the real arena in its frozen night, with no HUD and no labels, the
// camera starting high and wide behind the blue side and sweeping down toward the board while it
// swings round to face it straight on. The same orbit as the home screen (homePose in
// client/src/pov.ts), flown on a path. Rendered frame by frame on the virtual clock (clock.mjs).
//
//   node scripts/drone.mjs [--url http://localhost:5178] [--dur 7]
//
// Needs the client's dev server, like film.mjs. Writes film/out/drone.mp4.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { CLOCK } from './clock.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { url: { type: 'string', default: 'http://localhost:5178' }, dur: { type: 'string', default: '7' } } });
const FPS = 30, D = Number(args.dur);

// Orbit angle, distance and height eased from the start of the path to its end.
const FROM = { a: 0.55, d: 54, h: 50, fov: 38 }, TO = { a: 0.04, d: 27, h: 21, fov: 42 }, LOOK = 1.5;
const ease = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
function pose(t) {
  const k = ease(Math.min(1, t / D)), mix = (key) => FROM[key] + (TO[key] - FROM[key]) * k;
  const a = mix('a'), d = mix('d'), h = mix('h');
  return { x: Math.sin(a) * d, y: h, z: LOOK + Math.cos(a) * d, pitch: -Math.atan2(h, d), yaw: a, fov: mix('fov') };
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(CLOCK);
await ctx.addInitScript(() => {
  localStorage.setItem('arena.setupDone', '1');
  localStorage.setItem('arena.tutorialSeen', '1');
});
await ctx.route('**/api/**', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
await ctx.route('**/_vercel/**', (r) => r.fulfill({ status: 204 }));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error(`page: ${e.message}`));
await page.goto(`${args.url}/?film`, { waitUntil: 'load' });
const advance = (ms) => page.evaluate((x) => window.__advance(x), ms);
for (let i = 0; i < 60; i++) { await advance(33); await page.waitForTimeout(15); }
await page.keyboard.press('Space');
for (let i = 0; i < 60; i++) { await advance(33); await page.waitForTimeout(10); }
await page.waitForFunction(() => window.film);
await page.evaluate(() => window.film.start({ view: 0, names: ['Cindy', 'Isaac'], clockRate: 1, hand: false, troops: {}, events: [] }));
// Only the 3D board: every menu, the HUD and the 2D layer of labels (#board) out of shot.
await page.addStyleTag({ content: 'body * { visibility: hidden !important } #board3d { visibility: visible !important }' });

const frames = mkdtempSync(join(tmpdir(), 'drone-'));
for (let i = 0; i < D * FPS; i++) {
  await page.evaluate((p) => window.film.camera(p), pose(i / FPS));
  await advance(1000 / FPS);
  await page.screenshot({ path: join(frames, `${String(i).padStart(5, '0')}.png`) });
}
mkdirSync(join(root, 'film/out'), { recursive: true });
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(frames, '%05d.png'), '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(root, 'film/out/drone.mp4')]);
rmSync(frames, { recursive: true });
console.log(`ok  film/out/drone.mp4 (${D} s)`);
await browser.close();
