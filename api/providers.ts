// Troop-designer backends behind one interface, so the api and the benchmark (bench/) can swap
// them by name. Every provider gets the same system prompt and JSON schema, and every answer goes
// through sanitizeDesign, so they only differ in speed and judgement.
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from '../shared/prompt';
import { TROOP_SCHEMA, sanitizeDesign, type TroopDesign } from '../shared/troop';

export type ProviderName = 'claude' | 'gemini' | 'cerebras' | 'groq';
export const PROVIDERS: ProviderName[] = ['claude', 'gemini', 'cerebras', 'groq'];

export interface Provider {
  name: ProviderName;
  model: string;
  hasKey(): boolean;
  design(description: string, timeoutMs: number): Promise<RawDesign>;
}

// raw is the model's answer as sent, before clamping, so the logs show what got clamped.
export interface RawDesign {
  design: TroopDesign;
  raw: string;
}

const env = (k: string) => (process.env[k] ?? '').trim();
const userText = (d: string) => `<description>${d}</description>`;

// ---------- Claude (Anthropic SDK) ----------

let anthropicClient: Anthropic | null = null;
const anthropic = () => (anthropicClient ??= new Anthropic({ maxRetries: 0 }));

const claude: Provider = {
  name: 'claude',
  model: env('CLAUDE_MODEL') || 'claude-haiku-5-5',
  hasKey: () => !!(env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN')),
  async design(description, timeoutMs) {
    const msg = await anthropic().messages.create(
      {
        model: this.model,
        max_tokens: 400,
        // Cached: the prompt is ~1.6k tokens, over Haiku's 512-token minimum, and identical every call.
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'disabled' },
        output_config: { effort: 'low', format: { type: 'json_schema', schema: TROOP_SCHEMA } },
        messages: [{ role: 'user', content: userText(description) }],
      },
      { timeout: timeoutMs, maxRetries: 0 }
    );
    if (msg.stop_reason === 'refusal') throw new Error('refused');
    const text = msg.content.find(b => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('no text');
    return { design: sanitizeDesign(JSON.parse(text.text)), raw: text.text };
  },
};

// ---------- Gemini (REST, generateContent) ----------

const gemini: Provider = {
  name: 'gemini',
  model: env('GEMINI_MODEL') || 'gemini-3.5-flash-lite',
  hasKey: () => !!env('GEMINI_API_KEY'),
  async design(description, timeoutMs) {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userText(description) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: TROOP_SCHEMA,
        maxOutputTokens: 400,
        thinkingConfig: { thinkingLevel: env('GEMINI_THINKING') || 'minimal' },
      },
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const data = await postJson(url, { 'x-goog-api-key': env('GEMINI_API_KEY') }, body, timeoutMs);
    const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
    if (!text) throw new Error(`no text (${data?.candidates?.[0]?.finishReason ?? 'no candidates'})`);
    return { design: sanitizeDesign(JSON.parse(text)), raw: text };
  },
};

// ---------- OpenAI-compatible: Cerebras, Groq ----------

function openAiCompatible(name: ProviderName, url: string, keyVar: string, modelVar: string, model: string): Provider {
  return {
    name,
    model: env(modelVar) || model,
    hasKey: () => !!env(keyVar),
    async design(description, timeoutMs) {
      const body = {
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText(description) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'troop', strict: true, schema: TROOP_SCHEMA } },
        reasoning_effort: 'low', // gpt-oss reasons before answering; keep that short
        max_completion_tokens: 800,
        stream: false,
      };
      const data = await postJson(url, { Authorization: `Bearer ${env(keyVar)}` }, body, timeoutMs);
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error(`no content (${data?.choices?.[0]?.finish_reason ?? 'no choices'})`);
      return { design: sanitizeDesign(JSON.parse(text)), raw: text };
    },
  };
}

const cerebras = openAiCompatible('cerebras', 'https://api.cerebras.ai/v1/chat/completions', 'CEREBRAS_API_KEY', 'CEREBRAS_MODEL', 'gpt-oss-120b');
const groq = openAiCompatible('groq', 'https://api.groq.com/openai/v1/chat/completions', 'GROQ_API_KEY', 'GROQ_MODEL', 'openai/gpt-oss-20b');

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.replace(/\s+/g, ' ').slice(0, 240)}`);
  return JSON.parse(text);
}

const BY_NAME: Record<ProviderName, Provider> = { claude, gemini, cerebras, groq };

export function provider(name: string): Provider {
  const p = BY_NAME[name as ProviderName];
  if (!p) throw new Error(`unknown designer "${name}" (expected one of ${PROVIDERS.join(', ')})`);
  return p;
}
