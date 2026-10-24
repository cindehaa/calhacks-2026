import { designOffline } from '../../shared/offline_designer';
import { price, type TroopDesign } from '../../shared/troop';

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

function offline(description: string, t0: number, error: string): Designed {
  const design = designOffline(description);
  return { design, cost: price(design), ms: Math.round(performance.now() - t0), source: 'offline', error };
}

// Designs started while the player is still talking, keyed by normalised words. If the final
// words match, the deploy reuses the request already in flight, hiding most of the model's latency.
const early = new Map<string, Promise<Designed>>();
const EARLY_KEEP = 8;
const PAUSE_MS = 250; // only fire once the words settle, not on every interim result
let earlyTimer: ReturnType<typeof setTimeout> | undefined;
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

export function prefetchDesign(words: string): void {
  clearTimeout(earlyTimer);
  const key = normalise(words);
  if (key.split(' ').length < 2 || early.has(key)) return;
  earlyTimer = setTimeout(() => {
    early.set(key, request(words));
    if (early.size > EARLY_KEEP) early.delete(early.keys().next().value!);
  }, PAUSE_MS);
}

// ms is the wait after the player finished, so a hit on an early design shows how much it saved.
export async function designTroop(description: string): Promise<Designed> {
  const t0 = performance.now();
  const hit = early.get(normalise(description));
  const d = await (hit ?? request(description));
  return { ...d, apiMs: d.ms, ms: Math.round(performance.now() - t0), early: !!hit };
}

// Calls the api proxy, which holds the Anthropic key. Falls back to the offline designer in
// the browser if the api is unreachable, errors or is too slow, so it never throws.
async function request(description: string): Promise<Designed> {
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
  try {
    const r = await fetch('/api/troop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
      signal: ctl.signal,
    });
    const body = await r.json();
    if (!r.ok || body.error || !body.design) throw new Error(body.error ?? `api returned ${r.status}`);
    return { ...body, source: String(body.source ?? 'offline') } as Designed;
  } catch (e) {
    console.warn('designer api failed, using offline designer:', e);
    return offline(description, t0, `browser: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  } finally {
    clearTimeout(timer);
  }
}

// Open connections and compile the schema before the first real deploy (~2-3 s cold).
export function warmDesigner(): void {
  fetch('/api/warm', { method: 'POST' }).catch(() => {});
}
