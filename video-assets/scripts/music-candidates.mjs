#!/usr/bin/env node
// Generates candidate music cues for the demo video from several fal music models, so the team can
// pick by ear. Nothing here replaces music/*.mp3; candidates land in music/candidates/<cue>/.
//
//   node --env-file=../.env scripts/music-candidates.mjs [--only hype_track,cold_open/lyria2] [--force]
//   node scripts/music-candidates.mjs --check      # measure every candidate (ffmpeg) into index.json
//
// Re-running skips files that already exist; --force with --only re-rolls them. Writes
// music/candidates/index.json listing every file with its model, prompt and (after --check) levels.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'music/candidates');
const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '5' },
  },
});

// ---- Shared prompt pieces --------------------------------------------------
const MIX = 'punchy, wide, modern trailer mastering, clean tight low end, professional AAA game trailer production';
const NO_VOX = 'instrumental, no vocals, no singing, no choir words';
const AVOID = 'vocals, singing, lyrics, sleigh bells, celesta, fireplace crackle, christmas, lo-fi, muddy mix, cheesy, amateur';

// ElevenLabs composition plan: sections with exact durations.
const section = (name, seconds, positive, negative = []) => ({
  section_name: name,
  duration_ms: Math.round(seconds * 1000),
  positive_local_styles: positive,
  negative_local_styles: negative,
  lines: [],
});
const plan = (globalPos, sections) => ({
  composition_plan: {
    positive_global_styles: globalPos,
    negative_global_styles: ['vocals', 'singing', 'lyrics', 'choir words', 'sleigh bells', 'celesta', 'fireplace crackle', 'christmas', 'lo-fi', 'muddy'],
    sections,
  },
  respect_sections_durations: true,
});

// ---- Candidates ------------------------------------------------------------
// Each: cue, model tag (file name), fal endpoint, intent (one line), prompt (as human text), body.
const C = [];
const add = (cue, tag, model, intent, prompt, body, n = 1) => C.push({ cue, tag, n, model, intent, prompt, body });

// 1. cold_open (~14 s): sports-broadcast / trailer cold open before kickoff.
{
  const p = `Modern cinematic sports-broadcast pre-game cold open crossed with a AAA video game trailer, ominous and grand, building anticipation. 90 BPM. 0-4 s: a deep sub-bass boom and a low sustained synth-brass drone with a quiet ticking pulse. 4-9 s: tight hybrid trailer percussion enters (taiko, processed toms, pulsing synth bass), a staccato low-string ostinato and a rising reverse swell. 9-14 s: a grand heroic brass statement over driving drums, swelling to a held peak and a final massive braam hit. Serious, epic, high stakes. ${MIX}. ${NO_VOX}.`;
  add('cold_open', 'elevenlabs', 'fal-ai/elevenlabs/music', 'Broadcast-meets-trailer intro: sub boom, hybrid drums, brass statement, braam ending (prompt timeline)',
    p, { prompt: p, music_length_ms: 14000, force_instrumental: true });

  const l = 'Epic modern sports broadcast intro theme, like a championship final pre-game show. Ominous low brass swells and a deep synth drone, then pounding hybrid trailer drums, staccato strings and a heroic French horn and trombone fanfare building to a huge climax. Dark, grand, anticipation, cinematic, 95 BPM, polished Hollywood trailer production, wide stereo, instrumental.';
  add('cold_open', 'lyria2', 'fal-ai/lyria2', 'Championship-final broadcast theme: low brass, hybrid drums, horn fanfare (~30 s, use the front)',
    l, { prompt: l, negative_prompt: `${AVOID}, soft, ambient, piano ballad` });

  const s = 'Cinematic hybrid trailer intro, ominous and grand, sports broadcast opening, deep sub booms, low synth brass drone, taiko and tom percussion building, staccato string ostinato, rising swell into a huge heroic brass hit, 90 BPM, D minor, epic, modern Hollywood trailer, wide stereo, high quality mastering, instrumental';
  add('cold_open', 'stable-audio', 'fal-ai/stable-audio-25/text-to-audio', 'Tag-style hybrid trailer intro: sub booms to heroic brass hit, 14 s',
    s, { prompt: s, seconds_total: 14 });

  const l3 = 'Instrumental only. A grand, ominous cinematic cold open for a championship broadcast and a blockbuster video game trailer. Starts with a deep sub boom and dark synth drone, a ticking pulse builds, hybrid trailer drums and staccato low strings enter, then a massive heroic brass theme rises to a peak and ends on a huge braam hit. 90 BPM, serious and epic, modern polished Hollywood trailer mix, no vocals.';
  add('cold_open', 'lyria3', 'fal-ai/lyria3', 'Same brief on Lyria 3: drone to drums to brass theme, braam ending',
    l3, { prompt: l3 });
}

