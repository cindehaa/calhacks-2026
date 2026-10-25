#!/usr/bin/env node
// Generates the demo video's music cues and sound effects (fal: ElevenLabs music and sound
// effects), in the game's warmth-and-frost style (meta/aesthetics.md). Same models and keys as the
// game's own pack (tools/audio/generate.mjs). The narrator is recorded by us (narrator/).
//
//   node --env-file=.env video-assets/scripts/audio.mjs [--only music/hype,sfx/meow] [--force]
//
// Re-running skips files that already exist; --force with --only re-rolls them. Writes
// video-assets/audio.json listing every file with its prompt.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: { only: { type: 'string' }, force: { type: 'boolean', default: false }, concurrency: { type: 'string', default: '4' } },
});

// ---- Music -----------------------------------------------------------------
// Every game track sits on a fireplace crackle; the video's cues keep it where it doesn't muddy.
const FIRE = 'crackling fireplace texture underneath';
const MUSIC = {
  cold_open: {
    prompt: `ominous epic sports-broadcast pre-game intro on a frozen night, slow deep taiko hits, low brass swell, icy shimmering strings and celesta, grand and serious cinematic trailer, ${FIRE}, instrumental, no vocals`,
    duration: 14,
  },
  turn_drone: {
    prompt: 'low ominous cinematic drone, sub-bass rumble, cold howling wind, distant icy harmonics, a slow heartbeat pulse, sparse and tense, no melody, no drums, instrumental',
    duration: 12,
  },
  escalation_build: {
    prompt: `epic orchestral trailer build that escalates nonstop for its whole length: starts with a sparse ticking pulse and low icy strings, adds war drums, then racing strings, glockenspiel and warm brass stabs, faster and louder every few seconds, ends on a huge full-orchestra climax at the very end, frost-and-fire battle theme, ${FIRE}, instrumental, no vocals`,
    duration: 46,
    variants: 2,
  },
  hype_track: {
    prompt: 'hype celebratory party track that starts on a huge beat drop, punchy trap-orchestral drums, bright brass hits, sleigh bells and celesta sparkle, warm, joyful and triumphant, festive winter energy, a montage of friends laughing, 140 BPM, instrumental, no vocals, sits under dialogue',
    duration: 62,
    variants: 2,
  },
};

// ---- Sound effects ---------------------------------------------------------
const SFX_STYLE = 'cinematic trailer sound effect, clean, high quality, no music, no speech';
const SFX = {
  swoosh: { prompt: 'fast cinematic whoosh transition, icy wind swoosh passing by the camera', duration: 1.2, variants: 3 },
  banner_flap: { prompt: 'heavy cloth banner whipping and flapping in a strong cold wind, chains rattling', duration: 2 },
  callout_stamp: { prompt: 'heavy trailer title impact hit, deep boom with a short metallic ring, like a title card stamping onto the screen', duration: 1.5, variants: 3 },
  riser: { prompt: 'cinematic tension riser, a rising whoosh and swelling noise climbing to a peak, ends abruptly', duration: 6, variants: 2 },
  title_slam: { prompt: 'massive cinematic trailer boom, ice shattering and a burst of roaring fire, deep sub drop', duration: 3 },
  // The title card's slam: bright and punchy so it lifts into the hype track, not a muddy sub boom.
  title_hit: { prompt: 'huge punchy cinematic trailer hit, a bright metallic crash and snare-like crack layered on a tight deep thump, sharp reverse-whoosh into the hit, high energy, ends cleanly with a short shimmering tail, no long rumble', duration: 2, variants: 4 },
  slowmo_boom: { prompt: 'deep slow-motion impact, time slowing down, stretched whoosh into a huge low boom', duration: 2.5 },
  heartbeat: { prompt: 'single deep heavy heartbeat thump, close and dry', duration: 1.2 },
  cost_reel: { prompt: 'slot machine reel spinning fast with quick ticks, then stopping with a gold coin ding', duration: 1.5 },
  url_shimmer: { prompt: 'magical ice crystal shimmer with a soft warm chime, sparkly reveal', duration: 2 },
  meow: {
    prompt: 'one tiny soft innocent kitten meow, a single short cute mew, close up, nothing else',
    duration: 1,
    variants: 4,
    style: 'realistic sound effect, clean, no music, no speech',
  },
};

// ---- Jobs ------------------------------------------------------------------
function jobs() {
  const out = [];
  const takes = (dir, table, kind) => {
    for (const [name, s] of Object.entries(table)) {
      const n = s.variants ?? 1;
      for (let v = 1; v <= n; v++) out.push({ key: n > 1 ? `${dir}/${name}_${v}` : `${dir}/${name}`, ext: 'mp3', kind, ...s });
    }
  };
  takes('music', MUSIC, 'music');
  takes('sfx', SFX, 'sfx');
  const only = args.only?.split(',').map((s) => s.trim()).filter(Boolean);
  return only ? out.filter((j) => only.some((p) => j.key.startsWith(p))) : out;
}

// ---- API calls -------------------------------------------------------------
async function fetchOk(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} from ${url}: ${(await res.text()).slice(0, 400)}`);
  return res;
}

// FAL_KEY_FALLBACK is a second account, tried when the first key errors.
const falKeys = [process.env.FAL_KEY, process.env.FAL_KEY_FALLBACK].map((k) => (k ?? '').trim()).filter(Boolean);
async function fal(model, body) {
  let last;
  for (const key of falKeys) {
    try {
      return await falWith(key, model, body);
    } catch (e) {
      last = e;
      console.warn(`  fal key failed for ${model}: ${e.message.slice(0, 160)}`);
    }
  }
  throw last ?? new Error('no FAL_KEY');
}
async function falWith(key, model, body) {
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  const submit = await fetchOk(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());
  const deadline = Date.now() + 8 * 60_000;
  for (;;) {
    const s = await fetchOk(submit.status_url, { headers }).then((r) => r.json());
    if (s.status === 'COMPLETED') break;
    if (Date.now() > deadline) throw new Error(`timed out on ${model}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  return fetchOk(submit.response_url, { headers }).then((r) => r.json());
}

async function generate(job) {
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const result = job.kind === 'music'
    ? await fal('fal-ai/elevenlabs/music', { prompt: job.prompt, music_length_ms: Math.round(job.duration * 1000), force_instrumental: true })
    : await fal('fal-ai/elevenlabs/sound-effects/v2', {
      text: `${job.prompt}, ${job.style ?? SFX_STYLE}`,
      duration_seconds: clamp(job.duration, 0.5, 22),
      prompt_influence: 0.6,
    });
  const file = result.audio ?? result.audio_file;
  if (!file?.url) throw new Error(`no audio in result: ${JSON.stringify(result).slice(0, 300)}`);
  return Buffer.from(await fetchOk(file.url).then((r) => r.arrayBuffer()));
}

// ---- Run -------------------------------------------------------------------
const list = jobs();
const indexPath = join(root, 'audio.json');
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
let failed = 0;
const queue = [...list];
async function worker() {
  for (let job; (job = queue.shift());) {
    const path = join(root, `${job.key}.${job.ext}`);
    if (existsSync(path) && !args.force) continue;
    try {
      const audio = await generate(job);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, audio);
      index[`${job.key}.${job.ext}`] = { kind: job.kind, prompt: job.prompt, duration: job.duration };
      console.log(`ok  ${job.key}.${job.ext} (${(audio.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      failed++;
      console.error(`ERR ${job.key}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));
writeFileSync(indexPath, JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 2) + '\n');
console.log(`${list.length} jobs, ${failed} failed`);
process.exit(failed ? 1 : 0);
