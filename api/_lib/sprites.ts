// Troop art: fal FLUX.1 schnell draws the unit on flat magenta, BiRefNet v2 cuts it out, and the
// PNG is kept on disk and served from this proxy at a short URL. The troop row's spriteUrl is a
// string cut at 2048 chars, so a data URI won't fit; the client loads this URL same-origin
// through Vite's /api proxy (with CORS headers too), so the canvas is never tainted.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalise } from '../../shared/troop.js';

// Description first, then the shared style, so the subject wins over the boilerplate.
export const STYLE =
  'Single game unit, full body, centered, chunky stylised 3D mobile-game art, bold silhouette, bright saturated colours, soft studio lighting, no text, no signature, no watermark, no border';
export const BACKGROUND = 'on a flat magenta #FF00FF background';
const STYLE_VERSION = 1; // bump to regenerate everything after a prompt change

const SIZE = 384;
const FLUX_TIMEOUT_MS = 10_000;
const REMOVE_TIMEOUT_MS = 3000; // past this, the browser keys the background itself

// Generated art is kept on disk, in .cache/ locally. Vercel's filesystem is read-only apart from
// the temp dir, which only lasts as long as the function instance, so there art is redrawn after
// a cold start, and the sprite function serves its own files (the rewrites in vercel.json).
export const cacheDir = (name: string) =>
  process.env.VERCEL ? pathToFileURL(join(tmpdir(), 'arena', name) + '/') : new URL(`../../.cache/${name}/`, import.meta.url);
const DIR = cacheDir('sprites');

export const hasFalKey = () => !!(process.env.FAL_KEY ?? '').trim();

// Generated art as the api serves it: '/api/<kind>/<id>.png', or '.key.png?key' when the
// background is still on and the browser has to key it.
export interface Art {
  url: string;
  removed: boolean;
  cached: boolean;
  ms: number;
}

const idOf = (description: string) =>
  createHash('sha1').update(`${STYLE_VERSION}|${normalise(description)}`).digest('hex').slice(0, 20);

export function sprite(description: string): Promise<Art> {
  return cachedArt('sprite', DIR, idOf(description), async () => {
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
    return raw;
  });
}

export const spriteFile = (name: string) => artFile(DIR, name);

// The base sprite's PNG for a description, drawing it first if needed. Poses (poses.ts) edit it.
export async function spritePng(description: string): Promise<Buffer> {
  const s = await sprite(description);
  const png = await spriteFile(s.url.slice('/api/sprite/'.length).split('?')[0]);
  if (!png) throw new Error('sprite missing on disk');
  return png;
}

// Same id, same art: a hit on disk is free, and a second request for art still being drawn waits
// for the first instead of paying twice. draw() answers with the raw image (a data URI or URL);
// BiRefNet cuts it out, and if that fails or times out it's kept as is for the browser to key.
const inFlight = new Map<string, Promise<Art>>();

export async function cachedArt(kind: 'sprite' | 'pose', dir: URL, id: string, draw: () => Promise<string>): Promise<Art> {
  const t0 = performance.now();
  const file = (removed: boolean) => (removed ? `${id}.png` : `${id}.key.png`);
  const urlOf = (removed: boolean) => (removed ? `/api/${kind}/${id}.png` : `/api/${kind}/${id}.key.png?key`);
  for (const removed of [true, false]) {
    if (existsSync(new URL(file(removed), dir))) return { url: urlOf(removed), removed, cached: true, ms: 0 };
  }
  const key = `${kind}/${id}`;
  let p = inFlight.get(key);
  if (!p) {
    p = (async () => {
      const raw = await draw();
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
        console.warn(`${kind} background removal failed, client will key it:`, e instanceof Error ? e.message.slice(0, 160) : e);
      }
      const removed = !!png;
      png ??= await bytes(raw);
      mkdirSync(dir, { recursive: true });
      await writeFile(new URL(file(removed), dir), png);
      return { url: urlOf(removed), removed, cached: false, ms: 0 };
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  return { ...(await p), ms: Math.round(performance.now() - t0) };
}

// The PNG for a served name, or null. Ids are hex only, so the name can't walk out of dir.
export async function artFile(dir: URL, name: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{20}(\.key)?\.png$/.test(name)) return null;
  try {
    return await readFile(new URL(name, dir));
  } catch {
    return null;
  }
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