// 2. turn_drone (~12 s): the tension drop, a breath before the storm.
{
  // A free-text prompt came back as a loud swell that died by 8 s (twice); a plan holds the whole 12 s.
  add('turn_drone', 'elevenlabs', 'fal-ai/elevenlabs/music',
    'Near-silent sub drone + soft 60 BPM heartbeat pulse, held for 12 s via a section plan, no swell or hits',
    'composition plan (see body)',
    plan(['dark minimal cinematic tension bed', 'almost silent', 'the held breath before a storm', 'modern trailer sound design', 'instrumental'], [
      section('Held breath', 6, ['soft deep sub-bass drone', 'slow muffled heartbeat pulse at 60 BPM', 'faint reversed metallic texture', 'very quiet, lots of space'], ['melody', 'drums', 'impacts', 'crescendo', 'brass']),
      section('Tension', 6, ['same soft sub drone and heartbeat pulse continue', 'barely audible high string harmonic', 'very slight tension', 'sustains to the very end'], ['melody', 'drums', 'impacts', 'crescendo', 'fade out', 'silence']),
    ]));

  const l = 'Dark minimalist cinematic tension underscore, a deep sub bass drone, a slow low pulse like a heartbeat, sparse and quiet, eerie suspense, distant metallic textures, very slow, minimal, modern trailer sound design, instrumental.';
  add('turn_drone', 'lyria2', 'fal-ai/lyria2', 'Sparse heartbeat-pulse suspense bed (~30 s, use any 12 s)',
    l, { prompt: l, negative_prompt: `${AVOID}, melody, loud drums, upbeat` });

  const s = 'Dark cinematic tension drone, deep sub bass rumble, slow heartbeat pulse at 60 BPM, sparse, quiet, suspense, minimal sound design, faint reversed metallic texture, low string cluster swell, no melody, modern trailer, high quality, instrumental';
  add('turn_drone', 'stable-audio', 'fal-ai/stable-audio-25/text-to-audio', 'Tag-style sub rumble + heartbeat pulse, 12 s',
    s, { prompt: s, seconds_total: 12 });

  // Beatoven (beatoven/music-generation) was down on fal ("Application is not available"); CassetteAI instead.
  const b = 'Dark minimal cinematic suspense drone, deep sub bass, slow soft heartbeat pulse at 60 BPM, sparse and nearly silent, tense, no melody, no drums, instrumental';
  add('turn_drone', 'cassetteai', 'cassetteai/music-generator', 'CassetteAI take on the minimal suspense drone, 12 s',
    b, { prompt: b, duration: 12 });
}

// 3. escalation_build (~45 s): nonstop escalation under the duel, climax at the very end.
{
  add('escalation_build', 'elevenlabs-plan', 'fal-ai/elevenlabs/music',
    'Six timed sections: ticking pulse -> ostinato -> hybrid drums -> brass -> double-time -> climax hit at 45 s',
    'composition plan (see body)',
    plan(['epic hybrid orchestral trailer build', 'modern AAA game trailer', 'nonstop escalation', 'D minor', 'punchy wide modern mastering', 'instrumental'], [
      section('Sparse pulse', 7, ['sparse ticking synth pulse at 120 BPM', 'low sustained string drone', 'quiet', 'tense'], ['drums', 'brass']),
      section('Ostinato', 7, ['staccato low string ostinato in eighth notes', 'soft kick on each bar', 'pulsing synth bass', 'growing'], ['brass melody']),
      section('Drums enter', 8, ['hybrid trailer drums enter', 'taiko and toms', 'strings in sixteenths', 'synth arpeggio', 'louder']),
      section('Brass', 8, ['big low brass stabs', 'full trailer percussion', 'rising risers', 'intense', 'faster feel']),
      section('Double time', 8, ['double-time drums', 'racing sixteenth strings', 'heroic brass melody', 'massive and relentless']),
      section('Climax', 7, ['everything at maximum', 'shepard tone riser', 'pounding drums', 'full orchestra and synths', 'peaks at the very end on one huge final hit'], ['fade out', 'quiet ending']),
    ]));

  const p = `Nonstop escalating hybrid orchestral trailer build for a high-stakes duel, getting faster and bigger every few seconds. 0-7 s: sparse ticking synth pulse and a low string drone. 7-15 s: staccato low strings and a soft kick. 15-23 s: hybrid trailer drums, taiko, synth arpeggios, strings in sixteenths. 23-31 s: low brass stabs and risers, the tempo feel doubles. 31-39 s: racing strings, pounding drums and a heroic brass theme. 39-45 s: everything at maximum with a shepard-tone riser, climaxing on one huge final hit right at the end, no fade out. ${MIX}. ${NO_VOX}.`;
  add('escalation_build', 'elevenlabs', 'fal-ai/elevenlabs/music', 'Same arc as one written prompt timeline, no fade, ends on the hit',
    p, { prompt: p, music_length_ms: 45000, force_instrumental: true });

  const s = 'Epic hybrid orchestral trailer build, nonstop crescendo, starts sparse with a ticking pulse and low strings, adds taiko and hybrid drums, staccato string ostinato, synth arpeggios, brass stabs, gets faster and louder continuously, racing strings, huge climax at the end, 120 BPM, D minor, modern AAA game trailer, punchy wide mastering, instrumental';
  add('escalation_build', 'stable-audio', 'fal-ai/stable-audio-25/text-to-audio', 'Tag-style continuous crescendo, sparse tick to full-orchestra climax, 45 s',
    s, { prompt: s, seconds_total: 45 });

  // CassetteAI was tried here twice; both takes peaked mid-track and sagged at the end, so it's out.
}

