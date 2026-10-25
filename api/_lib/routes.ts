// The api's routes, shared by the Vercel functions (api/*.ts) and the local server (api/_dev.ts).
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { hasCartesiaKey, voiceToken } from './cartesia.js';
import { designTroop, warm } from './designer.js';
import { pose, poseFile } from './poses.js';
import { hasFalKey, sprite, spriteFile } from './sprites.js';

type Body = Record<string, unknown>;
const text = (b: Body) => String(b.description ?? '').slice(0, 300);

// A refusal with its own status: 503 is "no key, use the fallbacks", 502 an upstream failure.
// Anything else a route throws is a bad request body (400).
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function needKey(has: boolean, name: string) {
  if (!has) throw new HttpError(503, `no ${name}`);
}

function described(b: Body): string {
  const t = text(b).trim();
  if (!t) throw new HttpError(400, 'empty description');
  return t;
}

async function upstream<T>(what: string, f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    console.warn(`${what} failed:`, e instanceof Error ? e.message.slice(0, 160) : e);
    throw new HttpError(502, `${what} failed`);
  }
}

export const ROUTES: Record<string, (body: Body) => Promise<unknown>> = {
  '/api/troop': b => designTroop(text(b)),
  '/api/warm': () => warm(),
  // A 60 s Cartesia token for the browser's STT socket.
  '/api/voice-token': async () => {
    needKey(hasCartesiaKey(), 'CARTESIA_API_KEY');
    return upstream('cartesia token', voiceToken);
  },
  '/api/sprite': async b => {
    needKey(hasFalKey(), 'FAL_KEY');
    const d = described(b);
    return upstream('sprite', () => sprite(d));
  },
  // Attack-pose frame: the base sprite redrawn mid-attack from the troop's flavor (poses.ts).
  '/api/pose': async b => {
    needKey(hasFalKey(), 'FAL_KEY');
    const d = described(b);
    return upstream('pose', () => pose(d, String(b.flavor ?? '').slice(0, 120)));
  },
  // A client token for one gameplay recording (client/src/recorder.ts): the browser uploads the
  // video straight to Blob, since a function body can't be over 4.5 MB.
  '/api/recording': async b => {
    needKey(!!process.env.BLOB_READ_WRITE_TOKEN, 'BLOB_READ_WRITE_TOKEN');
    const payload = (b.payload ?? {}) as Body;
    const pathname = String(payload.pathname ?? '');
    if (b.type !== 'blob.generate-client-token' || !/^recordings\/[\w/-]+\.(webm|mp4)$/.test(pathname)) throw new HttpError(400, 'bad recording request');
    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      allowedContentTypes: ['video/webm', 'video/mp4'],
      maximumSizeInBytes: 300 * 1024 * 1024,
      addRandomSuffix: true,
      validUntil: Date.now() + 60 * 60 * 1000,
    });
    return { type: 'blob.generate-client-token', clientToken };
  },
};

// The PNG a GET for /api/sprite/<name> or /api/pose/<name> asks for, or null. On Vercel the
// rewrites in vercel.json pass the name as ?name=, and the PNG comes from the Blob store, so any
// instance can serve it (without a store, only the instance that drew it can).
export async function png(url: URL): Promise<Buffer | null> {
  const [, , kind, rest] = url.pathname.split('/'); // '', 'api', 'sprite' | 'pose', name
  const name = url.searchParams.get('name') ?? rest ?? '';
  const read = kind === 'sprite' ? spriteFile : kind === 'pose' ? poseFile : null;
  return read ? read(name) : null;
}

export function parseBody(raw: string): Body {
  if (raw.length > 64_000) throw new Error('body too large');
  return raw ? JSON.parse(raw) : {};
}

export const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
// The name is a hash of the prompt, so a PNG never changes.
export const PNG_HEADERS = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' };

// What a route's failure answers with; bad bodies are logged, refusals already were (or are expected).
export function failure(url: string, e: unknown): { status: number; error: string } {
  if (e instanceof HttpError) return { status: e.status, error: e.message };
  const error = e instanceof Error ? e.message.slice(0, 200) : String(e);
  console.error(url, error);
  return { status: 400, error };
}

// Web-standard handler for the Vercel functions.
export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const file = await png(url);
    if (!file) return Response.json({ error: 'not found' }, { status: 404, headers: HEADERS });
    return new Response(new Uint8Array(file), { headers: PNG_HEADERS });
  }
  const route = ROUTES[url.pathname];
  if (!route) return Response.json({ error: 'not found' }, { status: 404, headers: HEADERS });
  try {
    return Response.json(await route(parseBody(await req.text())), { headers: HEADERS });
  } catch (e) {
    const { status, error } = failure(req.url, e);
    return Response.json({ error }, { status, headers: HEADERS });
  }
}
