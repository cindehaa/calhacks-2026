#!/usr/bin/env node
// Stitches the cold open (story beat 1): the drone shot fading up with the narrator's opening line
// and its subtitle, the red banner, a swoosh to Isaac, the blue banner, a swoosh to Cindy, then
// cut to the match's 3-2-1. The faces are --isaac / --cindy: a clip, or a photo that gets a slow
// push-in (a portrait photo is cropped to 16:9 from --isaacTop / --cindyTop, a fraction of its height); without them,
// labelled slates hold their place.
//
//   node scripts/coldopen.mjs [--isaac face.jpg] [--cindy face.mp4] [--isaacTop 0.08] [--cindyTop 0.2]
//
// Uses film/out/drone.mp4, graphics/out/banner-{sun,raven}.mp4, the subtitle overlay, the
// countdown clip (scripts/cuts.mjs) and the music and sound effects here. Writes film/out/cold-open.mp4.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { isaac: { type: 'string' }, cindy: { type: 'string' }, isaacTop: { type: 'string', default: '0.08' }, cindyTop: { type: 'string', default: '0.2' } } });
const p = (f) => join(root, f);

// The cuts, in order: source, where in it to start, how long on screen (at `speed`, default 1), and
// the transition into the next. A slide is the swoosh between a banner and a face.
const slate = (who) => ({ slate: who, dur: 1.3 });
const SHOTS = [
  { src: 'film/out/drone.mp4', from: 0, dur: 4.3, fadeIn: 0.8, next: ['fade', 0.4] },
  { src: 'graphics/out/banner-sun.mp4', from: 0.4, dur: 0.8, speed: 2, next: ['slideleft', 0.25] },
  args.isaac ? { src: args.isaac, top: args.isaacTop, from: 0, dur: 1.3, next: ['slideleft', 0.25] } : { ...slate('Isaac'), next: ['slideleft', 0.25] },
  { src: 'graphics/out/banner-raven.mp4', from: 0.4, dur: 0.8, speed: 2, next: ['slideleft', 0.25] },
  args.cindy ? { src: args.cindy, top: args.cindyTop, from: 0, dur: 1.3, next: ['fade', 0.12] } : { ...slate('Cindy'), next: ['fade', 0.12] },
  { src: 'film/out/clips/cindy/01-countdown.mp4', from: 0, dur: null, audio: true },
];
const countdown = SHOTS.at(-1);
if (!existsSync(p(countdown.src))) throw new Error(`no ${countdown.src}: run scripts/cuts.mjs first`);
countdown.dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p(countdown.src)], { encoding: 'utf8' }));