// 4. hype_track (~60 s): montage, opens on a big beat drop, catchy, sits under dialogue.
{
  const p = `Energetic modern hype edit track, phonk-meets-big-room electronic, 130 BPM. Starts instantly on a huge beat drop at 0:00, no intro: hard punchy kick, distorted 808 bass, cowbell phonk melody, big supersaw synth stabs and a catchy synth hook. Fun, cocky and catchy like a viral gaming highlights montage. Keeps the energy high the whole time with short fills and a second drop at 30 s, ends on a hit. Mix leaves room in the midrange for people talking. ${MIX}. ${NO_VOX}.`;
  add('hype_track', 'elevenlabs-phonk', 'fal-ai/elevenlabs/music', 'Phonk/big-room hype edit, 130 BPM, cowbell + supersaw hook, drop at 0:00',
    p, { prompt: p, music_length_ms: 60000, force_instrumental: true });

  const s = 'Energetic pop rock game launch trailer, starts on a big drop, stomp clap groove, big punchy live drums, driving distorted guitars, bright brass riff hook, synth bass, fun, catchy, upbeat, triumphant, 128 BPM, modern polished mastering, instrumental';
  add('hype_track', 'stable-audio', 'fal-ai/stable-audio-25/text-to-audio', 'Pop-rock launch trailer: stomp-clap, big drums, guitars, brass hook, 60 s',
    s, { prompt: s, seconds_total: 60 });

  const b = 'Energetic big room electronic hype track for a gaming montage, starts immediately on a huge drop with no intro, punchy four-on-the-floor drums, big supersaw synths, catchy synth hook, brass stabs, fun and upbeat, 128 BPM, modern polished mastering, instrumental';
  add('hype_track', 'cassetteai', 'cassetteai/music-generator', 'CassetteAI big-room electronic hype, 60 s',
    b, { prompt: b, duration: 60 });

  // Take 1 (a section plan) opened on a 3 s fade-in and was dropped; take 2 pins the drop to 0:00.
  const t = `Trap-orchestral hybrid hype track for a game launch trailer and a montage of friends having fun. The very first beat at 0.0 s is the full drop, no intro, no riser, no fade-in: hard 808 bass, crisp trap hi-hats with rolls, claps, and a big catchy brass riff hook over string stabs, 140 BPM half-time bounce. 15-30 s: groove with brass hook variations and pizzicato strings. 30-45 s: a synth lead doubles the hook, orchestral hits, bigger. 45-60 s: final drop with everything in, ends on a strong final hit. Fun, confident, triumphant. Mix leaves midrange room for dialogue. ${MIX}. ${NO_VOX}.`;
  add('hype_track', 'elevenlabs-trap-orch', 'fal-ai/elevenlabs/music', 'Trap-orchestral hybrid as a written prompt, drop pinned to 0.0 s',
    t, { prompt: t, music_length_ms: 60000, force_instrumental: true }, 2);

  const l3 = 'Instrumental only. A fun, high-energy modern hype track for a game launch trailer and a montage of friends laughing. It starts immediately on a huge beat drop with no intro: punchy trap drums, hard 808 bass, a catchy bold brass riff, bright synth stabs and claps, a strong bouncing groove at 140 BPM. Confident, playful, triumphant, polished modern mix with space for dialogue, no vocals.';
  add('hype_track', 'lyria3', 'fal-ai/lyria3', 'Lyria 3 trap/brass hype (length set by the model)',
    l3, { prompt: l3 });
}

