#!/usr/bin/env node
// The match's sound, to go under a film render: every sound the game played (the .cues.json that
// film.mjs writes) replayed through the game's own sound code (client/src/sfx.ts) into an offline
// audio context, so the samples, the synthesized ticks and stamps, the announcer, the gain and the
// limiter are all exactly the game's. No music: the edit has its own.
//
//   node scripts/film-audio.mjs [film/out/duel-cindy.cues.json] [--url http://localhost:5178]
//
// Needs the client's dev server, like film.mjs. Writes the .wav next to the cues.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { url: { type: 'string', default: 'http://localhost:5178' } } });
const RATE = 48000;

for (const path of positionals.length ? positionals : ['film/out/duel-cindy.cues.json', 'film/out/duel-isaac.cues.json']) {
  const cues = JSON.parse(readFileSync(path, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`${args.url}/audio/preview.html`);
  const pcm = await page.evaluate(async ([cues, rate]) => {
    const seconds = Math.max(...cues.map((c) => c.at)) + 5;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    // sfx.ts plays only into a running context; an offline one runs as it renders.
    Object.defineProperty(ctx, 'state', { get: () => 'running' });
    ctx.resume = async () => {};
    window.AudioContext = function () { return ctx; };
    const { sfx } = await import('/src/sfx.ts');
    sfx.muted = false;
    sfx.unlock();
    // Wait for the sample pack to finish decoding.
    for (let last = -1; last !== sfx.buffers.size;) {
      last = sfx.buffers.size;
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Pause the render at each cue (on a 128-frame boundary), play it, carry on.
    const q = 128 / rate, at = new Map();
    for (const c of cues) {
      const t = Math.ceil(c.at / q) * q;
      if (!at.has(t)) at.set(t, []);
      at.get(t).push(c);
    }
    for (const [t, list] of at) {
      void ctx.suspend(t).then(() => {
        for (const c of list) sfx.play(c.name, c.kind, c.pitch);
        return OfflineAudioContext.prototype.resume.call(ctx);
      });
    }
    const buf = await ctx.startRendering();
    // Interleaved float32, base64.
    const l = buf.getChannelData(0), r = buf.getChannelData(1), out = new Float32Array(l.length * 2);
    for (let i = 0; i < l.length; i++) { out[2 * i] = l[i]; out[2 * i + 1] = r[i]; }
    let s = '';
    const bytes = new Uint8Array(out.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, [cues, RATE]);
  await browser.close();
  const raw = join(tmpdir(), `film-audio-${process.pid}.f32`);
  writeFileSync(raw, Buffer.from(pcm, 'base64'));
  const wav = resolve(path.replace(/\.cues\.json$/, '.wav'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', raw, '-c:a', 'pcm_s16le', wav]);
  rmSync(raw);
  console.log(`ok  ${wav} (${cues.length} cues)`);
}
