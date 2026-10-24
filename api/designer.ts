import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from '../shared/prompt';
import { TROOP_SCHEMA, price, sanitizeDesign, type TroopDesign } from '../shared/troop';

// Haiku: p90 2.11 s for a troop in the Oct 23 benchmark, inside the 2.5 s deploy delay.
const MODEL = 'claude-haiku-5-5';

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export interface Designed {
  design: TroopDesign;
  cost: number;
  ms: number;
}

export async function designTroop(description: string): Promise<Designed> {
  const t0 = performance.now();
  const msg = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: TROOP_SCHEMA } },
    messages: [{ role: 'user', content: `<description>${description}</description>` }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('designer refused');
  const text = msg.content.find(b => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('designer returned no text');
  const design = sanitizeDesign(JSON.parse(text.text));
  return { design, cost: price(design), ms: Math.round(performance.now() - t0) };
}
