// Cartesia websocket URLs for the browser. The api mints a 60 s access token (the key stays in
// api/), and a token is only checked when a socket opens, so one is reused until close to expiry.

let cached: { token: string; version: string; until: number } | null = null;
let unavailableUntil = 0; // after a 503 (no key) or failure, don't ask again for a while

// Null when Cartesia can't be used (no key in .env, api down); callers fall back.
export async function cartesiaUrl(path: '/stt/websocket' | '/tts/websocket', params: Record<string, string> = {}): Promise<string | null> {
  const now = Date.now();
  if (!cached || cached.until < now) {
    if (now < unavailableUntil) return null;
    try {
      const r = await fetch('/api/voice-token', { method: 'POST' });
      if (!r.ok) throw new Error(`voice token: ${r.status}`);
      const b = await r.json();
      cached = { token: b.token, version: b.version, until: now + (b.expiresIn - 10) * 1000 };
    } catch (e) {
      console.warn('Cartesia unavailable:', (e as Error).message);
      unavailableUntil = now + 30_000;
      return null;
    }
  }
  const u = new URL(`wss://api.cartesia.ai${path}`);
  u.searchParams.set('cartesia_version', cached.version);
  u.searchParams.set('access_token', cached.token);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// Resolves with the socket once it's open, or null if it fails or takes longer than timeoutMs.
export function openSocket(url: string, timeoutMs = 4000): Promise<WebSocket | null> {
  return new Promise(res => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      ws.close();
      res(null);
    }, timeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      res(ws);
    };
    ws.onerror = ws.onclose = () => {
      clearTimeout(timer);
      res(null);
    };
  });
}