// ---- API calls (same pattern as scripts/audio.mjs) -------------------------
async function fetchOk(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} from ${url}: ${(await res.text()).slice(0, 400)}`);
  return res;
}
const falKeys = [process.env.FAL_KEY, process.env.FAL_KEY_FALLBACK].map((k) => (k ?? '').trim()).filter(Boolean);
async function fal(model, body) {
  let last;
  for (const key of falKeys) {
    try {
      return await falWith(key, model, body);
    } catch (e) {
      last = e;
      console.warn(`  fal key failed for ${model}: ${e.message.slice(0, 200)}`);
    }
  }
  throw last ?? new Error('no FAL_KEY');
}
async function falWith(key, model, body) {
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  const submit = await fetchOk(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const s = await fetchOk(submit.status_url, { headers }).then((r) => r.json());
    if (s.status === 'COMPLETED') break;
    if (Date.now() > deadline) throw new Error(`timed out on ${model}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  return fetchOk(submit.response_url, { headers }).then((r) => r.json());
}

async function generate(job, path) {
  const result = await fal(job.model, job.body);
  const file = result.audio ?? result.audio_file;
  if (!file?.url) throw new Error(`no audio in result: ${JSON.stringify(result).slice(0, 300)}`);
  const buf = Buffer.from(await fetchOk(file.url).then((r) => r.arrayBuffer()));
  mkdirSync(dirname(path), { recursive: true });
  const isMp3 = /\.mp3(\?|$)/i.test(file.url) || file.content_type === 'audio/mpeg';
  if (isMp3) writeFileSync(path, buf);
  else {
    // Beatoven (WAV) and anything else: transcode to a 256k mp3.
    const tmp = `${path}.src`;
    writeFileSync(tmp, buf);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', '256k', path]);
    unlinkSync(tmp);
  }
}

// ---- Measurements ----------------------------------------------------------
// ffmpeg logs volumedetect to stderr; capture both streams.
function run(cmd, a) {
  const r = spawnSync(cmd, a, { encoding: 'utf8' });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}
function vd(path, ss, t) {
  const a = ['-hide_banner', '-nostats'];
  if (ss != null) a.push('-ss', String(ss));
  if (t != null) a.push('-t', String(t));
  a.push('-i', path, '-af', 'volumedetect', '-f', 'null', '-');
  const r = run('ffmpeg', a);
  return { mean: Number(/mean_volume: (-?[\d.]+) dB/.exec(r)?.[1] ?? NaN), max: Number(/max_volume: (-?[\d.]+) dB/.exec(r)?.[1] ?? NaN) };
}
function measure(path) {
  const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).trim());
  const all = vd(path);
  const first2 = vd(path, 0, 2);
  const first5 = vd(path, 0, 5);
  const last5 = vd(path, Math.max(0, dur - 5), 5);
  return {
    duration: +dur.toFixed(2),
    mean_db: all.mean,
    peak_db: all.max,
    first2_mean_db: first2.mean,
    first5_mean_db: first5.mean,
    last5_mean_db: last5.mean,
    build_db: +(last5.mean - first5.mean).toFixed(1),
  };
}

// ---- Run -------------------------------------------------------------------
const indexPath = join(outDir, 'index.json');
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
const rel = (j) => `${j.cue}/${j.tag}-${j.n}.mp3`;
const only = args.only?.split(',').map((s) => s.trim()).filter(Boolean);
const list = only ? C.filter((j) => only.some((p) => rel(j).startsWith(p))) : C;

if (args.check) {
  for (const [file, entry] of Object.entries(index)) {
    const path = join(outDir, file);
    if (!existsSync(path)) continue;
    entry.measure = measure(path);
    const m = entry.measure;
    console.log(`${file.padEnd(44)} ${String(m.duration).padStart(6)}s  mean ${m.mean_db}  peak ${m.peak_db}  first2 ${m.first2_mean_db}  first5 ${m.first5_mean_db}  last5 ${m.last5_mean_db}  build ${m.build_db}`);
  }
} else {
  let failed = 0;
  const queue = [...list];
  async function worker() {
    for (let job; (job = queue.shift());) {
      const file = rel(job);
      const path = join(outDir, file);
      if (existsSync(path) && !args.force) continue;
      try {
        await generate(job, path);
        index[file] = { cue: job.cue, model: job.model, intent: job.intent, prompt: job.prompt, request: job.body };
        console.log(`ok  ${file}`);
      } catch (e) {
        failed++;
        console.error(`ERR ${file}: ${e.message.slice(0, 400)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));
  console.log(`${list.length} jobs, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
mkdirSync(outDir, { recursive: true });
writeFileSync(indexPath, JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 2) + '\n');
