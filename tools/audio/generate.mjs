#!/usr/bin/env node
// Generates the game's sound pack: troop sound-effect sets and match sounds
// (fal), music loops (fal) and announcer lines (Cartesia TTS). The prompts
// live in prompts.mjs.
//
//   node --env-file=.env tools/audio/generate.mjs [options]
//
// Needs FAL_KEY, plus CARTESIA_API_KEY for the announcer. Writes audio files
// and an index.json the client loads to client/public/audio/, and a
// preview.html there for listening through the pack.
//
// Re-running skips clips whose prompt and model are unchanged, so edit a
// prompt and re-run to redo just that clip. Use --force with --only to
// re-roll a clip you don't like.
//
// It also copies dashboard.html there: a sound board grouped by troop set.
//
// Options:
//   --only <keys>       comma-separated key prefixes, e.g. sfx/heavy,music/battle
//   --force             regenerate even if the clip is up to date
//   --dry-run           print the jobs and request bodies without calling anything
//   --sfx-model <m>     eleven (default) | cassette | stable
//   --music-model <m>   eleven (default) | lyria | stable | cassette
//   --concurrency <n>   parallel requests, default 4
//   --out <dir>         output folder, default client/public/audio

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ANNOUNCER, GAME_SFX, MUSIC, SFX_SETS, SFX_STYLE } from './prompts.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'sfx-model': { type: 'string', default: 'eleven' },
    'music-model': { type: 'string', default: 'eleven' },
    concurrency: { type: 'string', default: '4' },
    out: { type: 'string', default: resolve(here, '../../client/public/audio') },
  },
});

// Each model maps a job to its fal request body. Durations are clamped to
// what the model accepts.
const SFX_MODELS = {
  eleven: {
    id: 'fal-ai/elevenlabs/sound-effects/v2',
    input: (j) => ({
      text: j.prompt,
      duration_seconds: clamp(j.duration, 0.5, 22),
      loop: j.loop,
      prompt_influence: 0.5,
    }),
  },
  cassette: {
    id: 'cassetteai/sound-effects-generator',
    input: (j) => ({ prompt: j.prompt, duration: clamp(Math.ceil(j.duration), 1, 30) }),
  },
  stable: {
    id: 'fal-ai/stable-audio-25/text-to-audio',
    input: (j) => ({ prompt: j.prompt, seconds_total: clamp(Math.ceil(j.duration), 1, 190) }),
  },
};

const MUSIC_MODELS = {
  eleven: {
    id: 'fal-ai/elevenlabs/music',
    input: (j) => ({
      prompt: j.prompt,
      music_length_ms: Math.round(clamp(j.duration, 3, 600) * 1000),
      force_instrumental: true,
    }),
  },
  // Lyria has no length setting and returns about 30 s.
  lyria: {
    id: 'fal-ai/lyria2',
    input: (j) => ({ prompt: j.prompt, negative_prompt: 'vocals, singing, low quality' }),
  },
  stable: {
    id: 'fal-ai/stable-audio-25/text-to-audio',
    input: (j) => ({ prompt: j.prompt, seconds_total: clamp(Math.ceil(j.duration), 1, 190) }),
  },
  cassette: {
    id: 'cassetteai/music-generator',
    input: (j) => ({ prompt: j.prompt, duration: clamp(Math.ceil(j.duration), 10, 180) }),
  },
};

const CARTESIA = {
  id: 'cartesia/sonic-3.6',
  version: '2026-08-14',
};

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

// ---- Jobs ------------------------------------------------------------------

function soundJobs(prefix, sounds) {
  const jobs = [];
  for (const [name, s] of Object.entries(sounds)) {
    const variants = s.variants ?? 1;
    for (let v = 1; v <= variants; v++) {
      jobs.push({
        key: variants > 1 ? `${prefix}/${name}_${v}` : `${prefix}/${name}`,
        kind: 'sfx',
        prompt: `${s.prompt}, ${s.style ?? SFX_STYLE}`,
        duration: s.duration,
        loop: s.loop ?? false,
      });
    }
  }
  return jobs;
}

function buildJobs() {
  const jobs = [];
  for (const [set, { events }] of Object.entries(SFX_SETS)) jobs.push(...soundJobs(`sfx/${set}`, events));
  jobs.push(...soundJobs('sfx/game', GAME_SFX));
  for (const [name, m] of Object.entries(MUSIC)) {
    jobs.push({ key: `music/${name}`, kind: 'music', prompt: m.prompt, duration: m.duration, loop: true });
  }
  for (const [name, l] of Object.entries(ANNOUNCER.lines)) {
    jobs.push({ key: `voice/announcer/${name}`, kind: 'voice', prompt: l.text, emotion: l.emotion, loop: false });
  }
  const only = args.only?.split(',').map((s) => s.trim()).filter(Boolean);
  return only ? jobs.filter((j) => only.some((p) => j.key.startsWith(p))) : jobs;
}

for (const [flag, table] of [['sfx-model', SFX_MODELS], ['music-model', MUSIC_MODELS]]) {
  if (!table[args[flag]]) {
    console.error(`Unknown --${flag} "${args[flag]}". Options: ${Object.keys(table).join(', ')}`);
    process.exit(1);
  }
}

function modelFor(job) {
  if (job.kind === 'voice') return CARTESIA;
  return job.kind === 'music' ? MUSIC_MODELS[args['music-model']] : SFX_MODELS[args['sfx-model']];
}

