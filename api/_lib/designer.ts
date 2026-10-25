import { createHash } from 'node:crypto';
import { designOffline } from '../../shared/offline_designer.js';
import { SYSTEM_PROMPT } from '../../shared/prompt.js';
import { price, type TroopDesign } from '../../shared/troop.js';
import { provider, type ProviderName } from './providers.js';

// DESIGNER picks the backend (claude, gemini, cerebras, groq); `npm run bench` compares them.
// Claude Haiku 5.5 measured p90 2.11 s on Oct 23, inside the 2.5 s deploy delay.
const designer = () => provider(process.env.DESIGNER?.trim() || 'claude');
// A slow design is worse than a plain offline troop, so no retries and a hard timeout.
// The browser gives up on this route at 7 s, which leaves room for the fallback here.
const TIMEOUT_MS = 4500;

// Which prompt a logged design came from, so harness changes can be compared.
const PROMPT_HASH = createHash('sha256').update(SYSTEM_PROMPT).digest('hex').slice(0, 10);

export const hasKey = () => designer().hasKey();
export const designerName = () => `${designer().name} (${designer().model})`;

export interface Designed {
  design: TroopDesign;
  cost: number;
  ms: number;
  source: ProviderName | 'offline';
  model: string;
  prompt: string; // PROMPT_HASH
  raw: string; // the model's answer before clamping; '' offline
  error: string; // why the model wasn't used; '' when it was, or when there's no key
}

// The configured model when its key is set, the offline designer when it isn't or the call fails.
// Never throws.
export async function designTroop(description: string): Promise<Designed> {
  const t0 = performance.now();
  const p = designer();
  let design: TroopDesign | null = null;
  let raw = '', error = '';
  if (p.hasKey()) {
    try {
      ({ design, raw } = await p.design(description, TIMEOUT_MS));
    } catch (e) {
      const any = e as { status?: number; error?: { error?: { message?: string } } };
      const raw = e instanceof Error ? e.message : String(e);
      const status = typeof any?.status === 'number' ? any.status : Number(raw.match(/\b([45]\d\d)\b/)?.[1] ?? 0);
      const msg = (any?.error?.error?.message ?? raw).replace(/\s+/g, ' ').replace(/\b(sk-ant-[\w-]{6})[\w-]+/g, '$1***');
      error = `${p.name === 'claude' ? 'anthropic' : p.name} ${status || 'error'}: ${msg}`.slice(0, 300);
      console.error(`[api] stage=design provider=${p.name} upstream=${status || '-'} ${msg.slice(0, 200)} → offline troop`);
    }
  }
  const source = design ? p.name : 'offline';
  design ??= designOffline(description);
  const ms = Math.round(performance.now() - t0);
  return { design, cost: price(design), ms, source, model: source === 'offline' ? '' : p.model, prompt: PROMPT_HASH, raw, error };
}

// The first call is slow (schema compile, cold connection); pay it at match start. Free without a key.
export async function warm(): Promise<{ ms: number; source: Designed['source'] }> {
  const { ms, source } = await designTroop('warm up');
  return { ms, source };
}
