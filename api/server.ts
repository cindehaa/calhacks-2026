// Key proxy: the browser calls these routes, so API keys never reach it.
// Vite proxies /api here in dev (client/vite.config.ts).
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { designTroop } from './designer';

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

function errorMessage(e: unknown): string {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return 'no Anthropic key: set ANTHROPIC_API_KEY in .env';
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic key missing or invalid (set ANTHROPIC_API_KEY in .env)';
  if (e instanceof Anthropic.RateLimitError) return 'rate limited, try again';
  if (e instanceof Anthropic.APIError) return `Anthropic ${e.status ?? ''} ${e.message}`.slice(0, 200);
  return e instanceof Error ? e.message.slice(0, 200) : String(e);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/troop') {
      const { description } = await readJson(req);
      const text = String(description ?? '').slice(0, 300);
      return send(res, 200, await designTroop(text));
    }
    if (req.method === 'POST' && req.url === '/api/warm') {
      // The first call per model is slow (schema compile); pay it at match start.
      const t0 = performance.now();
      await designTroop('warm up');
      return send(res, 200, { ms: Math.round(performance.now() - t0) });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    const msg = errorMessage(e);
    console.error(req.url, msg);
    send(res, 502, { error: msg });
  }
});

server.listen(PORT, () => console.log(`api on http://localhost:${PORT}`));
