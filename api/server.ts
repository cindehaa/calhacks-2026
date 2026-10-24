// Key proxy: the browser calls these routes, so API keys never reach it.
// Vite proxies /api here in dev (client/vite.config.ts).
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hasCartesiaKey, voiceToken } from './cartesia';
import { designTroop, designerName, hasKey, warm } from './designer';
import { hasFalKey, sprite, spriteFile } from './sprites';

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
    if (req.method === 'POST' && req.url === '/api/warm') {
      return send(res, 200, await warm());
    }
    // A 60 s Cartesia token for the browser's STT and TTS sockets. 503 means use the fallbacks.
    if (req.method === 'POST' && req.url === '/api/voice-token') {
      if (!hasCartesiaKey()) return send(res, 503, { error: 'no CARTESIA_API_KEY' });
      try {
        return send(res, 200, await voiceToken());
      } catch (e) {
        console.warn(e instanceof Error ? e.message : e);
        return send(res, 502, { error: 'cartesia token failed' });
      }
    }
    if (req.method === 'POST' && req.url === '/api/sprite') {
      if (!hasFalKey()) return send(res, 503, { error: 'no FAL_KEY' });
      const { description } = await readJson(req);
      const text = String(description ?? '').trim().slice(0, 300);
      if (!text) return send(res, 400, { error: 'empty description' });
      try {
        return send(res, 200, await sprite(text));
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 160) : String(e);
        console.warn('sprite failed:', msg);
        return send(res, 502, { error: 'sprite failed' });
      }
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/sprite/')) {
      const png = await spriteFile(req.url.slice('/api/sprite/'.length).split('?')[0]);
      if (!png) return send(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable', // the name is a hash of the prompt
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(png);
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
  console.log(`api on http://localhost:${PORT} (designer: ${hasKey() ? designerName() : `offline, no key for ${designerName()}`})`);
  console.log(`voice: ${hasCartesiaKey() ? 'Cartesia' : 'no CARTESIA_API_KEY, browser speech and no cries'} · sprites: ${hasFalKey() ? 'fal' : 'no FAL_KEY, placeholder tokens'}`);
});
