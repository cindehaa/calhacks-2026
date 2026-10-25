// The api's routes, shared by the Vercel functions (api/*.ts) and the local server (api/_dev.ts).
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { hasCartesiaKey, voiceToken } from './cartesia.js';
import { designTroop, designerName, warm } from './designer.js';
import { pose, poseFile } from './poses.js';
import { hasFalKey, sprite, spriteFile } from './sprites.js';

type Body = Record<string, unknown>;
const text = (b: Body) => String(b.description ?? '').slice(0, 300);

// A refusal with its own status: 503 is "no key, use the fallbacks", 502 an upstream failure.
// Anything else a route throws is a bad request body (400).
export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly info: { stage?: string; upstream?: number; detail?: string } = {}) {
    super(message);
  }
}

// Never let a key value reach a response or a log line.
export function scrub(s: string): string {
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CARTESIA_API_KEY', 'FAL_KEY', 'FAL_KEY_FALLBACK', 'BLOB_READ_WRITE_TOKEN', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'GROQ_API_KEY']) {
    const v = (process.env[k] ?? '').trim();
    if (v.length >= 8) s = s.split(v).join('***');
  }
  return s.replace(/\b(sk-ant-[\w-]{6})[\w-]+/g, '$1***');
}

// The upstream HTTP status and a short message from any provider error (Anthropic SDK, fetch, ours).
export function upstreamInfo(e: unknown): { status: number; message: string } {
  const any = e as { status?: number; error?: { error?: { message?: string } }; message?: string };
  const raw = e instanceof Error ? e.message : String(e);
  const status = typeof any?.status === 'number' ? any.status : Number(raw.match(/\b([45]\d\d)\b/)?.[1] ?? 0);
  const inner = any?.error?.error?.message ?? raw.match(/"message"\s*:\s*"([^"]+)"/)?.[1];
  const message = scrub((inner ?? raw).replace(/\s+/g, ' ')).slice(0, 200);
  return { status, message };
}

function needKey(has: boolean, name: string, stage: string) {
  if (!has) throw new HttpError(503, `no ${name}`, { stage, detail: `${name} is not set on the api` });
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
    const { status, message } = upstreamInfo(e);
    console.error(`[api] stage=${what} upstream=${status || '-'} ${message}`);
    throw new HttpError(502, `${what} failed${status ? ` (upstream ${status})` : ''}: ${message}`, { stage: what, upstream: status, detail: message });
  }
}

export const ROUTES: Record<string, (body: Body) => Promise<unknown>> = {
  '/api/troop': b => designTroop(text(b), b.spell === true),
  '/api/warm': () => warm(),
  // A 60 s Cartesia token for the browser's STT socket.
  '/api/voice-token': async () => {
    needKey(hasCartesiaKey(), 'CARTESIA_API_KEY', 'cartesia token');
    return upstream('cartesia token', voiceToken);
  },
  '/api/sprite': async b => {
    needKey(hasFalKey(), 'FAL_KEY', 'sprite');
    const d = described(b);
    return upstream('sprite', () => sprite(d));
  },
  // Attack-pose frame: the base sprite redrawn mid-attack from the troop's flavor (poses.ts).
  '/api/pose': async b => {
    needKey(hasFalKey(), 'FAL_KEY', 'pose');
    const d = described(b);
    return upstream('pose', () => pose(d, String(b.flavor ?? '').slice(0, 120)));
  },
  // A client token for one gameplay recording (client/src/recorder.ts): the browser uploads the
  // video straight to Blob, since a function body can't be over 4.5 MB.
  '/api/recording': async b => {
    needKey(!!process.env.BLOB_READ_WRITE_TOKEN, 'BLOB_READ_WRITE_TOKEN', 'recording');
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
// The JSON body carries stage, upstream status and a short message for the browser console.
export function failure(url: string, e: unknown): { status: number; error: string; body: Record<string, unknown> } {
  if (e instanceof HttpError) {
    if (e.status === 503) console.warn(`[api] ${url} stage=${e.info.stage ?? '-'} ${e.message}`);
    return { status: e.status, error: e.message, body: { error: e.message, stage: e.info.stage ?? 'api', status: e.info.upstream ?? e.status, message: e.info.detail ?? e.message } };
  }
  const error = scrub(e instanceof Error ? e.message.slice(0, 200) : String(e));
  console.error(`[api] ${url} stage=request 400 ${error}`);
  return { status: 400, error, body: { error, stage: 'request', status: 400, message: error } };
}

// GET /api/health: which keys are configured (booleans only, never values) and a 1-token check
// of the Anthropic key. Cached for 30 s so a reload loop can't burn tokens.
let healthCache: { at: number; body: Record<string, unknown> } | null = null;
export async function healthReport(): Promise<Record<string, unknown>> {
  if (healthCache && Date.now() - healthCache.at < 30_000) return healthCache.body;
  const env = (k: string) => !!(process.env[k] ?? '').trim();
  const keys = { anthropic: env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN'), cartesia: hasCartesiaKey(), fal: hasFalKey(), blob: env('BLOB_READ_WRITE_TOKEN') };
  const name = designerName();
  let anthropicCheck = 'skipped';
  if (keys.anthropic) {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      await new Anthropic({ maxRetries: 0 }).messages.create(
        { model: (process.env.CLAUDE_MODEL ?? '').trim() || 'claude-haiku-5-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] },
        { timeout: 6000 }
      );
      anthropicCheck = 'ok';
    } catch (e) {
      const { status, message } = upstreamInfo(e);
      anthropicCheck = `anthropic ${status || 'error'}: ${message}`;
      console.error(`[api] stage=health-anthropic upstream=${status || '-'} ${message}`);
    }
  } else anthropicCheck = 'anthropic: no ANTHROPIC_API_KEY';
  const body = { ok: anthropicCheck === 'ok', keys, anthropicCheck, designer: name, at: new Date().toISOString() };
  healthCache = { at: Date.now(), body };
  return body;
}

// Web-standard handler for the Vercel functions.
export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/api/health') return Response.json(await healthReport(), { headers: HEADERS });
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
    const { status, body } = failure(req.url, e);
    return Response.json(body, { status, headers: HEADERS });
  }
}
