#!/usr/bin/env node
// Generates the demo video's narrator lines (Cartesia TTS), music cues and sound effects (fal:
// ElevenLabs music and sound effects), in the game's warmth-and-frost style (meta/aesthetics.md).
// Same models and keys as the game's own pack (tools/audio/generate.mjs).
//
//   node --env-file=.env video-assets/scripts/audio.mjs [--only narrator/aim,music] [--force]
//
// Re-running skips files that already exist; --force with --only re-rolls them. Writes
// video-assets/audio.json listing every file with its prompt.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: { only: { type: 'string' }, force: { type: 'boolean', default: false }, concurrency: { type: 'string', default: '4' } },
});

// ---- Narrator ---------------------------------------------------------------
// A trailer voice played dead straight. Every line is voiced by both main voices so the pick can be
// made by ear; the opening line also gets an audition in four more.
const VOICES = {
  sterling: 'b134c304-d095-4d2b-a77a-914f5e8e84e7', // deep, commanding, dignified
  damon: 'dbfa416f-d5c3-4006-854b-235ef6bdf4fd', // deep, serious, documentary gravitas
};
const AUDITION = {
  darius: '23112795-d54e-4560-9568-791a87c30201', // husky, commanding
  mark: '5619d38c-cf51-4d8e-9575-48f61a280413', // broadcast promo
  clint: 'db69127a-dbaf-4fa9-b425-2fe67680c348', // raspy, dramatic
  harlan: 'a892d232-f705-40d7-bc8d-e368b295ec2a', // old radio announcer
};
const B = (ms) => `<break time="${ms}ms"/>`;
const LINES = {
  // Cold open: the brief's line first, then two alternates.
  open_a: `Are you up for${B(250)} a battle of creativity?`,
  open_b: `Two players.${B(500)} One arena.${B(600)} And nothing but their imagination.`,
  open_c: `This year${B(400)} only the most creative${B(300)} will survive.`,
  countdown: `Three.${B(500)} Two.${B(500)} One.${B(500)} Start.`,
  // Feature callouts, in the order they happen in the duel.
  aim: 'Aim with your finger.',
  imagine_a: `If you can imagine it${B(400)} you can summon it.`,
  imagine_b: 'Your imagination is your deck.',
  imagine_c: `No cards.${B(400)} Just imagination.`,
  deploy_a: `Open your hand${B(400)} and your imagination comes to life.`,
  deploy_b: `Drop it in.${B(400)} Watch it come to life.`,
  cost: `The more powerful the troop${B(400)} the more embers it costs.`,
  live: `Play your friends.${B(400)} Live.`,
};
const NARRATION = { speed: 0.9, emotion: 'serious' };

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
  for (const [line, text] of Object.entries(LINES)) {
    for (const [name, id] of Object.entries(VOICES)) out.push({ key: `narrator/${line}.${name}`, ext: 'wav', kind: 'voice', text, voice: id });
  }
  for (const [name, id] of Object.entries(AUDITION)) out.push({ key: `narrator/audition/open_a.${name}`, ext: 'wav', kind: 'voice', text: LINES.open_a, voice: id });
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

async function cartesia(job) {
  const body = (config) => JSON.stringify({
    model_id: 'sonic-3.6',
    transcript: job.text,
    voice: { mode: 'id', id: job.voice },
    language: 'en',
    output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 },
    ...(config && { generation_config: config }),
  });
  const init = (config) => ({
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`, 'Cartesia-Version': '2026-08-14', 'Content-Type': 'application/json' },
    body: body(config),
  });
  try {
    return Buffer.from(await fetchOk('https://api.cartesia.ai/tts/bytes', init(NARRATION)).then((r) => r.arrayBuffer()));
  } catch (e) {
    if (!/^4\d\d/.test(e.message)) throw e;
    // An emotion the model doesn't know: fall back to speed alone.
    console.warn(`  cartesia rejected ${JSON.stringify(NARRATION)}, retrying with speed only: ${e.message.slice(0, 160)}`);
    return Buffer.from(await fetchOk('https://api.cartesia.ai/tts/bytes', init({ speed: NARRATION.speed })).then((r) => r.arrayBuffer()));
  }
}

async function generate(job) {
  if (job.kind === 'voice') return cartesia(job);
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

// Narration comes back quiet and uneven; bring every line to -16 LUFS, the usual level for voice-over.
function normalise(path) {
  const tmp = `${path}.tmp.wav`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-c:a', 'pcm_s16le', tmp]);
  renameSync(tmp, path);
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
      if (job.kind === 'voice') normalise(path);
      index[`${job.key}.${job.ext}`] = job.kind === 'voice'
        ? { kind: 'voice', text: job.text, voice: job.voice, ...NARRATION }
        : { kind: job.kind, prompt: job.prompt, duration: job.duration };
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
