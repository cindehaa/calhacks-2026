// The api's routes, shared by the Vercel functions (api/*.ts) and the local server (api/_dev.ts).
import { designTroop, warm } from './designer.js';
import { spriteFor } from './sprites.js';

type Body = Record<string, unknown>;
const text = (b: Body) => String(b.description ?? '').slice(0, 300);

export const ROUTES: Record<string, (body: Body) => Promise<unknown>> = {
  '/api/troop': b => designTroop(text(b)),
  '/api/sprite': b => spriteFor(text(b)),
  '/api/warm': () => warm(),
};

export function parseBody(raw: string): Body {
  if (raw.length > 64_000) throw new Error('body too large');
  return raw ? JSON.parse(raw) : {};
}

export const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

// Web-standard handler for the Vercel functions.
export async function handle(req: Request): Promise<Response> {
  const route = ROUTES[new URL(req.url).pathname];
  if (!route) return Response.json({ error: 'not found' }, { status: 404, headers: HEADERS });
  try {
    return Response.json(await route(parseBody(await req.text())), { headers: HEADERS });
  } catch (e) {
    // Designing never throws (it falls back to offline), so this is a bad request body.
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
    console.error(req.url, msg);
    return Response.json({ error: msg }, { status: 400, headers: HEADERS });
  }
}
