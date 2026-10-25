import { designOfflineAny } from '../../shared/offline_spell';
import { normalise, price, type TroopDesign } from '../../shared/troop';
import { diag, explain } from './diag';

export interface Designed {
  design: TroopDesign;
  cost: number;
  ms: number;
  source: string; // 'offline', or the model backend that designed it
  early?: boolean; // reused a design started on the partial transcript
  apiMs?: number; // the designer's own time inside the api
  model?: string;
  prompt?: string; // system prompt hash
  raw?: string; // the model's answer before clamping
  error?: string; // why the model wasn't used
}

// The api itself gives up on Claude at 4.5 s and answers offline; this is the backstop for an
// api that is down or stuck, so a deploy never waits longer than this.
const API_TIMEOUT_MS = 7000;

function offline(description: string, t0: number, error: string, spellOnly: boolean): Designed {
  const design = designOfflineAny(description, spellOnly);
  return { design, cost: price(design), ms: Math.round(performance.now() - t0), source: 'offline', error };
}

// Your troops the offline designer made (the model was slow, erroring or unreachable), so the
// board can mark them "improvised": a plain troop then reads as intended, not broken.
const improvisedSet = new Set<string>();
export function improvised(description: string | undefined): boolean {
  return !!description && improvisedSet.has(normalise(description));
}

// Designs started while the player is still talking, keyed by normalised words (and whether the
// aim was past their zone, which makes it spell only). If the final words and aim match, the
// deploy reuses the request already in flight, hiding most of the model's latency.
const early = new Map<string, Promise<Designed>>();
const EARLY_KEEP = 8;
const PAUSE_MS = 250; // only fire once the words settle, not on every interim result
let earlyTimer: ReturnType<typeof setTimeout> | undefined;

const earlyKey = (words: string, spellOnly: boolean) => `${spellOnly ? 'spell:' : ''}${normalise(words)}`;

export function prefetchDesign(words: string, spellOnly = false): void {
  clearTimeout(earlyTimer);
  const key = earlyKey(words, spellOnly);
  if (normalise(words).split(' ').length < 2 || early.has(key)) return;
  earlyTimer = setTimeout(() => {
    early.set(key, request(words, spellOnly));
    if (early.size > EARLY_KEEP) early.delete(early.keys().next().value!);
  }, PAUSE_MS);
}

// ms is the wait after the player finished, so a hit on an early design shows how much it saved.
// spellOnly: aimed past your own zone, so it has to come back a spell.
export async function designTroop(description: string, spellOnly = false): Promise<Designed> {
  const t0 = performance.now();
  const hit = early.get(earlyKey(description, spellOnly));
  const d = await (hit ?? request(description, spellOnly));
  if (d.source === 'offline') improvisedSet.add(normalise(description));
  return { ...d, apiMs: d.ms, ms: Math.round(performance.now() - t0), early: !!hit };
}

// Calls the api proxy, which holds the Anthropic key. Falls back to the offline designer in
// the browser if the api is unreachable, errors or is too slow, so it never throws.
async function request(description: string, spellOnly = false): Promise<Designed> {
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
  try {
    const r = await fetch('/api/troop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, spell: spellOnly }),
      signal: ctl.signal,
    });
    const text = await r.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`api returned ${r.status}, not JSON: ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
    }
    if (!r.ok || body.error || !body.design) throw new Error(`${body.error ?? 'no design'} (api returned ${r.status}${body.status ? `, upstream ${body.status}` : ''})`);
    return { ...body, source: String(body.source ?? 'offline') } as Designed;
  } catch (e) {
    const m = e instanceof Error ? (e.name === 'AbortError' ? `timed out after ${API_TIMEOUT_MS} ms` : e.message) : String(e);
    diag.warn('DESIGN', `api /api/troop failed, using the browser's offline designer: ${explain(m)}`, m);
    return offline(description, t0, `browser: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300), spellOnly);
  } finally {
    clearTimeout(timer);
  }
}

// Open connections and compile the schema before the first real deploy (~2-3 s cold).
export function warmDesigner(): void {
  fetch('/api/warm', { method: 'POST' })
    .then(r => r.json())
    .then(b => diag.info('DESIGN', `warmed: ${b.source} ${b.ms} ms`))
    .catch(e => diag.warn('DESIGN', `warm-up failed: ${explain((e as Error).message)}`));
}
