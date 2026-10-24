// Key proxy: the browser calls these routes, so API keys never reach it.
// Vite proxies /api here in dev (client/vite.config.ts).
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ANCHORS } from '../shared/anchors';
import { designTroop, designerName, hasKey, warm } from './designer';
import { hasFalKey, spriteFor } from './sprites';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.API_PORT ?? 8787);

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64_000) throw new Error('body too large');
  }
  return body ? JSON.parse(body) : {};
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/troop') {
      const { description } = await readJson(req);
      const text = String(description ?? '').slice(0, 300);
      return send(res, 200, await designTroop(text));
    }
    if (req.method === 'POST' && req.url === '/api/sprite') {
      const { description } = await readJson(req);
      return send(res, 200, await spriteFor(String(description ?? '').slice(0, 300)));
    }
    if (req.method === 'POST' && req.url === '/api/warm') {
      return send(res, 200, await warm());
    }
    send(res, 404, { error: 'not found' });
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
