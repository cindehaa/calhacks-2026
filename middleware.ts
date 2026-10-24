// Password gate for the deployed site (Vercel Routing Middleware; local dev isn't gated).
// The password lives only in the SITE_PASSWORD env var on Vercel. The cookie holds a hash of it,
// so it can't be forged without the password, and changing the password signs everyone out.
import { next } from '@vercel/functions';

export const config = { matcher: '/:path*' };

const COOKIE = 'arena_gate';
const LOGIN = '/__gate';
const MAX_AGE = 30 * 24 * 3600;

async function hash(password: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`arena-gate:${password}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Same work whatever the input, so timing doesn't leak how close a guess was.
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookie(req: Request, name: string): string {
  const c = req.headers.get('cookie')?.split(/;\s*/).find(c => c.startsWith(`${name}=`));
  return c?.slice(name.length + 1) ?? '';
}

export default async function middleware(req: Request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return page('Locked.', 503); // fail closed if the env var goes missing
  const expected = await hash(password);
  if (req.method === 'POST' && new URL(req.url).pathname === LOGIN) {
    const guess = String((await req.formData()).get('password') ?? '');
    if (!equal(await hash(guess), expected)) return page('Wrong password.', 401);
    return new Response(null, {
      status: 303,
      headers: { Location: '/', 'Set-Cookie': `${COOKIE}=${expected}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax` },
    });
  }
  if (equal(cookie(req, COOKIE), expected)) return next();
  return page('', 401);
}

// Self-contained, in the menu's warm-gold-on-frozen-night look (meta/aesthetics.md).
function page(error: string, status: number): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Abracadabra</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya+Sans:wght@500;700&family=Cinzel+Decorative:wght@700&display=swap">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(ellipse at 50% 30%, #141a36, #05060c 70%); color: #e8ebf5; font-family: 'Alegreya Sans', system-ui, sans-serif; }
  form { display: grid; gap: 14px; width: min(320px, calc(100vw - 32px)); text-align: center; }
  h1 { margin: 0 0 14px; font: 700 64px/1.05 'Cinzel Decorative', Georgia, serif; letter-spacing: .08em; background: linear-gradient(180deg, #ffd27a 0 50%, #ffb02e 50% 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 4px 0 #8a4a00) drop-shadow(0 3px 0 #000) drop-shadow(0 0 24px #ff8a2e55); }
  input, button { font: inherit; font-size: 17px; font-weight: 700; padding: 13px 14px; border: 0; clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); }
  input { background: #10152c; border-bottom: 4px solid #2a3266; color: inherit; outline: none; }
  input:focus { border-bottom-color: #ffb02e; }
  button { background: linear-gradient(160deg, #ffb02e 0 56%, #f39200 56% 100%); border-bottom: 5px solid #8a4a00; color: #1a0e00; letter-spacing: .12em; text-transform: uppercase; cursor: pointer; }
  p { margin: 0; min-height: 1.2em; color: #ff7a86; font-size: 15px; }
</style></head>
<body><form method="post" action="${LOGIN}">
  <h1>Abracadabra</h1>
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
  <button>Enter</button>
  <p>${error}</p>
</form></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
