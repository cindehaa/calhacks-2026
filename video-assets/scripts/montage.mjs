#!/usr/bin/env node
// The "friends having fun" montage: cuts the phone footage from Cal Hacks into one clip, following
// the cut list in film/montage.json (source file, in, out, and a 16:9 crop that keeps faces out of
// frame). Each shot keeps its own sound, levelled to the same loudness, with a short crossfade at
// every cut so nothing clicks; music goes under it later. Video cuts are hard cuts.
//
//   node scripts/montage.mjs [--src <folder with the .mp4s>] [--list film/montage.json]
//
// Writes film/out/montage.mp4 (1920x1080, 30 fps, H.264 crf 22, AAC), and each shot on its own in
// film/out/montage/.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    src: { type: 'string', default: '/private/tmp/claude-501/-Users-cindyli-GitHub-calhacks-2026/da0d6cfa-7a13-4529-b6d4-bcb583090752/scratchpad/footage-all' },
    list: { type: 'string', default: join(root, 'film/montage.json') },
    out: { type: 'string', default: join(root, 'film/out/montage.mp4') },
  },
});

const FPS = 30;
const XFADE = 0.12; // seconds of audio crossfade, centred on each cut
const TARGET = -18; // LUFS each shot is levelled to; the limiter at the end catches the peaks
const MAX_GAIN = 15, MIN_GAIN = -8;

const { shots } = JSON.parse(readFileSync(args.list, 'utf8'));
const srcOf = (s) => join(args.src, s.src);
const rot = (s) => (s.noautorotate ? ['-noautorotate'] : []);

// Size of the picture as ffmpeg will decode it (rotation applied unless the shot says not to).
function size(s) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', srcOf(s)], { encoding: 'utf8' });
  const st = JSON.parse(out).streams[0];
  const turned = !s.noautorotate && Math.abs(st.side_data_list?.find((d) => 'rotation' in d)?.rotation ?? 0) === 90;
  return turned ? [st.height, st.width] : [st.width, st.height];
}

// The shot's crop as an ffmpeg filter: the given window, or the largest centred 16:9 one.
function crop(s) {
  const [W, H] = size(s);
  let { x, y, w } = s.crop ?? {};
  if (w === undefined) {
    w = Math.min(W, Math.floor((H * 16) / 9));
    x = (W - w) / 2;
    y = (H - (w * 9) / 16) / 2;
  }
  const h = Math.round((w * 9) / 16);
  if (x + w > W || y + h > H) throw new Error(`${s.src} @ ${s.in}: crop ${w}x${h}+${x}+${y} is outside ${W}x${H}`);
  return `crop=${w}:${h}:${Math.round(x)}:${Math.round(y)}`;
}

// Integrated loudness of the shot's sound, for levelling.
function loudness(s) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(s.in), '-to', String(s.out), '-i', srcOf(s), '-vn', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = [...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  return m ? Number(m[1]) : TARGET;
}

const inputs = [], video = [], audio = [];
shots.forEach((s, i) => {
  const frames = Math.round((s.out - s.in) * FPS), dur = frames / FPS;
  // Audio runs half a crossfade past each inner cut, so the fades overlap the cut and the total
  // length still matches the picture.
  const pre = i > 0 ? XFADE / 2 : 0, post = i < shots.length - 1 ? XFADE / 2 : 0;
  const gain = Math.max(MIN_GAIN, Math.min(MAX_GAIN, TARGET - loudness(s)));
  inputs.push(...rot(s), '-ss', (s.in - pre).toFixed(3), '-t', (pre + dur + post + 0.5).toFixed(3), '-i', srcOf(s));
  video.push(`[${i}:v]fps=${FPS},trim=start_frame=${Math.round(pre * FPS)}:end_frame=${Math.round(pre * FPS) + frames},setpts=PTS-STARTPTS,` +
    `${crop(s)},scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[v${i}]`);
  audio.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,highpass=f=70,volume=${gain.toFixed(1)}dB,` +
    `atrim=0:${(pre + dur + post).toFixed(4)},asetpts=PTS-STARTPTS[a${i}]`);
  console.log(`${String(i + 1).padStart(2)}  ${s.src}  ${s.in}–${s.out}  ${dur.toFixed(2)} s  ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB  ${s.line ?? ''}`);
});

// Chain the crossfades; fade in the first shot and out of the last; limit to -1 dBFS.
let a = '[a0]';
for (let i = 1; i < shots.length; i++) {
  audio.push(`${a}[a${i}]acrossfade=d=${XFADE}:c1=tri:c2=tri[x${i}]`);
  a = `[x${i}]`;
}
const total = shots.reduce((t, s) => t + Math.round((s.out - s.in) * FPS) / FPS, 0);
audio.push(`${a}afade=t=in:d=0.05,afade=t=out:st=${(total - 0.4).toFixed(3)}:d=0.4,alimiter=limit=0.89:level=false,atrim=0:${total.toFixed(4)}[a]`);
video.push(`${shots.map((_, i) => `[v${i}]`).join('')}concat=n=${shots.length}:v=1:a=0[v]`);

mkdirSync(dirname(args.out), { recursive: true });
execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', [...video, ...audio].join(';'), '-map', '[v]', '-map', '[a]',
  '-r', String(FPS), '-c:v', 'libx264', '-crf', '22', '-preset', 'slow', // 4K sources: kept under GitHub's 100 MB a file
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', args.out], { stdio: 'inherit' });
console.log(`ok  ${args.out}  ${total.toFixed(2)} s, ${shots.length} shots`);

// Each shot on its own too (film/out/montage/NN-<line>.mp4), cut from the montage at its hard cuts, so
// it keeps the crop and the levelling; the audio crossfades leave 0.06 s of the neighbours at each end.
const dir = join(dirname(args.out), 'montage');
mkdirSync(dir, { recursive: true });
let at = 0;
shots.forEach((s, i) => {
  const len = Math.round((s.out - s.in) * FPS) / FPS;
  const slug = (s.line || s.src).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', at.toFixed(4), '-t', len.toFixed(4), '-i', args.out,
    '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    join(dir, `${String(i + 1).padStart(2, '0')}-${slug}.mp4`)]);
  at += len;
});
console.log(`ok  ${dir}/: ${shots.length} shots`);
