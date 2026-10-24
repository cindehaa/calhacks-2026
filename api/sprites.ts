import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Troop art from fal's FLUX.2 [klein] 4B distilled: ~0.6-1 s warm for 512 px on Oct 23, so it
// usually lands before the 2.5 s deploy delay. The browser keys out the magenta background.
const ENDPOINT = 'https://fal.run/fal-ai/flux-2/klein/4b/distilled';
const TIMEOUT_MS = 8000;
const SIZE = 512; // fal bills a whole megapixel anyway, so smaller saves nothing

// One shared style so every troop looks like the same game.
const prompt = (description: string) =>
  `A single ${description}, full body, centred, as a cute chunky mobile strategy game character, ` +
  '3/4 top-down view, bold dark outline, flat cel shading, vibrant colours, no text, no ground, ' +
  'no shadow, isolated on a flat solid pure magenta (#FF00FF) background';

export const hasFalKey = () => !!process.env.FAL_KEY?.trim();

// Same description, same sprite, across matches and api restarts (fal's URLs are long-lived).
const cacheFile = new URL('../.cache/sprites.json', import.meta.url);
const cache = new Map<string, Promise<string>>();
const saved: Record<string, string> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
for (const [k, url] of Object.entries(saved)) cache.set(k, Promise.resolve(url));

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

function save(key: string, url: string) {
  saved[key] = url;
  mkdirSync(new URL('.', cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(saved, null, 1));
}

export interface Sprite {
  url: string; // '' when there's no key or the call failed; the troop keeps its emoji
  ms: number;
  cached: boolean;
}

// Never throws. A failure isn't cached, so the next deploy of the same words tries again.
export async function spriteFor(description: string): Promise<Sprite> {
  const t0 = performance.now();
  const key = normalise(description);
  if (!key || !hasFalKey()) return { url: '', ms: 0, cached: false };
  const hit = cache.get(key);
  const p = hit ?? generate(key);
  if (!hit) cache.set(key, p);
  const url = await p;
  if (!url) cache.delete(key);
  else if (!saved[key]) save(key, url);
  return { url, ms: Math.round(performance.now() - t0), cached: !!hit };
}

async function generate(description: string): Promise<string> {
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Key ${process.env.FAL_KEY!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt(description), image_size: { width: SIZE, height: SIZE }, output_format: 'png' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`fal ${r.status}: ${JSON.stringify(body).slice(0, 160)}`);
    // The safety checker returns a black image rather than an error.
    if (body.has_nsfw_concepts?.[0]) throw new Error('flagged by the safety checker');
    const url = body.images?.[0]?.url;
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('no image url');
    return url;
  } catch (e) {
    console.warn(`sprite for "${description}" failed:`, e instanceof Error ? e.message.slice(0, 160) : e);
    return '';
  }
}
