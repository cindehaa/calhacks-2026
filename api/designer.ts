import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from '../shared/prompt';
import { designOffline } from '../shared/offline_designer';
import { TROOP_SCHEMA, price, sanitizeDesign, type TroopDesign } from '../shared/troop';

// Haiku: p90 2.11 s for a troop in the Oct 23 benchmark, inside the 2.5 s deploy delay.
const MODEL = 'claude-haiku-5-5';
// A slow Claude call is worse than a plain offline troop, so no retries and a hard timeout.
// The browser gives up on this route at 7 s, which leaves room for the fallback here.
const TIMEOUT_MS = 4500;

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 }));

export const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export interface Designed {
  design: TroopDesign;
  cost: number;
  ms: number;
  source: 'claude' | 'offline';
}

async function designWithClaude(description: string): Promise<TroopDesign> {
  const msg = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: TROOP_SCHEMA } },
    messages: [{ role: 'user', content: `<description>${description}</description>` }],
  }, { timeout: TIMEOUT_MS, maxRetries: 0 });
  if (msg.stop_reason === 'refusal') throw new Error('designer refused');
  const text = msg.content.find(b => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('designer returned no text');
  return sanitizeDesign(JSON.parse(text.text));
}

// Claude when a key is set, the offline designer when it isn't or the call fails. Never throws.
export async function designTroop(description: string): Promise<Designed> {
  const t0 = performance.now();
  let design: TroopDesign | null = null;
  if (hasKey()) {
    try {
      design = await designWithClaude(description);
    } catch (e) {
      console.warn('claude designer failed, using offline:', e instanceof Error ? e.message.slice(0, 160) : e);
    }
  }
  const source = design ? 'claude' : 'offline';
  design ??= designOffline(description);
  return { design, cost: price(design), ms: Math.round(performance.now() - t0), source };
}

// The first Claude call is slow (schema compile); pay it at match start. Free without a key.
export async function warm(): Promise<{ ms: number; source: Designed['source'] }> {
  const { ms, source } = await designTroop('warm up');
  return { ms, source };
}
