// Synthesized sound effects (WebAudio, no files). The AudioContext starts on the first user
// gesture, as browsers require. M or the speaker button mutes; the choice is remembered.

export type SfxName =
  | 'deploy' | 'incoming' | 'land' | 'hit' | 'death' | 'towerHit' | 'towerDown' | 'buzz'
  | 'count' | 'fight' | 'double' | 'win' | 'lose' | 'slam' | 'zap' | 'whoosh';

const MUTE_KEY = 'arena.muted';
const VOLUME = 0.35;

// Minimum gap between two plays of the same sound, in seconds. Keeps swarms from roaring.
const GAP: Partial<Record<SfxName, number>> = {
  hit: 0.06, death: 0.08, land: 0.09, towerHit: 0.12, incoming: 0.3, deploy: 0.15, buzz: 0.3,
  slam: 0.1, zap: 0.1, whoosh: 0.08,
};

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}
function writeMuted(m: boolean) {
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0') } catch { /* private mode */ }
}

class Sfx {
  muted = readMuted();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<SfxName, number>();
  private listeners = new Set<(muted: boolean) => void>();

  constructor() {
    const unlock = () => {
      this.unlock();
      if (this.ctx?.state === 'running') {
        removeEventListener('pointerdown', unlock, true);
        removeEventListener('keydown', unlock, true);
      }
    };
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
  }

  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : VOLUME;
        // A gentle limiter so stacked hits never clip.
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* no audio, no problem */ }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    writeMuted(m);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : VOLUME, this.ctx.currentTime, 0.02);
    for (const f of this.listeners) f(m);
  }

  toggle(): void { this.setMuted(!this.muted) }

  onMuteChange(f: (muted: boolean) => void): void { this.listeners.add(f) }

  play(name: SfxName): void {
    const ac = this.ctx, out = this.master;
    if (!ac || !out || this.muted || ac.state !== 'running') return;
    const now = ac.currentTime;
    const gap = GAP[name];
    if (gap && now - (this.last.get(name) ?? -1) < gap) return;
    this.last.set(name, now);
    try {
      this.synth(name, ac, out, now);
    } catch { /* ignore */ }
  }

  private synth(name: SfxName, ac: AudioContext, out: GainNode, t: number): void {
    switch (name) {
      case 'deploy': // rising airy whoosh
        this.noiseHit(ac, out, t, 0.38, 0.5, 'bandpass', 500, 2600, 1.4);
        break;
      case 'incoming': // the opponent locked a spot: two soft low blips
        this.tone(ac, out, t, 'triangle', 330, 330, 0.08, 0.18);
        this.tone(ac, out, t + 0.1, 'triangle', 262, 262, 0.1, 0.18);
        break;
      case 'land': // thump
        this.tone(ac, out, t, 'sine', 150, 42, 0.22, 0.9);
        this.noiseHit(ac, out, t, 0.08, 0.35, 'lowpass', 900, 200, 0.7);
        break;
      case 'hit': // tiny tick, random pitch so repeats don't drone
        this.tone(ac, out, t, 'triangle', 900 + Math.random() * 600, 500, 0.04, 0.12);
        break;
      case 'death': // little pop
        this.tone(ac, out, t, 'sine', 520, 140, 0.1, 0.22);
        this.noiseHit(ac, out, t, 0.08, 0.15, 'highpass', 2000, 2000, 0.7);
        break;
      case 'towerHit': // dull clank
        this.tone(ac, out, t, 'square', 210, 120, 0.07, 0.12);
        this.noiseHit(ac, out, t, 0.06, 0.18, 'bandpass', 1400, 900, 2);
        break;
      case 'towerDown': // boom and rumble
        this.tone(ac, out, t, 'sine', 90, 28, 0.9, 1);
        this.noiseHit(ac, out, t, 1.1, 0.9, 'lowpass', 1600, 90, 0.8);
        this.tone(ac, out, t, 'sawtooth', 70, 40, 0.5, 0.2);
        break;
      case 'buzz': // not enough elixir / rejected
        this.tone(ac, out, t, 'sawtooth', 120, 110, 0.11, 0.22, 900);
        this.tone(ac, out, t + 0.14, 'sawtooth', 120, 100, 0.13, 0.22, 900);
        break;
      case 'slam': // smash landing: low thud
        this.tone(ac, out, t, 'sine', 110, 40, 0.18, 0.6);
        this.noiseHit(ac, out, t, 0.1, 0.25, 'lowpass', 700, 150, 0.7);
        break;
      case 'zap': // chain lightning crackle
        this.noiseHit(ac, out, t, 0.14, 0.3, 'highpass', 3000, 1800, 1.5);
        this.tone(ac, out, t, 'sawtooth', 1400, 300, 0.1, 0.08, 4000);
        break;
      case 'whoosh': // slash or breath
        this.noiseHit(ac, out, t, 0.16, 0.22, 'bandpass', 1800, 600, 1.2);
        break;
      case 'count':
        this.tone(ac, out, t, 'triangle', 660, 660, 0.14, 0.35);
        break;
      case 'fight':
        for (const [i, f] of [523, 659, 784, 1047].entries()) this.tone(ac, out, t + i * 0.05, 'triangle', f, f, 0.45, 0.3);
        this.noiseHit(ac, out, t, 0.3, 0.25, 'bandpass', 800, 3000, 1.2);
        break;
      case 'double': // two bright chimes
        for (const [i, f] of [988, 1319, 988, 1319].entries()) this.tone(ac, out, t + i * 0.11, 'sine', f, f, 0.22, 0.32);
        break;
      case 'win':
        for (const [i, f] of [523, 659, 784, 1047, 1319].entries()) this.tone(ac, out, t + i * 0.1, 'triangle', f, f, i === 4 ? 0.9 : 0.25, 0.35);
        break;
      case 'lose':
        for (const [i, f] of [392, 311, 262, 196].entries()) this.tone(ac, out, t + i * 0.18, 'triangle', f, f * 0.98, i === 3 ? 0.9 : 0.3, 0.32);
        break;
    }
  }

  // An oscillator with a pitch glide and a fast-attack, exponential-decay envelope.
  private tone(
    ac: AudioContext, out: AudioNode, t: number, type: OscillatorType,
    f0: number, f1: number, dur: number, vol: number, lowpass = 0
  ): void {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (lowpass) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node = o.connect(f);
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Filtered white noise with a swept cutoff.
  private noiseHit(
    ac: AudioContext, out: AudioNode, t: number, dur: number, vol: number,
    type: BiquadFilterType, f0: number, f1: number, q: number
  ): void {
    if (!this.noise) return;
    const s = ac.createBufferSource();
    s.buffer = this.noise;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }
}

export const sfx = new Sfx();

// The speaker button and the M key.
const SPEAKER_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function syncButton() {
  const b = document.getElementById('muteBtn');
  if (!b) return;
  b.innerHTML = sfx.muted ? SPEAKER_OFF : SPEAKER_ON;
  b.title = sfx.muted ? 'Sound off (M)' : 'Sound on (M)';
  b.setAttribute('aria-pressed', String(sfx.muted));
  b.classList.toggle('off', sfx.muted);
}

sfx.onMuteChange(syncButton);
syncButton();
document.getElementById('muteBtn')?.addEventListener('click', e => {
  sfx.unlock();
  sfx.toggle();
  (e.currentTarget as HTMLElement).blur();
});
addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey) sfx.toggle();
});
