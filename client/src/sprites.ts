import { keyBackground } from './chroma';

// Troop art requests. The api draws, cuts out and caches the sprite (api/sprites.ts) and answers
// with a short same-origin URL that fits the troop row's spriteUrl. Art is slower than stats
// (FLUX 1.4–3 s plus removal) and isn't needed to fight, so units keep their placeholder token
// until it lands; it starts as early as the designer does, on the partial transcript.

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

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
    requests.set(key, p);
  }
  return p;
}

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
    if (!r.ok || !body.url) throw new Error(body.error ?? `api returned ${r.status}`);
    return String(body.url);
  } catch (e) {
    console.warn('sprite failed, keeping the placeholder:', (e as Error).message);
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

// Attack-pose frames (motion layer 2, api/poses.ts): the base sprite redrawn mid-attack from the
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
      img.onload = () => (e.out = shrink(img, /[?&]key\b/.test(url)));
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
    console.warn('pose failed, keeping the base sprite:', (e as Error).message);
    return null;
  }
}

// Down to sprite size (the edit model answers at about 1 MP), keying the background if asked.
function shrink(img: HTMLImageElement, key: boolean): CanvasImageSource {
  const c = document.createElement('canvas');
  const k = Math.min(1, POSE_PX / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d', { willReadFrequently: key });
  if (!g) return img;
  g.drawImage(img, 0, 0, c.width, c.height);
  if (key) {
    try {
      const px = g.getImageData(0, 0, c.width, c.height);
      keyBackground(px.data, c.width, c.height);
      g.putImageData(px, 0, 0);
    } catch {
      // tainted after all: better a square than nothing
    }
  }
  return c;
}
