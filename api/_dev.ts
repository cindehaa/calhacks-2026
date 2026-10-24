// Local key proxy: the browser calls these routes, so API keys never reach it.
// Vite proxies /api here in dev (client/vite.config.ts); on Vercel, api/*.ts serve the same routes.
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ANCHORS } from '../shared/anchors.js';
import { designerName, hasKey } from './_lib/designer.js';
import { HEADERS, ROUTES, parseBody } from './_lib/routes.js';
import { hasFalKey, spriteFor } from './_lib/sprites.js';

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
  const route = req.method === 'POST' ? ROUTES[req.url ?? ''] : undefined;
  if (!route) return send(res, 404, { error: 'not found' });
  try {
    send(res, 200, await route(parseBody(await readBody(req))));
  } catch (e) {
    // Designing never throws (it falls back to offline), so this is a bad request body.
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
    console.error(req.url, msg);
    send(res, 400, { error: msg });
  }
});

server.listen(PORT, () => {
  console.log(`api on http://localhost:${PORT} (designer: ${hasKey() ? designerName() : `offline, no key for ${designerName()}`}; sprites: ${hasFalKey() ? 'fal' : 'off, no FAL_KEY'})`);
  // Anchor art is ready before anyone presses 1-0; cached after the first run.
  for (const a of ANCHORS) spriteFor(a.description);
});
