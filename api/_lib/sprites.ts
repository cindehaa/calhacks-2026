// Troop art: fal FLUX.1 schnell draws the unit on flat magenta, BiRefNet v2 cuts it out, and the
// PNG is kept (art_store.ts: disk locally, Vercel Blob when deployed) and served from this proxy at a short URL. The troop row's spriteUrl is a
// string cut at 2048 chars, so a data URI won't fit; the client loads this URL same-origin
// through Vite's /api proxy (with CORS headers too), so the canvas is never tainted.
import { createHash } from 'node:crypto';
import { normalise } from '../../shared/troop.js';
import { artStore, type ArtStore } from './art_store.js';
import { describeArt } from './art_prompt.js';

// Subject first, then the shared style, so the subject wins over the boilerplate. The subject is
// the player's words rewritten as one drawable character (art_prompt.ts), so "Great Wall of China"
// is a stone wall golem rather than whatever schnell guesses a "game unit" of it looks like.
export const STYLE =
  'one single character, whole body visible, centered, isolated, chunky stylised 3D mobile-game art, bold silhouette, bright saturated colours, soft studio lighting, no scenery, no ground, no sky, no text, no signature, no watermark, no border';
export const BACKGROUND = 'on a plain flat magenta #FF00FF background';
const STYLE_VERSION = 2; // bump to regenerate everything after a prompt change

const SIZE = 384;
const FLUX_TIMEOUT_MS = 10_000;
const REMOVE_TIMEOUT_MS = 3000; // past this, the browser keys the background itself

// Generated art is kept in .cache/ locally, and in Vercel Blob when the project has a store
// (art_store.ts); the sprite function serves it either way (the rewrites in vercel.json).
const STORE = artStore('sprites');

// FAL_KEY_FALLBACK is a second account's key, used when the first one errors (out of balance, revoked,
// rate limited, down).
const falKeys = () => [process.env.FAL_KEY, process.env.FAL_KEY_FALLBACK].map(k => (k ?? '').trim()).filter(Boolean);
export const hasFalKey = () => falKeys().length > 0;

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
  return cachedArt('sprite', STORE, idOf(description), async () => {
    const subject = await describeArt(description);
    console.log(`sprite "${description.slice(0, 60)}" → ${subject}`);
    const input = {
      prompt: `${subject.slice(0, 300)}. ${STYLE}, ${BACKGROUND}`,
      image_size: { width: SIZE, height: SIZE },
      num_inference_steps: 4,
      num_images: 1,
      output_format: 'png',
      sync_mode: true, // answer with a data URI: one round trip fewer
    };
    // One retry for a fal error answered quickly (a 5xx, an empty result); a timeout isn't retried,
    // since the browser gives up on the whole request at 15 s.
    const t0 = performance.now();
    for (let attempt = 0; ; attempt++) {
      try {
        const flux = await fal<{ images?: { url: string }[] }>('fal-ai/flux/schnell', input, FLUX_TIMEOUT_MS);
        const raw = flux.images?.[0]?.url;
        if (!raw) throw new Error('flux: no image');
        return raw;
      } catch (e) {
        const timedOut = e instanceof Error && e.name === 'TimeoutError';
        if (attempt > 0 || timedOut || performance.now() - t0 > 4000) throw e;
        console.warn('flux failed, retrying once:', e instanceof Error ? e.message.slice(0, 160) : e);
      }
    }
  });
}

export const spriteFile = (name: string) => artFile(STORE, name);

// The base sprite's PNG for a description, drawing it first if needed. Poses (poses.ts) edit it.
export async function spritePng(description: string): Promise<Buffer> {
  const s = await sprite(description);
  const png = await spriteFile(s.url.slice('/api/sprite/'.length).split('?')[0]);
  if (!png) throw new Error('sprite missing from the art store');
  return png;
}

// Same id, same art: a hit in the store is free, and a second request for art still being drawn waits
// for the first instead of paying twice. draw() answers with the raw image (a data URI or URL);
// BiRefNet cuts it out, and if that fails or times out it's kept as is for the browser to key.
const inFlight = new Map<string, Promise<Art>>();

export async function cachedArt(kind: 'sprite' | 'pose', store: ArtStore, id: string, draw: () => Promise<string>): Promise<Art> {
  const t0 = performance.now();
  const file = (removed: boolean) => (removed ? `${id}.png` : `${id}.key.png`);
  const urlOf = (removed: boolean) => (removed ? `/api/${kind}/${id}.png` : `/api/${kind}/${id}.key.png?key`);
  for (const removed of [true, false]) {
    if (await store.exists(file(removed))) return { url: urlOf(removed), removed, cached: true, ms: 0 };
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
      await store.write(file(removed), png);
      return { url: urlOf(removed), removed, cached: false, ms: 0 };
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  return { ...(await p), ms: Math.round(performance.now() - t0) };
}

// The PNG for a served name, or null. Ids are hex only, so the name can't walk out of the store.
export async function artFile(store: ArtStore, name: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{20}(\.key)?\.png$/.test(name)) return null;
  return store.read(name);
}

// fal answers 429 past 10 requests in flight per key, and drawing every anchor at api start (or a
// busy match with poses) went past it: sprites failed and cut-outs fell back to the browser keyer,
// which then stayed cached. So calls queue here, at most FAL_SLOTS at once from this instance.
// The timeout only starts once a call has a slot.
const FAL_SLOTS = 8;
let falBusy = 0;
const falQueue: (() => void)[] = [];

// A key that answered 401/403 (revoked, or locked for an exhausted balance) is skipped for a while,
// so every call doesn't pay a failed round trip before reaching the fallback.
const KEY_COOLDOWN_MS = 10 * 60_000;
const keyDeadUntil = new Map<string, number>();

// fal's synchronous endpoint: one POST, the result in the response. An HTTP error or a failed
// connection moves on to the next key; a timeout doesn't, since the caller's time is already spent.
export async function fal<T>(model: string, input: Record<string, unknown>, timeoutMs: number): Promise<T> {
  if (falBusy >= FAL_SLOTS) await new Promise<void>(go => falQueue.push(go));
  falBusy++;
  try {
    const keys = falKeys();
    const live = keys.filter(k => (keyDeadUntil.get(k) ?? 0) < Date.now());
    const order = live.length ? live : keys;
    const signal = AbortSignal.timeout(timeoutMs);
    let err: unknown;
    for (const [i, key] of order.entries()) {
      try {
        const r = await fetch(`https://fal.run/${model}`, {
          method: 'POST',
          headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal,
        });
        if (!r.ok) {
          if (r.status === 401 || r.status === 403) keyDeadUntil.set(key, Date.now() + KEY_COOLDOWN_MS);
          throw new Error(`${model}: ${r.status} ${(await r.text()).slice(0, 160)}`);
        }
        keyDeadUntil.delete(key);
        return (await r.json()) as T;
      } catch (e) {
        err = e;
        if (signal.aborted || i === order.length - 1) break;
        console.warn(`fal key ${i + 1} failed, trying the fallback:`, e instanceof Error ? e.message.slice(0, 160) : e);
      }
    }
    throw err;
  } finally {
    falBusy--;
    falQueue.shift()?.();
  }
}

// A data URI (sync_mode) or, if fal ignored that, a hosted URL.
export async function bytes(url: string): Promise<Buffer> {
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(url);
  if (m) return Buffer.from(m[1], 'base64');
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`image fetch: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