// Placeholder slates for the faces, drawn in the game's type on its night blue.
const slates = SHOTS.filter((s) => s.slate);
if (slates.length) {
  mkdirSync(p('film/out/slates'), { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const s of slates) {
    await page.setContent(`<link href="https://fonts.googleapis.com/css2?family=Alegreya+Sans:wght@500&family=Cinzel:wght@800&display=block" rel="stylesheet">
      <body style="margin:0;height:1080px;display:grid;place-content:center;gap:18px;text-align:center;background:radial-gradient(ellipse at 50% 45%,#171b2e,#0a0c1a)">
      <div style="font:800 120px Cinzel;letter-spacing:.06em;color:#e8ebf5">${s.slate.toUpperCase()}</div>
      <div style="font:500 36px 'Alegreya Sans';color:#8e96b3">filmed intro goes here</div></body>`);
    await page.evaluate(() => document.fonts.ready);
    s.png = p(`film/out/slates/${s.slate.toLowerCase()}.png`);
    await page.screenshot({ path: s.png });
  }
  await browser.close();
}

// Video: each shot to 1080p30, then cross-faded or slid into the next.
const inputs = [], chains = [];
const V = 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p,setsar=1';
SHOTS.forEach((s, i) => {
  if (s.slate) {
    inputs.push('-loop', '1', '-framerate', '30', '-t', String(s.dur), '-i', s.png);
    chains.push(`[${i}:v]${V}[v${i}]`);
  } else if (/\.(jpe?g|png)$/i.test(s.src)) {
    // A photo: cropped to 16:9, graded like the rest, with a slow push-in.
    inputs.push('-loop', '1', '-framerate', '30', '-t', String(s.dur), '-i', resolve(root, s.src));
    chains.push(`[${i}:v]crop='iw:min(ih,iw*9/16)':0:'ih*${s.top}',scale=2400:-2,lut3d=${p('grade/artifice-frost-fire.cube')},`
      + `zoompan=z='1+0.0018*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=30,${V}[v${i}]`);
  } else {
    const speed = s.speed ?? 1;
    inputs.push('-ss', String(s.from), '-t', String(s.dur * speed), '-i', resolve(root, s.src));
    chains.push(`[${i}:v]setpts=(PTS-STARTPTS)/${speed},${V}${s.fadeIn ? `,fade=t=in:d=${s.fadeIn}` : ''},setpts=PTS-STARTPTS[v${i}]`);
  }
});
let last = 'v0', length = SHOTS[0].dur;
const starts = [0];
for (let i = 1; i < SHOTS.length; i++) {
  const [kind, d] = SHOTS[i - 1].next;
  const offset = length - d;
  starts.push(offset);
  chains.push(`[${last}][v${i}]xfade=transition=${kind}:duration=${d}:offset=${offset.toFixed(3)}[x${i}]`);
  last = `x${i}`;
  length = offset + SHOTS[i].dur;
}

// The narrator's line and its subtitle over the drone.
const LINE_AT = 0.7;
const sub = p('graphics/out/subtitle-1-cold-open.mov');
let n = SHOTS.length;
if (existsSync(sub)) {
  inputs.push('-itsoffset', String(LINE_AT), '-i', sub);
  chains.push(`[${last}][${n}:v]overlay=eof_action=pass[vsub]`);
  last = 'vsub';
  n++;
}

// Sound: the game's battle music, the line, a flap as each banner comes in, a swoosh on each slide, and the
// match's own sound from the countdown on.
const audio = [
  { f: 'game-audio/music/battle.mp3', at: 0, gain: 0.9 }, // the game's battle theme: its quiet opening builds under the drone and plays on through the countdown, as in a match
  { f: 'narrator/1 cold open.m4a', at: LINE_AT, gain: 1.6 },
  { f: 'sfx/banner_flap.mp3', at: starts[1], gain: 0.7 },
  { f: 'sfx/swoosh_1.mp3', at: starts[2] - 0.1, gain: 0.9 },
  { f: 'sfx/banner_flap.mp3', at: starts[3], gain: 0.7 },
  { f: 'sfx/swoosh_2.mp3', at: starts[3] - 0.1, gain: 0.9 },
  { f: 'sfx/swoosh_3.mp3', at: starts[4] - 0.1, gain: 0.9 },
];
const mix = [];
audio.forEach((a, i) => {
  inputs.push('-i', p(a.f));
  const fade = a.fadeOutAt ? `,afade=t=out:st=${a.fadeOutAt.toFixed(2)}:d=0.6` : '';
  chains.push(`[${n + i}:a]aresample=48000,volume=${a.gain},adelay=${Math.round(a.at * 1000)}:all=1${fade}[a${i}]`);
  mix.push(`[a${i}]`);
});
chains.push(`[${SHOTS.length - 1}:a]aresample=48000,adelay=${Math.round(starts[5] * 1000)}:all=1[agame]`);
mix.push('[agame]');
chains.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0,atrim=0:${length.toFixed(3)}[aout]`);

execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', chains.join(';'), '-map', `[${last}]`, '-map', '[aout]',
  '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', p('film/out/cold-open.mp4')]);
console.log(`ok  film/out/cold-open.mp4 (${length.toFixed(1)} s): shots at ${starts.map((s) => s.toFixed(1)).join(', ')} s`);
