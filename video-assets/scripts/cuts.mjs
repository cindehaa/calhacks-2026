#!/usr/bin/env node
// Cuts a film render into one clip per story beat (film/out/clips/<view>/), each with the game's
// own sound for that stretch (film-audio.mjs) muxed in. Beats are set in seconds of action
// (film/duel.mjs); the render's FIGHT! sound marks action 0, and the slow-motion stretches in SLOW
// are allowed for, so the cuts land on the same moments in any render of the script.
//
//   node scripts/cuts.mjs [cindy|isaac ...]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPT, SLOW } from '../film/duel.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (troop) => SCRIPT.events.find((e) => e.say === troop).t;

// [name, from, to] in seconds of action. Lines in the escalation run from just before they're said
// to just before the next one.
const LINES = ['ice-wizard', 'fire-golem', 'frost-dragon', 'geese', 'cybertruck', 'taylor-swift', 'skibidi'];
const BEATS = [
  ['01-countdown', -3.6, 0.6],
  ['02-match-start', 0, 4],
  ['03-aim', 0.5, 6],
  ['04-imagine', 5.6, 8.8],
  ['05-deploy', 8.4, 10.4],
  ['06-generated', 8.6, 12.2],
  ['07-cost', 10.6, 13.6],
  ['08-reply', 14.5, 27],
  ['09-turn', 27, 33],
  ...LINES.map((l, i) => [`${10 + i}-${l}`, at(l) - 0.4, i + 1 < LINES.length ? at(LINES[i + 1]) - 0.4 : at('titan') - 0.6]),
  ['17-peak-titan', at('titan') - 0.6, 81],
  ['18-drop-cat', 82.6, 87.2],
  ['19-shock', 86.8, 94.2],
  ['20-result', 93.6, Infinity],
];

// Video seconds per second of action, from FIGHT! on.
const rate = (t) => 1 / (SLOW.find((s) => t >= s.from && t < s.to)?.speed ?? 1);
function videoAt(fight, t) {
  if (t <= 0) return fight + t;
  let v = fight;
  for (let x = 0, dx = 0.01; x < t; x += dx) v += Math.min(dx, t - x) * rate(x);
  return v;
}

for (const view of process.argv.slice(2).length ? process.argv.slice(2) : ['cindy', 'isaac']) {
  const base = join(root, 'film/out', `duel-${view}`);
  if (!existsSync(`${base}.mp4`)) { console.error(`no ${base}.mp4 yet`); continue; }
  const cues = JSON.parse(readFileSync(`${base}.cues.json`, 'utf8'));
  const fight = cues.find((c) => c.name === 'fight').at;
  const length = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${base}.mp4`], { encoding: 'utf8' }));
  const dir = join(root, 'film/out/clips', view);
  mkdirSync(dir, { recursive: true });
  for (const [name, from, to] of BEATS) {
    const a = Math.max(0, videoAt(fight, from)), b = Math.min(length, Number.isFinite(to) ? videoAt(fight, to) : length);
    const ins = ['-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', `${base}.mp4`];
    const aud = existsSync(`${base}.wav`) ? ['-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', `${base}.wav`] : [];
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...ins, ...aud, '-map', '0:v', ...(aud.length ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k'] : []),
      '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(dir, `${name}.mp4`)]);
    console.log(`ok  clips/${view}/${name}.mp4  ${a.toFixed(1)}–${b.toFixed(1)} s`);
  }
}
