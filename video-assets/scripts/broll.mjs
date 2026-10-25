#!/usr/bin/env node
// B-roll: each troop's real game sprite (troops/<slug>.png, from troops.mjs) is placed into a frame
// of the live arena (broll/plates/arena-match.png) by an image-edit model, then animated charging
// the enemy tower by an image-to-video model. Both on fal. The clips run 5 s; cut 1–2 s from them.
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

// What each troop does on screen. The sprite is the second image, the arena the first.
const SHOTS = {
  'taylor-swift': 'She sprints across the board toward the red tower, revving the chainsaw over her head, sequins glittering, snow kicking up behind her',
  skibidi: 'The toilet charges across the board toward the red tower on its little legs, swinging both knives, lid flapping',
  titan: 'The giant stomps across the board toward the red tower, the ground cracking into ice under each step, lightning crackling from its crown',
  cat: 'The tiny cat trots calmly across the board toward the red tower and sits down, blinking innocently',
};

const LOOK = 'Keep the arena exactly as it is: the same low-poly snowy night, braziers, river, bridges, towers and camera angle. Keep the character exactly as drawn in its own chunky stylised 3D mobile-game style, but light it to match the scene (cold moonlight, warm brazier glow on one side), with a soft shadow on the ground. No text, no UI, no health bars.';
const place = () => `Place the character from the second image into the first image, standing on the near half of the board just in front of the left bridge, large and clearly visible (about a third of the frame tall), facing the red tower across the river, mid-stride. ${LOOK}`;
const move = (slug) => `${SHOTS[slug]}. The camera pushes in slowly and dramatically, cinematic slow motion, epic movie-trailer shot. The low-poly snowy arena stays the same; snow falls, the braziers flicker. Keep the character's look and art style exactly.`;

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
const plateJpg = join(root, 'broll/plates/arena-match.jpg');
if (!existsSync(plateJpg)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(root, 'broll/plates/arena-match.png'), '-q:v', '3', plateJpg]);

async function one(slug) {
  const still = join(root, 'broll', `${slug}.still.png`), clip = join(root, 'broll', `${slug}.mp4`);
  if (!args.force && existsSync(clip)) return;
  if (args.force || !existsSync(still)) {
    const r = await fal(EDIT, {
      prompt: place(),
      image_urls: [dataUri(plateJpg, 'image/jpeg'), dataUri(join(root, 'troops', `${slug}.png`), 'image/png')],
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
