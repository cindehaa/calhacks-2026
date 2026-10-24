// Troop art: fal FLUX.1 schnell draws the unit on flat magenta, BiRefNet v2 cuts it out, and the
// PNG is kept on disk and served from this proxy at a short URL. The troop row's spriteUrl is a
// string cut at 2048 chars, so a data URI won't fit; the client loads this URL same-origin
// through Vite's /api proxy (with CORS headers too), so the canvas is never tainted.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

// Description first, then the shared style, so the subject wins over the boilerplate.
export const STYLE =
  'Single game unit, full body, centered, chunky stylised 3D mobile-game art, bold silhouette, bright saturated colours, soft studio lighting, no text, no signature, no watermark, no border';
export const BACKGROUND = 'on a flat magenta #FF00FF background';
const STYLE_VERSION = 1; // bump to regenerate everything after a prompt change

const SIZE = 384;
const FLUX_TIMEOUT_MS = 10_000;
export const REMOVE_TIMEOUT_MS = 3000; // past this, the browser keys the background itself

const DIR = new URL('../.cache/sprites/', import.meta.url);

export const hasFalKey = () => !!(process.env.FAL_KEY ?? '').trim();

export interface Sprite {
  url: string; // '/api/sprite/<id>.png', plus '?key' when the background is still on
  removed: boolean;
  cached: boolean;
  ms: number;
}

export const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
const idOf = (description: string) =>
  createHash('sha1').update(`${STYLE_VERSION}|${normalise(description)}`).digest('hex').slice(0, 20);

// Same description, same art: a hit on disk is free, and a second request for art still being
// drawn waits for the first instead of paying twice.
const inFlight = new Map<string, Promise<Sprite>>();

export async function sprite(description: string): Promise<Sprite> {
  const t0 = performance.now();
  const id = idOf(description);
  for (const [file, removed] of [[`${id}.png`, true], [`${id}.key.png`, false]] as const) {
    if (existsSync(new URL(file, DIR))) return { url: urlOf(id, removed), removed, cached: true, ms: 0 };
  }
  let p = inFlight.get(id);
  if (!p) {
    p = draw(id, description).finally(() => inFlight.delete(id));
    inFlight.set(id, p);
  }
  const s = await p;
  return { ...s, ms: Math.round(performance.now() - t0) };
}

// The PNG for a served URL, or null. Ids are hex only, so the name can't walk out of DIR.
export async function spriteFile(name: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{20}(\.key)?\.png$/.test(name)) return null;
  try {
    return await readFile(new URL(name, DIR));
  } catch {
    return null;
  }
}

// The base sprite's PNG for a description, drawing it first if needed. Poses (api/poses.ts) edit it.
export async function spritePng(description: string): Promise<Buffer> {
  const s = await sprite(description);
  const png = await spriteFile(s.url.slice('/api/sprite/'.length).split('?')[0]);
  if (!png) throw new Error('sprite missing on disk');
  return png;
}

const urlOf = (id: string, removed: boolean) => (removed ? `/api/sprite/${id}.png` : `/api/sprite/${id}.key.png?key`);

async function draw(id: string, description: string): Promise<Sprite> {
  const t0 = performance.now();
  const flux = await fal<{ images?: { url: string }[] }>(
    'fal-ai/flux/schnell',
    {
      prompt: `${description.slice(0, 300)}. ${STYLE}, ${BACKGROUND}`,
      image_size: { width: SIZE, height: SIZE },
      num_inference_steps: 4,
      num_images: 1,
      output_format: 'png',
      sync_mode: true, // answer with a data URI: one round trip fewer
    },
    FLUX_TIMEOUT_MS
  );
  const raw = flux.images?.[0]?.url;
  if (!raw) throw new Error('flux: no image');
  let png: Buffer | null = null;
  try {
    // BiRefNet takes the data URI as its input, so the image never has to be hosted anywhere.
    const cut = await fal<{ image?: { url: string } }>(
      'fal-ai/birefnet/v2',
      { image_url: raw, model: 'General Use (Light)', output_format: 'png', sync_mode: true },
      REMOVE_TIMEOUT_MS
    );
    if (cut.image?.url) png = await bytes(cut.image.url);
  } catch (e) {
    console.warn('background removal failed, client will key it:', e instanceof Error ? e.message.slice(0, 160) : e);
  }
  const removed = !!png;
  png ??= await bytes(raw);
  mkdirSync(DIR, { recursive: true });
  await writeFile(new URL(removed ? `${id}.png` : `${id}.key.png`, DIR), png);
  return { url: urlOf(id, removed), removed, cached: false, ms: Math.round(performance.now() - t0) };
}

// fal's synchronous endpoint: one POST, the result in the response.
export async function fal<T>(model: string, input: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const r = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${(process.env.FAL_KEY ?? '').trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`${model}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  return (await r.json()) as T;
}

// A data URI (sync_mode) or, if fal ignored that, a hosted URL.
export async function bytes(url: string): Promise<Buffer> {
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(url);
  if (m) return Buffer.from(m[1], 'base64');
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`image fetch: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
