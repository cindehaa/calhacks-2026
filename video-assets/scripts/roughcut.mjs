#!/usr/bin/env node
// The whole demo video as a rough cut, assembled from everything here in story order: the cold open,
// the duel's beat clips (each line from the speaker's own screen) with the callouts, the narrator,
// subtitles, sponsor notes, the stats card, captions and B-roll inserts, then the title sequence,
// the montage with the URL over it, and the end card. Music is the game's battle theme, shaped like
// the cue sheet: in under the match, out for the turn, back for the escalation, cut to silence for
// the cat. A slate stands in for anything not made yet (the montage).
//
//   node scripts/roughcut.mjs
//
// Needs the outputs of cuts.mjs, coldopen.mjs, titleseq.mjs and render.mjs. Writes film/out/roughcut.mp4.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(root, f);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p(f)], { encoding: 'utf8' }));
const clip = (view, name) => `film/out/clips/${view}/${name}.mp4`;

// ---- The timeline: shots in order, each with what goes over it (offsets from the shot's start) ----
// over: graphics (.mov overlays, or .png stills with a `len`); sound: one-shots; music: the bed
// from this shot on ({ track, from, gain } or null for silence).
const call = (name, line, sub) => [
  { gfx: `graphics/out/callout-${name}.mov`, at: 0.2 },
  { sfx: 'sfx/callout_stamp_1.mp3', at: 0.35, gain: 0.8 },
  { sfx: `narrator/${line}.m4a`, at: 0.3, gain: 1.7 },
  { gfx: `graphics/out/subtitle-${sub}.mov`, at: 0.3 },
];
const note = (name, at = 0.4) => ({ gfx: `graphics/out/credit-${name}.mov`, at });
const caption = (slug, at = 0.3) => ({ gfx: `graphics/out/stills/caption-${slug}.png`, at, len: 2.4 });
const broll = (slug) => ({ src: `broll/${slug}.mp4`, from: 1.4, len: 1.6, mute: true });

const BATTLE = 'game-audio/music/battle.mp3', OVERTIME = 'game-audio/music/overtime.mp3';
const SHOTS = [
  { src: 'film/out/cold-open.mp4', ownMusic: true },
  { src: clip('cindy', '02-match-start'), music: { track: BATTLE, from: 3, gain: 0.45 } },
  { src: clip('cindy', '03-aim'), over: call('aim', '2 aim', '2-aim') },
  { src: clip('cindy', '04-imagine'), over: [...call('imagine', '3 imagine it', '3-imagine-it'), note('cartesia')] },
  { src: clip('cindy', '05-deploy'), over: call('deploy', '4 deploy', '4-deploy') },
  { src: clip('cindy', '06-generated'), over: [{ gfx: 'graphics/out/stats-knight.mov', at: 0 }, ...call('stats', '5 troop generated', '5-troop-generated').map((o) => ({ ...o, at: o.at + 4.6 })), note('claude', 0.6)] },
  { src: clip('cindy', '07-cost'), over: call('cost', '6 cost', '6-cost') },
  { src: clip('cindy', '08-reply'), over: [...call('live', '7 play live', '7-play-live').map((o) => ({ ...o, at: o.at + 8 })), note('spacetimedb', 8.2)] },
  { src: clip('cindy', '09-turn'), music: null, over: [{ sfx: 'sfx/heartbeat.mp3', at: 1.5, gain: 1 }, { sfx: 'sfx/heartbeat.mp3', at: 3.2, gain: 1 }] },
  { src: clip('cindy', '10-ice-wizard'), music: { track: BATTLE, from: 22, gain: 0.55 }, over: [caption('ice-wizard')] },
  { src: clip('isaac', '11-fire-golem'), over: [caption('fire-golem')] },
  { src: clip('cindy', '12-frost-dragon'), over: [caption('frost-dragon')] },
  { src: clip('isaac', '13-geese'), over: [caption('geese')] },
  { src: clip('cindy', '14-cybertruck'), over: [caption('cybertruck')] },
  { src: clip('isaac', '15-taylor-swift'), over: [caption('taylor-swift')] },
  broll('taylor-swift'),
  { src: clip('cindy', '16-skibidi'), over: [caption('skibidi')] },
  broll('skibidi'),
  { src: clip('isaac', '17-peak-titan'), music: { track: OVERTIME, from: 0, gain: 0.6 }, over: [caption('titan', 0.5)] },
  broll('titan'),
  { src: clip('cindy', '18-drop-cat'), music: null, over: [caption('innocent-whisper', 0.6)] },
  broll('cat'),
  { src: clip('cindy', '19-shock') },
  { src: clip('cindy', '20-result') },
  { src: 'film/out/title-sequence.mp4', ownMusic: true },
  existsSync(p('film/out/montage.mp4'))
    ? { src: 'film/out/montage.mp4', music: { track: BATTLE, from: 28.4, gain: 0.35 }, over: [{ gfx: 'graphics/out/url.mov', atEnd: 10 }, { sfx: 'sfx/url_shimmer.mp3', atEnd: 10, gain: 0.8 }] }
    : { slate: ['Montage', 'friends playing at Cal Hacks'], len: 45, music: { track: BATTLE, from: 28.4, gain: 0.6 }, over: [{ gfx: 'graphics/out/url.mov', atEnd: 10 }] },
  { src: 'graphics/out/endcard.mp4', music: null },
];

