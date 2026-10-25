#!/usr/bin/env node
// Stitches the title card (story beat 3): smash cut to black, a riser climbing over the black,
// Artifice slamming in at its peak on a bright hit, a beat of silence, then the game's battle music
// coming in at full tilt, carrying on into the montage.
//
//   node scripts/titleseq.mjs [--riser 1] [--hit 1] [--music game-audio/music/battle.mp3 --from 24]
//
// Writes film/out/title-sequence.mp4.

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { riser: { type: 'string', default: '1' }, hit: { type: 'string', default: '1' },
  // The battle theme is at full strength from about 24 s in, so the drop starts it there.
  music: { type: 'string', default: 'game-audio/music/battle.mp3' }, from: { type: 'string', default: '24' } } });
const p = (f) => join(root, f);

const SLAM = 3.4; // the riser's peak, where the wordmark lands
const TITLE_HIT = 0.16; // when the wordmark lands in graphics/out/title.mp4
const DROP = SLAM + 1; // a beat of silence after the slam, then the music
const END = DROP + 4; // keep a few seconds of the drop for the cut into the montage
// The generated risers climb from quiet over their first 4.5 s, peak and cut out; that cut lands on the slam.
const RISE = { from: 1.1, to: 4.5 };

const titleAt = SLAM - TITLE_HIT;
const filter = [
  // Black, then the title card from its own start.
  `color=c=black:s=1920x1080:r=30:d=${END}[bg]`,
  `[0:v]setpts=PTS-STARTPTS+${titleAt}/TB[title]`,
  `[bg][title]overlay=eof_action=repeat:enable='gte(t,${titleAt})',format=yuv420p[v]`,
  `[1:a]atrim=start=${RISE.from}:end=${RISE.to},asetpts=PTS-STARTPTS,adelay=${Math.round((SLAM - (RISE.to - RISE.from)) * 1000)}:all=1[riser]`,
  // The hit's tail is cut short, so the beat before the drop is truly silent.
  `[2:a]afade=t=out:st=0.55:d=0.2,adelay=${Math.round(SLAM * 1000)}:all=1,volume=1.1[slam]`,
  `[3:a]adelay=${Math.round(DROP * 1000)}:all=1,volume=1.1[music]`,
  `[riser][slam][music]amix=inputs=3:normalize=0,aresample=48000,atrim=0:${END}[a]`,
].join(';');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', p('graphics/out/title.mp4'), '-i', p(`sfx/riser_${args.riser}.mp3`),
  '-i', p(`sfx/title_hit_${args.hit}.mp3`), '-ss', args.from, '-i', p(args.music), '-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-t', String(END),
  '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', p('film/out/title-sequence.mp4')]);
console.log(`ok  film/out/title-sequence.mp4 (${END} s): slam ${SLAM}, drop ${DROP}`);
