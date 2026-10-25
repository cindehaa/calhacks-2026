// Startup health check, printed once under [HEALTH] (and kept for window.__diag()).
import { diag, explain, healthSet } from './diag';

// Every reducer the client calls; a module on the server missing one is stale.
const REDUCERS = Object.keys(import.meta.glob('./module_bindings/*_reducer.ts')).map(p => p.replace(/^.*\//, '').replace(/_reducer\.ts$/, ''));

async function api(): Promise<void> {
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    let b: Record<string, unknown> = {};
    try { b = JSON.parse(text); } catch { /* not JSON: the dev server's index.html, or a crash page */ }
    if (!r.ok || !('keys' in b)) {
      healthSet('api', `NOT reachable or old: GET /api/health → ${r.status} ${text.slice(0, 120).replace(/\s+/g, ' ') || explain(`→ ${r.status}`)}`, 'error', 'API');
      return;
    }
    healthSet('api', `reachable (${r.status})`, 'info', 'API');
    const keys = b.keys as Record<string, boolean>;
    const missing = Object.entries(keys).filter(([, v]) => !v).map(([k]) => k);
    healthSet('api keys', Object.entries(keys).map(([k, v]) => `${k}=${v}`).join(' '), missing.length ? 'warn' : 'info', 'API');
    const a = String(b.anthropicCheck ?? '');
    if (a === 'ok') healthSet('anthropic key', 'ok (1-token check passed)', 'info', 'DESIGN');
    else if (a === 'skipped') healthSet('anthropic key', `not checked (designer is ${b.designer})`, 'info', 'DESIGN');
    else healthSet('anthropic key', `FAILING (${a}) → every troop will be an offline/improvised design. ${explain(a)}`, 'error', 'DESIGN');
  } catch (e) {
    healthSet('api', `NOT reachable: ${explain((e as Error).message)} (${(e as Error).message})`, 'error', 'API');
  }
}

async function cartesia(): Promise<void> {
  try {
    const r = await fetch('/api/voice-token', { method: 'POST', signal: AbortSignal.timeout(8000) });
    const body = await r.text();
    if (r.ok) return healthSet('cartesia token', `ok (${r.status})`, 'info', 'STT');
    let msg = body;
    try { const j = JSON.parse(body); msg = `${j.error ?? ''}${j.status ? ` (upstream ${j.status}: ${j.message ?? ''})` : ''}`; } catch { /* raw */ }
    healthSet('cartesia token', `FAILING ${r.status}: ${msg.slice(0, 200) || explain(`→ ${r.status}`)} → voice falls back to browser speech`, r.status === 503 ? 'warn' : 'error', 'STT');
  } catch (e) {
    healthSet('cartesia token', `FAILING: ${explain((e as Error).message)}`, 'error', 'STT');
  }
}

async function mic(): Promise<void> {
  try {
    const [m, c] = await Promise.all(['microphone', 'camera'].map(n => navigator.permissions.query({ name: n as PermissionName }).then(p => p.state, () => 'unknown')));
    const devs = await navigator.mediaDevices.enumerateDevices();
    const name = devs.find(d => d.kind === 'audioinput' && d.label)?.label ?? (devs.some(d => d.kind === 'audioinput') ? '(name hidden until permission)' : 'NO microphone found');
    healthSet('mic', `permission ${m}, device ${name}`, m === 'denied' || name.startsWith('NO') ? 'error' : 'info', 'MIC');
    const cam = devs.some(d => d.kind === 'videoinput');
    healthSet('camera', `permission ${c}, ${cam ? 'device present' : 'NO camera found'} (ready once the hand tracker starts)`, c === 'denied' || !cam ? 'warn' : 'info', 'HAND');
  } catch (e) {
    healthSet('mic', `could not query: ${(e as Error).message}`, 'warn', 'MIC');
  }
}

// Does the published module have every reducer this client calls? Asks the SpacetimeDB HTTP api.
export async function checkModule(host: string, db: string): Promise<void> {
  const http = host.replace(/^ws/, 'http');
  try {
    const r = await fetch(`${http}/v1/database/${db}/schema?version=9`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return healthSet('db module', `schema fetch ${r.status}: ${(await r.text()).slice(0, 120)}`, 'warn', 'DB');
    const schema = await r.json();
    const have = new Set<string>((schema.reducers ?? []).map((x: { name: string }) => x.name));
    const missing = REDUCERS.filter(n => !have.has(n));
    if (missing.length) {
      const where = http.includes('maincloud') ? 'Maincloud' : 'local';
      const pub = where === 'Maincloud' ? `spacetime publish --module-path server --server maincloud ${db} -y` : 'npm run db:publish';
      healthSet('db module', `${where} module is missing ${missing.join(', ')} — run ${pub}`, 'error', 'DB');
    } else healthSet('db module', `has all ${REDUCERS.length} reducers the client calls`, 'info', 'DB');
  } catch (e) {
    healthSet('db module', `could not read schema: ${(e as Error).message}`, 'warn', 'DB');
  }
}

let ran = false;
export function runHealthCheck(): void {
  if (ran) return;
  ran = true;
  void Promise.allSettled([api(), cartesia(), mic()]).then(() => {
    diag.info('HEALTH', 'startup check done — window.__diag() prints the summary');
  });
}
