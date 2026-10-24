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