// Placeholder slates for what isn't made yet, in the game's type on its night blue.
mkdirSync(p('film/out/slates'), { recursive: true });
const slates = SHOTS.filter((s) => s.slate);
if (slates.length) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const s of slates) {
    await page.setContent(`<link href="https://fonts.googleapis.com/css2?family=Alegreya+Sans:wght@500&family=Cinzel:wght@800&display=block" rel="stylesheet">
      <body style="margin:0;height:1080px;display:grid;place-content:center;gap:18px;text-align:center;background:radial-gradient(ellipse at 50% 45%,#171b2e,#0a0c1a)">
      <div style="font:800 110px Cinzel;letter-spacing:.06em;color:#e8ebf5">${s.slate[0].toUpperCase()}</div>
      <div style="font:500 36px 'Alegreya Sans';color:#8e96b3">${s.slate[1]}</div></body>`);
    await page.evaluate(() => document.fonts.ready);
    s.src = `film/out/slates/${s.slate[0].toLowerCase()}.png`;
    await page.screenshot({ path: p(s.src) });
  }
  await browser.close();
}

// ---- Times ----------------------------------------------------------------------------------------
let t = 0;
for (const s of SHOTS) {
  s.len ??= dur(s.src);
  s.start = t;
  t += s.len;
}
const total = t;

// ---- Video: every shot to 1080p30, joined, then the overlays on top ---------------------------------
const inputs = [], chains = [];
const V = 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p,setsar=1';
const add = (args) => (inputs.push(...args), inputs.filter((a) => a === '-i').length - 1);
SHOTS.forEach((s, i) => {
  const n = s.slate ? add(['-loop', '1', '-framerate', '30', '-t', String(s.len), '-i', p(s.src)])
    : add([...(s.from ? ['-ss', String(s.from)] : []), '-t', String(s.len), '-i', p(s.src)]);
  s.input = n;
  chains.push(`[${n}:v]setpts=PTS-STARTPTS,${V}[v${i}]`);
});
chains.push(`${SHOTS.map((_, i) => `[v${i}]`).join('')}concat=n=${SHOTS.length}:v=1:a=0[base]`);
let last = 'base', k = 0;
for (const s of SHOTS) {
  for (const o of s.over ?? []) {
    if (!o.gfx) continue;
    const at = s.start + (o.atEnd !== undefined ? s.len - o.atEnd : o.at);
    const still = o.gfx.endsWith('.png');
    const n = still ? add(['-loop', '1', '-framerate', '30', '-t', String(o.len), '-i', p(o.gfx)]) : add(['-i', p(o.gfx)]);
    const fade = still ? `,fade=t=in:d=0.15:alpha=1,fade=t=out:st=${o.len - 0.3}:d=0.3:alpha=1` : '';
    chains.push(`[${n}:v]format=rgba${fade},setpts=PTS-STARTPTS+${at.toFixed(3)}/TB[o${k}]`);
    chains.push(`[${last}][o${k}]overlay=eof_action=pass:enable='between(t,${at.toFixed(3)},${(at + (still ? o.len : 30)).toFixed(3)})'[l${k}]`);
    last = `l${k++}`;
  }
}

// ---- Sound: each shot's own sound, the one-shots, and the music bed ----------------------------------
const mix = [];
const place = (n, at, gain, extra = '') => {
  const tag = `a${mix.length}`;
  chains.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo${extra},volume=${gain},adelay=${Math.round(at * 1000)}:all=1[${tag}]`);
  mix.push(`[${tag}]`);
};
const hasAudio = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', p(f)], { encoding: 'utf8' }).trim() !== '';
for (const s of SHOTS) {
  if (!s.slate && !s.mute && hasAudio(s.src)) place(s.input, s.start, 1, `,atrim=0:${s.len.toFixed(3)}`);
  for (const o of s.over ?? []) {
    if (!o.sfx) continue;
    place(add(['-i', p(o.sfx)]), s.start + (o.atEnd !== undefined ? s.len - o.atEnd : o.at), o.gain);
  }
}
// The bed: each change of music runs until the next change (or a shot with its own music).
const changes = SHOTS.filter((s) => 'music' in s || s.ownMusic);
changes.forEach((s, i) => {
  if (!s.music) return;
  const end = (changes[i + 1]?.start ?? total);
  const n = add(['-ss', String(s.music.from), '-i', p(s.music.track)]);
  place(n, s.start, s.music.gain, `,atrim=0:${(end - s.start).toFixed(3)},afade=t=in:d=0.4,afade=t=out:st=${(end - s.start - 0.3).toFixed(3)}:d=0.3`);
});
chains.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0,alimiter=limit=0.95,atrim=0:${total.toFixed(3)}[aout]`);

execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', chains.join(';'), '-map', `[${last}]`, '-map', '[aout]',
  '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', // a review cut, kept under GitHub's 100 MB a file
   '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', p('film/out/roughcut.mp4')],
  { maxBuffer: 1 << 26 });
const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
console.log(`ok  film/out/roughcut.mp4 (${mmss(total)})`);
for (const s of SHOTS) console.log(`  ${mmss(s.start)}  ${s.slate ? `[slate] ${s.slate[0]}` : s.src}`);