function requestBody(job, model) {
  if (job.kind !== 'voice') return model.input(job);
  return {
    model_id: 'sonic-3.6',
    transcript: job.prompt,
    voice: { id: ANNOUNCER.voice },
    language: 'en',
    output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
    generation_config: { emotion: job.emotion },
  };
}

// ---- API calls -------------------------------------------------------------

async function fetchOk(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} from ${url}: ${(await res.text()).slice(0, 400)}`);
  return res;
}

// fal queue API: submit, poll the status URL, then read the result.
async function falRun(modelId, body) {
  const headers = { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' };
  const submit = await fetchOk(`https://queue.fal.run/${modelId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }).then((r) => r.json());

  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const status = await fetchOk(submit.status_url, { headers }).then((r) => r.json());
    if (status.status === 'COMPLETED') break;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${modelId} (${submit.request_id})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const result = await fetchOk(submit.response_url, { headers }).then((r) => r.json());
  const file = result.audio ?? result.audio_file;
  if (!file?.url) throw new Error(`no audio in ${modelId} result: ${JSON.stringify(result).slice(0, 400)}`);

  const audio = Buffer.from(await fetchOk(file.url).then((r) => r.arrayBuffer()));
  return { audio, ext: extensionOf(file) };
}

async function cartesiaRun(body) {
  const res = await fetchOk('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`,
      'Cartesia-Version': CARTESIA.version,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { audio: Buffer.from(await res.arrayBuffer()), ext: '.mp3' };
}

const EXT_BY_TYPE = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
};

function extensionOf(file) {
  const fromName = extname(file.file_name ?? '') || extname(new URL(file.url).pathname);
  return EXT_BY_TYPE[file.content_type] ?? (fromName || '.mp3');
}

// ---- Main ------------------------------------------------------------------

const out = resolve(args.out);
const indexPath = join(out, 'index.json');
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};

function upToDate(job, model) {
  const entry = index[job.key];
  return (
    !args.force &&
    entry?.prompt === job.prompt &&
    entry?.model === model.id &&
    existsSync(join(out, entry.file))
  );
}

async function runJob(job) {
  const model = modelFor(job);
  if (upToDate(job, model)) return 'skipped';
  const body = requestBody(job, model);
  if (args['dry-run']) {
    console.log(`${job.key}  ${model.id}\n  ${JSON.stringify(body)}`);
    return 'planned';
  }

  const started = Date.now();
  const { audio, ext } = job.kind === 'voice' ? await cartesiaRun(body) : await falRun(model.id, body);
  const file = `${job.key}${ext}`;
  mkdirSync(dirname(join(out, file)), { recursive: true });
  writeFileSync(join(out, file), audio);

  index[job.key] = {
    file,
    kind: job.kind,
    model: model.id,
    prompt: job.prompt,
    ...(job.duration !== undefined && { duration: job.duration }),
    loop: job.loop,
  };
  // Save after every clip so an interrupted run keeps what it finished.
  writeIndex();
  console.log(`done   ${job.key}  ${((Date.now() - started) / 1000).toFixed(1)} s  ${(audio.length / 1024).toFixed(0)} KB`);
  return 'generated';
}

function writeIndex() {
  mkdirSync(out, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(indexPath, JSON.stringify(sorted, null, 2) + '\n');
}

function writePreview() {
  const rows = Object.entries(index)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, e]) =>
        `<tr><td><code>${esc(key)}</code></td><td><audio controls preload="none" ${e.loop ? 'loop' : ''} src="${esc(e.file)}"></audio></td><td>${esc(e.prompt)}</td></tr>`,
    )
    .join('\n');
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Sound pack preview</title>
<style>
  body { font: 14px system-ui, sans-serif; background: #15151c; color: #e6e6ee; margin: 24px; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 6px 10px; border-bottom: 1px solid #2a2a36; vertical-align: middle; }
  td:last-child { color: #9a9aae; }
</style>
<h1>Sound pack preview</h1>
<p>Re-roll a clip with <code>node --env-file=.env tools/audio/generate.mjs --only &lt;key&gt; --force</code>.</p>
<table>
${rows}
</table>
`;
  writeFileSync(join(out, 'preview.html'), html);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function main() {
  const jobs = buildJobs();
  const pending = jobs.filter((j) => !upToDate(j, modelFor(j)));
  if (!args['dry-run']) {
    const missing = [];
    if (pending.some((j) => j.kind !== 'voice') && !process.env.FAL_KEY) missing.push('FAL_KEY');
    if (pending.some((j) => j.kind === 'voice') && !process.env.CARTESIA_API_KEY) missing.push('CARTESIA_API_KEY');
    if (missing.length) {
      console.error(`Missing ${missing.join(' and ')}. Run with: node --env-file=.env tools/audio/generate.mjs`);
      process.exit(1);
    }
  }
  console.log(`${jobs.length} clips, ${pending.length} to generate, writing to ${out}`);

  const counts = { generated: 0, skipped: 0, planned: 0, failed: 0 };
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        counts[await runJob(job)]++;
      } catch (err) {
        counts.failed++;
        console.error(`FAILED ${job.key}: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Number(args.concurrency) || 4) }, worker));

  if (!args['dry-run'] && Object.keys(index).length) {
    writePreview();
    copyFileSync(join(here, 'dashboard.html'), join(out, 'dashboard.html'));
  }
  console.log(Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', '));
  if (counts.failed) process.exit(1);
}

await main();
