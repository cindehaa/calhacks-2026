#!/usr/bin/env node
// Stitches the cold open (story beat 1): the drone shot fading up with the narrator's opening line,
// the red banner, a swoosh to Isaac, the blue banner, a swoosh to Cindy, then cut to the match's
// 3-2-1, with all its sound. By default the faces and the subtitle are left out so they can be laid
// on in the editor: the face slots are black holds at the right times, and film/out/cold-open/ has
// the pieces (each face as its own push-in clip, the banners at 2x) plus timings.json saying where
// everything goes. --subtitle and --faces bake them in instead; --isaac / --cindy take another
// clip or photo for a face. A photo gets a slow push-in, cropped to 16:9 from --isaacTop /
// --cindyTop (a fraction of its height).
//
//   node scripts/coldopen.mjs [--subtitle] [--faces] [--isaac face.jpg] [--cindy face.mp4] [--out file.mp4]
//   node scripts/coldopen.mjs --faces --subtitle --out film/out/cold-open-baked.mp4   # what the rough cut uses
//
// Uses film/out/drone.mp4, graphics/out/banner-{sun,raven}.mp4, film/faces/, the subtitle overlay,
// the countdown clip (scripts/cuts.mjs) and the music and sound effects here. Writes
// film/out/cold-open.mp4 and film/out/cold-open/.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    subtitle: { type: 'boolean', default: false }, faces: { type: 'boolean', default: false }, out: { type: 'string', default: 'film/out/cold-open.mp4' },
    isaac: { type: 'string' }, cindy: { type: 'string' }, isaacTop: { type: 'string', default: '0.08' }, cindyTop: { type: 'string', default: '0.2' },
  },
});
if (args.faces) {
  args.isaac ??= 'film/faces/isaac.jpg';
  args.cindy ??= 'film/faces/cindy.jpg';
}
const p = (f) => join(root, f);

// The cuts, in order: source, where in it to start, how long on screen (at `speed`, default 1), and
// the transition into the next. A slide is the swoosh between a banner and a face.
const hold = { black: true, dur: 1.3 }; // a face's slot, left black for the editor
const SHOTS = [
  { src: 'film/out/drone.mp4', from: 0, dur: 4.3, fadeIn: 0.8, next: ['fade', 0.4] },
  { src: 'graphics/out/banner-sun.mp4', from: 0.4, dur: 0.8, speed: 2, next: ['slideleft', 0.25] },
  args.isaac ? { src: args.isaac, top: args.isaacTop, from: 0, dur: 1.3, next: ['slideleft', 0.25] } : { ...hold, face: 'isaac', next: ['slideleft', 0.25] },
  { src: 'graphics/out/banner-raven.mp4', from: 0.4, dur: 0.8, speed: 2, next: ['slideleft', 0.25] },
  args.cindy ? { src: args.cindy, top: args.cindyTop, from: 0, dur: 1.3, next: ['fade', 0.12] } : { ...hold, face: 'cindy', next: ['fade', 0.12] },
  { src: 'film/out/clips/cindy/01-countdown.mp4', from: 0, dur: null, audio: true },
];
const countdown = SHOTS.at(-1);
if (!existsSync(p(countdown.src))) throw new Error(`no ${countdown.src}: run scripts/cuts.mjs first`);
countdown.dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p(countdown.src)], { encoding: 'utf8' }));

// A photo: cropped to 16:9, graded like the rest, with a slow push-in.
const pushIn = (top) => `crop='iw:min(ih,iw*9/16)':0:'ih*${top}',scale=2400:-2,lut3d=${p('grade/artifice-frost-fire.cube')},`
  + `zoompan=z='1+0.0018*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=30`;

// Video: each shot to 1080p30, then cross-faded or slid into the next.
const inputs = [], chains = [];
const V = 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p,setsar=1';
SHOTS.forEach((s, i) => {
  if (s.black) {
    inputs.push('-f', 'lavfi', '-t', String(s.dur), '-i', 'color=c=black:s=1920x1080:r=30');
    chains.push(`[${i}:v]${V}[v${i}]`);
  } else if (/\.(jpe?g|png)$/i.test(s.src)) {
    inputs.push('-loop', '1', '-framerate', '30', '-t', String(s.dur), '-i', resolve(root, s.src));
    chains.push(`[${i}:v]${pushIn(s.top)},${V}[v${i}]`);
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

// The narrator's line over the drone, and its subtitle if it's baked in.
const LINE_AT = 0.7;
const sub = p('graphics/out/subtitle-1-cold-open.mov');
let n = SHOTS.length;
if (args.subtitle && existsSync(sub)) {
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
  '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', p(args.out)]);
console.log(`ok  ${args.out} (${length.toFixed(1)} s): shots at ${starts.map((s) => s.toFixed(1)).join(', ')} s`);

// The pieces for the editor: each face as its own push-in with a second of handles either side, the
// banners at 2x, and where everything sits in cold-open.mp4.
const parts = p('film/out/cold-open');
mkdirSync(parts, { recursive: true });
const ENC = ['-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
for (const [who, top] of [['isaac', args.isaacTop], ['cindy', args.cindyTop]]) {
  if (!existsSync(p(`film/faces/${who}.jpg`))) continue;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', '30', '-t', '3.3', '-i', p(`film/faces/${who}.jpg`),
    '-vf', `${pushIn(top)},${V}`, ...ENC, join(parts, `face-${who}.mp4`)]);
}
for (const [house, file] of [['sun', 'banner-sun'], ['raven', 'banner-raven']]) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', p(`graphics/out/${file}.mp4`), '-vf', `setpts=PTS/2,${V}`, '-an', ...ENC, join(parts, `banner-${house}-2x.mp4`)]);
}
const at = (i) => +starts[i].toFixed(3), len = (i) => +((i + 1 < SHOTS.length ? starts[i + 1] + SHOTS[i].next[1] : length) - starts[i]).toFixed(3);
writeFileSync(join(parts, 'timings.json'), JSON.stringify({
  note: 'Seconds into cold-open.mp4. Each shot overlaps the next by its transition. The face slots are black unless --faces baked them in: face-*.mp4 are 3.3 s, the 1.3 s slot plus a second of handle either side.',
  length: +length.toFixed(3),
  shots: SHOTS.map((s, i) => ({ shot: s.face ? `face-${s.face}` : (s.src ?? '').split('/').pop(), at: at(i), length: len(i), transitionOut: s.next ?? null })),
  overlays: [{ file: 'graphics/out/subtitle-1-cold-open.mov', at: LINE_AT, baked: args.subtitle }],
  sound: { narrator: { file: 'narrator/1 cold open.m4a', at: LINE_AT }, note: 'cold-open.mp4 carries the full mix: battle music, narrator, flaps, swooshes and the countdown.' },
}, null, 2) + '\n');
console.log(`ok  film/out/cold-open/: ${['face-isaac', 'face-cindy'].filter((f) => existsSync(join(parts, `${f}.mp4`))).join(', ')}, banners at 2x, timings.json`);
