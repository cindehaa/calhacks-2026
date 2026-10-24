// Battle cries: each troop shouts its battle_cry in the voice its voice_style maps to, when it
// lands. One warm Cartesia TTS socket per match (sonic-3.6, raw pcm_s16le at 24 kHz), opened at
// match start so the first cry doesn't pay the ~0.5 s connect. Cries never overlap: one that
// arrives while another is still playing is dropped, not queued, so they stay tied to the drop.
// Muted (M) means no cries and no TTS calls at all.
import type { VoiceStyle } from '../../shared/troop';
import { cartesiaUrl, openSocket } from './cartesia';
import { sfx } from './sfx';

const RATE = 24000;
const MAX_WORDS = 8;
const VOLUME = 0.9;

// Picked during prep, one distinct voice per style.
const VOICES: Record<VoiceStyle, string> = {
  gruff_warrior: '23112795-d54e-4560-9568-791a87c30201', // Darius
  squeaky_critter: 'e13cae5c-ec59-4f71-b0a6-266df3c9bb8e', // Lulu
  mystic_whisper: '87748186-23bb-4158-a1eb-332911b0b708', // Alaric
  booming_giant: 'dbfa416f-d5c3-4006-854b-235ef6bdf4fd', // Damon
  robotic: '47c38ca4-5f35-497b-b1a3-415245fb35e1', // Daniel
  cheerful_hero: 'afb19d1b-4044-4f34-a962-f4aef640a002', // Zander
};

export const trimCry = (s: string) => s.trim().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS).join(' ');

class Cries {
  private ws: Promise<WebSocket | null> | null = null;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private current: string | null = null; // context id of the cry being generated or played
  private until = 0; // ctx time the scheduled audio runs out
  private started = 0;
  private seq = 0;

  constructor() {
    const unlock = () => this.audio();
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
    sfx.onMuteChange(m => {
      if (this.out && this.ctx) this.out.gain.setTargetAtTime(m ? 0 : VOLUME, this.ctx.currentTime, 0.02);
      if (m) this.stop();
    });
  }

  // Match start: open the socket now. Cheap to call again; a dead socket is reopened.
  warm(): void {
    if (sfx.muted) return;
    void this.socket();
  }

  get busy(): boolean {
    return !!this.current || (!!this.ctx && this.ctx.currentTime < this.until);
  }

  // True if the cry was sent; false if muted, another cry is playing, or there's no audio.
  speak(text: string, style: string): boolean {
    const words = trimCry(text);
    const ctx = this.audio();
    if (!words || sfx.muted || this.busy || !ctx || ctx.state !== 'running') return false;
    const id = `cry-${Date.now().toString(36)}-${++this.seq}`;
    this.current = id;
    this.started = performance.now();
    void this.socket().then(ws => {
      if (this.current !== id) return;
      if (!ws) return void (this.current = null);
      ws.send(JSON.stringify({
        model_id: 'sonic-3.6',
        transcript: words,
        voice: { id: VOICES[style as VoiceStyle] ?? VOICES.cheerful_hero },
        output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE },
        context_id: id,
        continue: false,
        language: 'en',
      }));
    });
    return true;
  }

  private stop(): void {
    if (this.current) void this.ws?.then(ws => ws?.send(JSON.stringify({ context_id: this.current, cancel: true })));
    this.current = null;
    this.until = 0;
  }

  private socket(): Promise<WebSocket | null> {
    if (this.ws) return this.ws;
    const p = (this.ws = (async () => {
      const url = await cartesiaUrl('/tts/websocket');
      const ws = url ? await openSocket(url) : null;
      if (!ws) {
        this.ws = null;
        return null;
      }
      ws.onmessage = e => this.message(e.data);
      ws.onclose = () => {
        if (this.ws === p) this.ws = null;
        this.current = null;
      };
      return ws;
    })());
    return p;
  }

  private message(data: unknown): void {
    if (typeof data !== 'string') return;
    let m: { type?: string; context_id?: string; data?: string; done?: boolean; message?: string };
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m.context_id !== this.current) return; // a cancelled cry's leftovers
    if (m.type === 'chunk' && m.data) this.play(m.data);
    if (m.type === 'error') console.warn('cry failed:', m.message);
    if (m.done || m.type === 'done' || m.type === 'error') {
      const secs = this.ctx ? Math.max(0, this.until - this.ctx.currentTime) : 0;
      console.info(`cry ${m.context_id}: done ${Math.round(performance.now() - this.started)} ms after the request, ${secs.toFixed(1)} s left to play`);
      this.current = null;
    }
  }

  // Queue one base64 pcm_s16le chunk right after the last one.
  private play(b64: string): void {
    const ctx = this.ctx, out = this.out;
    if (!ctx || !out) return;
    const bin = atob(b64);
    const n = bin.length >> 1;
    if (!n) return;
    const buf = ctx.createBuffer(1, n, RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      ch[i] = (v > 32767 ? v - 65536 : v) / 32768;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    const at = Math.max(ctx.currentTime + 0.02, this.until);
    src.start(at);
    this.until = at + buf.duration;
  }

  // Browsers only allow audio after a gesture, so the context starts on the first click or key.
  private audio(): AudioContext | null {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = sfx.muted ? 0 : VOLUME;
        this.out.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      return null;
    }
    return this.ctx;
  }
}

export const cries = new Cries();
