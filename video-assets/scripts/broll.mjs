#!/usr/bin/env node
// B-roll: each troop's real game sprite (troops/<slug>.png, from troops.mjs) is placed into a
// ground-level frame of the real arena (broll/plates/ground-*.png, from plates.mjs) by an image-edit
// model, then animated charging straight at whoever is standing there by an image-to-video model,
// both on fal: the view of someone in the arena watching it come. The clips run 5 s; cut 1–2 s.
//
//   node --env-file=../.env scripts/broll.mjs [--only taylor-swift,skibidi] [--force]
//
// Writes broll/<slug>.still.png (the composed first frame) and broll/<slug>.mp4.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { only: { type: 'string' }, force: { type: 'boolean', default: false } } });

const EDIT = 'fal-ai/nano-banana/edit';
const VIDEO = 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';

// What each troop does on screen, and which ground it charges across: Isaac's troops come at
// someone standing on Cindy's side (red towers behind them), Cindy's at someone on Isaac's.
const SHOTS = {
  'taylor-swift': { plate: 'ground-blue', move: 'She sprints straight at the camera revving the chainsaw over her head, sequins glittering, snow kicking up behind her' },
  skibidi: { plate: 'ground-red', move: 'The toilet charges straight at the camera on its little legs, swinging both knives, lid flapping' },
  titan: { plate: 'ground-blue', move: 'The giant stomps straight at the camera, the ground cracking into ice under each step, lightning crackling from its crown' },
  cat: { plate: 'ground-red', move: 'The tiny cat trots calmly straight up to the camera and sits down right in front of it, blinking innocently' },
};

const LOOK = 'Keep the arena exactly as it is: the same low-poly snowy night, braziers, river, bridges, towers and camera angle. Keep the character exactly as drawn in its own chunky stylised 3D mobile-game style, but light it to match the scene (cold moonlight, warm brazier glow on one side), with a soft shadow on the ground. No text, no UI, no health bars.';
const place = () => `Place the character from the second image into the first image, on the board in front of the camera, mid-charge straight toward the camera, large in the foreground (about half the frame tall), seen from a low ground-level angle looking slightly up at it, the towers behind it. ${LOOK}`;
const move = (slug) => `${SHOTS[slug].move}. Low ground-level camera, as if standing in the arena as it rushes closer and fills the frame; the camera holds steady with a slight handheld sway, cinematic slow motion, epic movie-trailer shot. The low-poly snowy arena stays the same; snow falls, the braziers flicker. Keep the character's look and art style exactly.`;

const falKeys = [process.env.FAL_KEY, process.env.FAL_KEY_FALLBACK].map((k) => (k ?? '').trim()).filter(Boolean);
async function fetchOk(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} from ${url}: ${(await res.text()).slice(0, 400)}`);
  return res;
}
async function fal(model, body) {
  let last;
  for (const key of falKeys) {
    try {
      const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
      const submit = await fetchOk(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());
      const deadline = Date.now() + 15 * 60_000;
      for (;;) {
        const s = await fetchOk(submit.status_url, { headers }).then((r) => r.json());
        if (s.status === 'COMPLETED') break;
        if (Date.now() > deadline) throw new Error(`timed out on ${model}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      return await fetchOk(submit.response_url, { headers }).then((r) => r.json());
    } catch (e) {
      last = e;
      console.warn(`  ${model} failed with one key: ${e.message.slice(0, 200)}`);
    }
  }
  throw last ?? new Error('no FAL_KEY');
}

// Images go up as data URIs; the plate as a JPEG to keep the request small.
const dataUri = (path, type) => `data:${type};base64,${readFileSync(path).toString('base64')}`;
function plateJpg(name) {
  const jpg = join(root, `broll/plates/${name}.jpg`);
  if (!existsSync(jpg)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(root, `broll/plates/${name}.png`), '-q:v', '3', jpg]);
  return jpg;
}

async function one(slug) {
  const still = join(root, 'broll', `${slug}.still.png`), clip = join(root, 'broll', `${slug}.mp4`);
  if (!args.force && existsSync(clip)) return;
  if (args.force || !existsSync(still)) {
    const r = await fal(EDIT, {
      prompt: place(),
      image_urls: [dataUri(plateJpg(SHOTS[slug].plate), 'image/jpeg'), dataUri(join(root, 'troops', `${slug}.png`), 'image/png')],
      num_images: 1,
      output_format: 'png',
      aspect_ratio: '16:9',
    });
    const url = r.images?.[0]?.url;
    if (!url) throw new Error(`no image: ${JSON.stringify(r).slice(0, 300)}`);
    writeFileSync(still, Buffer.from(await fetchOk(url).then((x) => x.arrayBuffer())));
    console.log(`ok  ${slug}.still.png`);
  }
  const v = await fal(VIDEO, {
    prompt: move(slug),
    image_url: dataUri(still, 'image/png'),
    duration: '5',
    negative_prompt: 'blur, distortion, morphing, extra limbs, text, watermark, camera shake, cut',
    cfg_scale: 0.5,
  });
  const url = v.video?.url;
  if (!url) throw new Error(`no video: ${JSON.stringify(v).slice(0, 300)}`);
  writeFileSync(clip, Buffer.from(await fetchOk(url).then((x) => x.arrayBuffer())));
  console.log(`ok  ${slug}.mp4`);
}

const only = args.only?.split(',').map((s) => s.trim());
const slugs = Object.keys(SHOTS).filter((s) => !only || only.includes(s));
const results = await Promise.allSettled(slugs.map(one));
results.forEach((r, i) => r.status === 'rejected' && console.error(`ERR ${slugs[i]}: ${r.reason.message}`));
process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
