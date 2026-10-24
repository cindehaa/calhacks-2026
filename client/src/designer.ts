import { designOffline } from '../../shared/offline_designer';
import { price, type TroopDesign } from '../../shared/troop';

export interface Designed {
  design: TroopDesign;
  cost: number;
  ms: number;
  source: 'claude' | 'offline';
}

// The api itself gives up on Claude at 4.5 s and answers offline; this is the backstop for an
// api that is down or stuck, so a deploy never waits longer than this.
const API_TIMEOUT_MS = 7000;

function offline(description: string, t0: number): Designed {
  const design = designOffline(description);
  return { design, cost: price(design), ms: Math.round(performance.now() - t0), source: 'offline' };
}

// Calls the api proxy, which holds the Anthropic key. Falls back to the offline designer in
// the browser if the api is unreachable, errors or is too slow, so it never throws.
export async function designTroop(description: string): Promise<Designed> {
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
    return { ...body, source: body.source === 'claude' ? 'claude' : 'offline' } as Designed;
  } catch (e) {
    console.warn('designer api failed, using offline designer:', e);
    return offline(description, t0);
  } finally {
    clearTimeout(timer);
  }
}

// Open connections and compile the schema before the first real deploy (~2-3 s cold).
export function warmDesigner(): void {
  fetch('/api/warm', { method: 'POST' }).catch(() => {});
}
