#!/usr/bin/env node
// Ground-level plates of the real arena for the B-roll (scripts/broll.mjs): the game's film mode
// with a fixed camera standing on the board at head height, the HUD hidden. One looks from Cindy's
// side toward Isaac's towers, one from Isaac's side back toward Cindy's, so each troop can charge
// at whoever is standing there.
//
//   node scripts/plates.mjs [--url http://localhost:5178]
//
// Needs the client's dev server, like film.mjs. Writes broll/plates/ground-<side>.png.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { url: { type: 'string', default: 'http://localhost:5178' } } });

// Camera poses in the 3D scene's units (x across, y up, z toward Cindy's back line; client/src/pov.ts),
// standing a few tiles in front of your king tower and looking down the board, a touch upward. The
// game puts its mountains behind the far side, so each plate is shot from that player's screen.
const STAND = { x: 0, y: 1.1, z: 8.5, pitch: 0.06, yaw: 0, fov: 55 };
const PLATES = {
  'ground-blue': { view: 0, camera: STAND }, // Cindy's ground, facing Isaac's towers
  'ground-red': { view: 1, camera: STAND }, // Isaac's ground, facing Cindy's
};

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(() => {
  localStorage.setItem('arena.setupDone', '1');
  localStorage.setItem('arena.tutorialSeen', '1');
});
await ctx.route('**/api/**', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
await ctx.route('**/_vercel/**', (r) => r.fulfill({ status: 204 }));
for (const [name, { view, camera }] of Object.entries(PLATES)) {
  const page = await ctx.newPage();
  await page.goto(`${args.url}/?film`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.film);
  await page.evaluate(([view, camera]) => window.film.start({ view, names: ['Cindy', 'Isaac'], clockRate: 1, hand: false, troops: {}, events: [{ t: 0, camera }] }), [view, camera]);
  // Through the versus card and the countdown, then a moment of falling snow.
  await page.waitForTimeout(8000);
  await page.evaluate(() => { for (const e of document.querySelectorAll('body *')) if (e.tagName !== 'CANVAS' && !e.querySelector('canvas')) e.style.visibility = 'hidden'; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(root, 'broll/plates', `${name}.png`) });
  console.log(`ok  broll/plates/${name}.png`);
  await page.close();
}
await browser.close();
