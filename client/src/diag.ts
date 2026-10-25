// Pipeline diagnostics in the DevTools console (Inspect → Console). Every stage of a drop reports
// under a tag, so "the troop didn't come" names the stage and the real reason:
//   [MIC] [STT] [HAND] [DESIGN] [ART] [DB] [DEPLOY] [API] [HEALTH]
// info lines only show with ?debug in the URL or localStorage.debug = 1; warnings and errors always.
// window.__diag() prints the last 20 drops and the health summary.

export type Tag = 'MIC' | 'STT' | 'HAND' | 'DESIGN' | 'ART' | 'DB' | 'DEPLOY' | 'API' | 'HEALTH';

const COLOURS: Record<Tag, string> = {
  MIC: '#d97706', STT: '#7c3aed', HAND: '#0891b2', DESIGN: '#2563eb', ART: '#db2777',
  DB: '#059669', DEPLOY: '#111827', API: '#4b5563', HEALTH: '#16a34a',
};

export const debugOn = (() => {
  try {
    if (new URLSearchParams(location.search).has('debug')) return true;
    return localStorage.getItem('debug') === '1';
  } catch {
    return false;
  }
})();

const style = (t: Tag) => `color:#fff;background:${COLOURS[t]};padding:1px 4px;border-radius:3px;font-weight:600`;

function out(level: 'info' | 'warn' | 'error', tag: Tag, msg: string, detail?: unknown) {
  if (level === 'info' && !debugOn) return;
  const args: unknown[] = [`%c${tag}%c ${msg}`, style(tag), ''];
  if (detail !== undefined) args.push(detail);
  console[level](...args);
}

export const diag = {
  info: (tag: Tag, msg: string, detail?: unknown) => out('info', tag, msg, detail),
  warn: (tag: Tag, msg: string, detail?: unknown) => out('warn', tag, msg, detail),
  error: (tag: Tag, msg: string, detail?: unknown) => out('error', tag, msg, detail),
};

// ---------- reading upstream errors ----------

// A plain-English cause for an error string from the api, a provider or the browser.
export function explain(raw: string): string {
  const s = raw || '';
  const status = Number(s.match(/\b(?:status[ =:]*|HTTP |api returned |: )?([45]\d\d)\b/)?.[1] ?? 0);
  if (/anthropic|claude|x-api-key|authentication_error/i.test(s) && (status === 401 || /authentication_error|invalid x-api-key/i.test(s))) return 'Anthropic 401 invalid key (ANTHROPIC_API_KEY is wrong or revoked)';
  const who = /fal|flux|kontext/i.test(s) ? 'fal' : /cartesia/i.test(s) ? 'Cartesia' : /gemini|cerebras|groq/i.test(s) ? s.match(/gemini|cerebras|groq/i)![0] : '';
  if (status === 401) return `${who ? `${who} ` : ''}401 unauthorised (${who === 'fal' ? 'FAL_KEY' : who === 'Cartesia' ? 'CARTESIA_API_KEY' : 'key'} is wrong or revoked)`;
  if (status === 403) return '403 forbidden (key lacks access, or the site password gate)';
  if (status === 429 || /rate.?limit|overloaded/i.test(s)) return `${status || 429} rate limited / overloaded`;
  if (status === 503 && /no [A-Z_]+/.test(s)) return `api has no key: ${s.match(/no [A-Z_]+/)![0]}`;
  if (/Unexpected end of JSON|not JSON: ?\s*$|^voice token: 5\d\d\s*$|→ 5\d\d\s*$/i.test(s)) return 'api DOWN or crashed (empty response; locally the api process is not running, on Vercel check the function logs)';
  if (/abort|timed? ?out|timeout/i.test(s)) return 'timed out';
  if (/Failed to fetch|NetworkError|ECONNREFUSED|Load failed/i.test(s)) return 'api unreachable (is the api running / deployed?)';
  if (/Unexpected token|JSON/i.test(s) && status >= 500) return `api crashed (${status})`;
  if (status >= 500) return `upstream ${status}`;
  return s.slice(0, 120) || 'unknown error';
}

// ---------- drops ----------

type Lvl = 'info' | 'warn' | 'error';
interface Step { t: number; tag: Tag; what: string; lvl: Lvl; detail?: unknown }
export interface DropRec {
  nonce: number;
  by: string;
  t0: number;
  words: string;
  steps: Step[];
  outcome: string; // '' while open
  failStage: Tag | '';
  reason: string;
  degraded: string[];
  source: string;
  ms: number;
  deployed: boolean;
  artDone: boolean;
}

const drops = new Map<number, DropRec>();
const done: DropRec[] = [];
const now = () => performance.now();

