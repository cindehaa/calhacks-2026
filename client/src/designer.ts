import type { TroopDesign } from '../../shared/troop';

export interface Designed {
  design: TroopDesign;
  cost: number;
  ms: number;
}

// Calls the api proxy, which holds the Anthropic key. Throws with a readable message.
export async function designTroop(description: string): Promise<Designed> {
  const r = await fetch('/api/troop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  const body = await r.json().catch(() => ({ error: `api returned ${r.status}` }));
  if (!r.ok || body.error) throw new Error(body.error ?? `api returned ${r.status}`);
  return body as Designed;
}

// Open connections and compile the schema before the first real deploy (~2-3 s cold).
export function warmDesigner(): void {
  fetch('/api/warm', { method: 'POST' }).catch(() => {});
}
