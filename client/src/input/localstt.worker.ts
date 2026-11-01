// The speech model, off the main thread so transcribing never stalls the arena: Moonshine (a small
// speech-to-text model built for short commands) through transformers.js, on the GPU (WebGPU)
// where the browser has one, else on the CPU (WebAssembly). The files come from Hugging Face once
// and the browser caches them. Messages: load → progress… → ready (or failed); run → text.
import { pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from '@huggingface/transformers';

export const MODEL = 'onnx-community/moonshine-base-ONNX';

export type ToWorker = { type: 'load'; device?: 'webgpu' | 'wasm' } | { type: 'run'; id: number; audio: Float32Array };
export type FromWorker =
  | { type: 'progress'; pct: number }
  | { type: 'ready'; device: string; ms: number }
  | { type: 'failed'; why: string }
  | { type: 'text'; id: number; text: string; ms: number };

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function gpu(): Promise<boolean> {
  try {
    const g = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!g && !!(await g.requestAdapter());
  } catch {
    return false;
  }
}

async function load(want?: 'webgpu' | 'wasm'): Promise<AutomaticSpeechRecognitionPipeline> {
  const t0 = performance.now();
  const device = want ?? ((await gpu()) ? 'webgpu' : 'wasm');
  let shown = -1;
  const p = (await pipeline('automatic-speech-recognition', MODEL, {
    device,
    // The GPU runs the encoder at full precision and a 4-bit decoder; the CPU an 8-bit pair.
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (i: ProgressInfo) => {
      if (i.status !== 'progress_total') return;
      const pct = Math.floor(i.progress);
      if (pct !== shown) post({ type: 'progress', pct: (shown = pct) });
    },
  })) as AutomaticSpeechRecognitionPipeline;
  // One short run of silence, so the first real one doesn't pay for compiling the GPU kernels.
  await p(new Float32Array(16000));
  post({ type: 'ready', device, ms: Math.round(performance.now() - t0) });
  return p;
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'load') {
    asr ??= load(m.device);
    asr.catch(err => post({ type: 'failed', why: (err as Error).message }));
    return;
  }
  try {
    const t0 = performance.now();
    const p = await (asr ??= load());
    const out = await p(m.audio);
    const text = (Array.isArray(out) ? out[0]?.text : out.text) ?? '';
    post({ type: 'text', id: m.id, text: text.trim(), ms: Math.round(performance.now() - t0) });
  } catch (err) {
    post({ type: 'text', id: m.id, text: '', ms: 0 });
    post({ type: 'failed', why: (err as Error).message });
  }
};