export function dropBegin(nonce: number, by: string) {
  drops.set(nonce, { nonce, by, t0: now(), words: '', steps: [], outcome: '', failStage: '', reason: '', degraded: [], source: '', ms: 0, deployed: false, artDone: false });
  dropStep(nonce, 'DEPLOY', `lock (${by})`);
}

// Open drops, newest first: partial transcripts go to the one being spoken.
const latestOpen = () => [...drops.values()].reverse().find(d => !d.words);

export function dropStep(nonce: number | null, tag: Tag, what: string, lvl: Lvl = 'info', detail?: unknown) {
  const d = nonce === null ? latestOpen() : drops.get(nonce);
  if (lvl !== 'info') {
    out(lvl, tag, d ? `#${d.nonce} ${what}` : what, detail);
    if (d && lvl === 'warn') d.degraded.push(`${tag}: ${what}`);
  }
  if (!d) return;
  d.steps.push({ t: now() - d.t0, tag, what, lvl, detail });
}

export function dropWords(nonce: number, words: string) {
  const d = drops.get(nonce);
  if (d) d.words = words;
}

export function dropDesigned(nonce: number, source: string) {
  const d = drops.get(nonce);
  if (d) d.source = source;
}

// The server took it (or refused it). The group prints once the art has settled too.
export function dropDeployed(nonce: number, ok: boolean, reason = '') {
  const d = drops.get(nonce);
  if (!d) return;
  d.ms = now() - d.t0;
  d.deployed = true;
  if (!ok) return finish(d, 'DB', reason);
  if (d.artDone) finish(d);
}

export function dropArtDone(nonce: number) {
  const d = drops.get(nonce);
  if (!d) return;
  d.artDone = true;
  if (d.deployed && d.outcome === '') finish(d);
}

export function dropFailed(nonce: number, stage: Tag, reason: string) {
  const d = drops.get(nonce);
  if (d) {
    d.ms = now() - d.t0;
    finish(d, stage, reason);
  }
}

export function dropCancelled(nonce: number, reason: string) {
  const d = drops.get(nonce);
  if (!d) return;
  d.ms = now() - d.t0;
  if (!reason) return void drops.delete(nonce); // a quick click, not an attempt
  finish(d, '', reason, 'cancelled');
}

function finish(d: DropRec, stage: Tag | '' = '', reason = '', outcome?: string) {
  drops.delete(d.nonce);
  d.failStage = stage;
  d.reason = reason;
  d.outcome = outcome ?? (stage ? 'FAILED' : 'ok');
  const secs = (d.ms / 1000).toFixed(1);
  let head = `[DEPLOY] #${d.nonce} "${d.words || '…'}" → `;
  if (d.outcome === 'FAILED') head += `FAILED at ${stage}: ${reason}`;
  else if (d.outcome === 'cancelled') head += `cancelled: ${reason}`;
  else head += `ok ${secs}s${d.source ? ` (${d.source})` : ''}`;
  if (d.outcome === 'ok' && d.degraded.length) head += ` · DEGRADED ${d.degraded[0]}`;
  done.push(d);
  if (done.length > 20) done.shift();
  const quiet = d.outcome === 'ok' && !d.degraded.length;
  if (quiet && !debugOn) return;
  if (d.outcome === 'FAILED') console.error(head);
  else if (!quiet) console.warn(head);
  console.groupCollapsed(head);
  for (const s of d.steps) {
    const line = `%c${s.tag}%c +${Math.round(s.t)}ms ${s.what}`;
    const args: unknown[] = [line, style(s.tag), ''];
    if (s.detail !== undefined) args.push(s.detail);
    console[s.lvl](...args);
  }
  console.groupEnd();
}

// ---------- health ----------

export const health: Record<string, string> = {};

export function healthSet(key: string, value: string, lvl: Lvl = 'info', tag: Tag = 'HEALTH') {
  health[key] = value;
  out(lvl, tag, `${key}: ${value}`);
}

declare global {
  interface Window { __diag: () => void }
}

const show = () => {
  console.log('%cHEALTH', style('HEALTH'));
  console.table(health);
  console.log('%cLAST DROPS', style('DEPLOY'));
  console.table(done.map(d => ({
    nonce: d.nonce, words: d.words, outcome: d.outcome, ms: Math.round(d.ms), source: d.source,
    failedAt: d.failStage, reason: d.reason, degraded: d.degraded.join(' | '),
  })));
  const open = [...drops.values()];
  if (open.length) console.log('open drops:', open.map(d => `#${d.nonce} ${d.steps.at(-1)?.what ?? ''}`));
};

if (typeof window !== 'undefined') window.__diag = show;
