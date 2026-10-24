// Troop art. The api proxy holds the fal key and caches by description; this keeps the answer
// per tab so a second deploy of the same words lands with its sprite already on.

const API_TIMEOUT_MS = 10_000;
const urls = new Map<string, Promise<string>>();
const ready = new Map<string, string>();
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

// The sprite URL for a description, or '' if there's no key or it failed (the troop keeps its
// emoji). Never throws. Start it as soon as the words are final: it runs alongside the design.
export function spriteFor(description: string): Promise<string> {
  const key = normalise(description);
  let p = urls.get(key);
  if (!p) {
    p = request(description).then(url => {
      if (url) ready.set(key, url);
      else urls.delete(key); // try again next deploy
      return url;
    });
    urls.set(key, p);
  }
  return p;
}

// The URL if it has already arrived, else ''.
export const readySprite = (description: string) => ready.get(normalise(description)) ?? '';

async function request(description: string): Promise<string> {
  try {
    const r = await fetch('/api/sprite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const body = await r.json();
    return r.ok && typeof body.url === 'string' ? body.url : '';
  } catch {
    return ''; // api down, or no fetch base in tests
  }
}
