import { normalise } from '../../shared/troop';
import { toCanvas } from './render';
import { diag, explain } from './diag';

// Troop art requests. The api draws, cuts out and caches the sprite (api/_lib/sprites.ts) and answers
// with a short same-origin URL that fits the troop row's spriteUrl. Art is slower than stats
// (FLUX 1.4–3 s plus removal) and isn't needed to fight, so units keep their placeholder token
// until it lands; it starts as early as the designer does, on the partial transcript.

// One request per normalised description for the whole session, including failures (null), so a
// troop deployed twice, or a description that broke fal, never costs twice.
const requests = new Map<string, Promise<string | null>>();
let off = false; // the api has no FAL_KEY: stop asking

export function requestSprite(description: string): Promise<string | null> {
  const key = normalise(description);
  if (!key || off) return Promise.resolve(null);
  let p = requests.get(key);
  if (!p) {
    p = fetchSprite(description);
    p.then(url => { if (!url) failed.add(key) });
    requests.set(key, p);
  }
  return p;
}

// Art that won't come (the request failed, or the api has no art): the board draws an inked
// sketch instead of the plain token, so it looks deliberate rather than still loading.
const failed = new Set<string>();
export function spriteFailed(description: string | undefined): boolean {
  if (!description) return false;
  return off || failed.has(normalise(description));
}

// Why a sprite failed, by normalised description, for the drop's console group.
const artErrors = new Map<string, string>();
export const spriteError = (description: string) => artErrors.get(normalise(description)) ?? '';

async function fetchSprite(description: string): Promise<string | null> {
  try {
    const r = await fetch('/api/sprite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 503) off = true;
    const body = await r.json();
    if (!r.ok || !body.url) throw new Error(`${body.error ?? 'no url'} (api returned ${r.status}${body.status ? `, upstream ${body.status}` : ''}${body.message ? `: ${body.message}` : ''})`);
    return String(body.url);
  } catch (e) {
    const m = (e as Error).name === 'TimeoutError' ? 'timed out after 15 s' : (e as Error).message;
    artErrors.set(normalise(description), m);
    diag.warn('ART', `sprite for "${description}" failed, keeping the placeholder: ${explain(m)}`, m);
    return null;
  }
}

// Words heard so far. Stricter than the designer (3 words, 500 ms settled), since a wasted image
// costs more than a wasted design and the art can land after the troop anyway. Cartesia sends
// words one at a time, so a looser rule drew "a giant", "a giant fire"… on the way.
const PAUSE_MS = 500;
const MIN_WORDS = 3;
let timer: ReturnType<typeof setTimeout> | undefined;

export function prefetchSprite(words: string): void {
  clearTimeout(timer);
  if (normalise(words).split(' ').length < MIN_WORDS) return;
  timer = setTimeout(() => void requestSprite(words), PAUSE_MS);
}

// Attack-pose frames (motion layer 2, api/_lib/poses.ts): the base sprite redrawn mid-attack from the
// troop's flavor. poseFrame is safe to call every frame: the first call starts the request, and it
// returns null until the image has loaded (and failures stay null), so the renderer keeps the
// base sprite meanwhile. The frame comes back at 384 px, keyed here if the api's cut-out timed out.
const POSE_PX = 384;
const poses = new Map<string, { out: CanvasImageSource | null }>();

export function poseFrame(description: string, flavor = ''): CanvasImageSource | null {
  const key = `${normalise(description)}|${normalise(flavor)}`;
  if (!normalise(description) || off) return null;
  let entry = poses.get(key);
  if (!entry) {
    const e: { out: CanvasImageSource | null } = { out: null };
    poses.set(key, (entry = e));
    void fetchPose(description, flavor).then((url) => {
      if (!url) return;
      const img = new Image();
      img.crossOrigin = 'anonymous'; // the api sends CORS headers; keeps the canvas readable
      img.onload = () => (e.out = toCanvas(img, /[?&]key\b/.test(url), POSE_PX)); // the edit model answers at about 1 MP
      img.src = url;
    });
  }
  return entry.out;
}

async function fetchPose(description: string, flavor: string): Promise<string | null> {
  try {
    const r = await fetch('/api/pose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, flavor }),
      signal: AbortSignal.timeout(40_000), // base sprite plus the edit, if neither is cached
    });
    if (r.status === 503) off = true;
    const body = await r.json();
    if (!r.ok || !body.url) throw new Error(body.error ?? `api returned ${r.status}`);
    return String(body.url);
  } catch (e) {
    diag.warn('ART', `pose for "${description}" failed, keeping the base sprite: ${explain((e as Error).message)}`, (e as Error).message);
    return null;
  }
}
