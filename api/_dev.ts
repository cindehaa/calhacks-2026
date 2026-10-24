// Local key proxy: the browser calls these routes, so API keys never reach it.
// Vite proxies /api here in dev (client/vite.config.ts); on Vercel, api/*.ts serve the same routes.
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ANCHORS } from '../shared/anchors.js';
import { hasCartesiaKey } from './_lib/cartesia.js';
import { designerName, hasKey } from './_lib/designer.js';
import { HEADERS, PNG_HEADERS, ROUTES, failure, parseBody, png } from './_lib/routes.js';
import { hasFalKey, sprite } from './_lib/sprites.js';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.API_PORT ?? 8787);

async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64_000) throw new Error('body too large');
  }
  return body;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, HEADERS);
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (req.method === 'GET') {
    const file = await png(url);
    if (!file) return send(res, 404, { error: 'not found' });
    res.writeHead(200, PNG_HEADERS);
    return res.end(file);
  }
  const route = req.method === 'POST' ? ROUTES[url.pathname] : undefined;
  if (!route) return send(res, 404, { error: 'not found' });
  try {
    send(res, 200, await route(parseBody(await readBody(req))));
  } catch (e) {
    const { status, error } = failure(req.url ?? '', e);
    send(res, status, { error });
  }
});

server.listen(PORT, () => {
  console.log(`api on http://localhost:${PORT} (designer: ${hasKey() ? designerName() : `offline, no key for ${designerName()}`})`);
  console.log(`voice: ${hasCartesiaKey() ? 'Cartesia' : 'no CARTESIA_API_KEY, browser speech'} · sprites: ${hasFalKey() ? 'fal' : 'no FAL_KEY, placeholder tokens'}`);
  // Anchor art is ready before anyone presses 1-0; kept on disk after the first run.
  if (hasFalKey()) for (const a of ANCHORS) sprite(a.description).catch(e => console.warn(`anchor sprite "${a.description}" failed:`, e instanceof Error ? e.message.slice(0, 160) : e));
});
