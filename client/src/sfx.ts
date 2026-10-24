// Sound: the generated pack in client/public/audio (per-troop-type effects, game stingers, the
// announcer and music), with the old synthesized blips as the fallback until a file has loaded
// or if it fails. The AudioContext starts on the first user gesture, as browsers require. M or
// the speaker button mutes everything, music included; the choice is remembered.

export type SfxName =
  | 'deploy' | 'incoming' | 'land' | 'hit' | 'attack' | 'death' | 'towerHit' | 'towerDown' | 'buzz'
  | 'count' | 'fight' | 'double' | 'lastTen' | 'tooExpensive' | 'win' | 'lose' | 'draw'
  | 'click' | 'versus' | 'joined' | 'forfeit' | 'slam' | 'zap' | 'whoosh' | 'boom' | 'puff' | 'stun'
  // Juice (juice.ts): cost roll ticks and the settle chime, the name stamp, a refused troop's coin
  // shattering, the size-scaled landing thud and the shimmer when late art lands. Synth only.
  | 'tick' | 'chime' | 'stamp' | 'shatter' | 'thud' | 'shimmer';

// The pack's troop families; each has spawn, attack_1/2, hit_1/2 and death.
export const SOUND_KINDS = ['beast', 'blade', 'heavy', 'magic', 'mech', 'ranged', 'swarm'] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];
export type MusicTrack = 'menu' | 'battle' | 'overtime';

const AUDIO = '/audio/';
const GAME = ['deploy_land', 'deploy_pending', 'double_elixir', 'match_end', 'match_start', 'tower_destroyed', 'tower_hit_1', 'tower_hit_2', 'victory', 'defeat'];
const VOICE = ['double_elixir', 'draw', 'last_ten', 'match_start', 'too_expensive', 'tower_down'];
const UNIT = ['spawn', 'attack_1', 'attack_2', 'hit_1', 'hit_2', 'death'];
const SAMPLES = [
  ...GAME.map(n => `sfx/game/${n}`),
  ...VOICE.map(n => `voice/announcer/${n}`),
  ...SOUND_KINDS.flatMap(k => UNIT.map(n => `sfx/${k}/${n}`)),
];

// What each event plays from the pack: one of `pick` (at random), plus an announcer line. Unit
// events use the troop's family. Anything with nothing to play here falls back to the synth.
function samplesFor(name: SfxName, kind?: SoundKind): { pick: string[]; voice?: string; gain: number } {
  const unit = (...n: string[]) => (kind ? n.map(x => `sfx/${kind}/${x}`) : []);
  switch (name) {
    case 'deploy': return { pick: ['sfx/game/deploy_pending'], gain: 0.7 };
    case 'land': return { pick: kind ? unit('spawn') : ['sfx/game/deploy_land'], gain: 0.9 };
    case 'attack': return { pick: unit('attack_1', 'attack_2'), gain: 0.45 };
    case 'hit': return { pick: unit('hit_1', 'hit_2'), gain: 0.4 };
    case 'death': return { pick: unit('death'), gain: 0.7 };
    case 'towerHit': return { pick: ['sfx/game/tower_hit_1', 'sfx/game/tower_hit_2'], gain: 0.6 };
    case 'towerDown': return { pick: ['sfx/game/tower_destroyed'], voice: 'tower_down', gain: 1 };
    case 'fight': return { pick: ['sfx/game/match_start'], voice: 'match_start', gain: 0.9 };
    case 'double': return { pick: ['sfx/game/double_elixir'], voice: 'double_elixir', gain: 0.9 };
    case 'lastTen': return { pick: [], voice: 'last_ten', gain: 1 };
    case 'tooExpensive': return { pick: [], voice: 'too_expensive', gain: 1 };
    case 'win': return { pick: ['sfx/game/victory'], gain: 1 };
    case 'lose': return { pick: ['sfx/game/defeat'], gain: 1 };
    case 'draw': return { pick: ['sfx/game/defeat'], voice: 'draw', gain: 0.8 };
    case 'versus': return { pick: ['sfx/game/deploy_land'], gain: 1 };
    case 'joined': return { pick: ['sfx/game/double_elixir'], gain: 0.5 };
    case 'forfeit': return { pick: ['sfx/game/match_end'], gain: 0.9 };
    default: return { pick: [], gain: 1 };
  }
}

const VOICE_GAIN = 1.4;
const MUSIC_GAIN = 0.32;
const AMBIENCE_GAIN = 0.25;

// Which family a troop sounds like, from its words and stats. First match wins.
const KIND_WORDS: [RegExp, SoundKind][] = [
  [/\b(bees?|swarm|horde|ants?|rats?|bats?|imps?|minions?|flock|pack of|army of)\b/, 'swarm'],
  [/robot|mech|cyborg|android|droid|drone|tank|cannon|rocket|missile|machine|turret|catapult/, 'mech'],
  [/wizard|mage|witch|warlock|sorcer|fairy|pixie|ghost|spirit|phantom|angel|demon|lich|spell|magic|elemental|lightning|thunder|fire|flame|ice|frost/, 'magic'],
  [/dragon|wyvern|wolf|bear|lion|tiger|horse|boar|frog|toad|shark|snake|serpent|spider|gorilla|ape|monkey|beast|monster|dinosaur|raptor|rex|cat|dog|hound|eagle|hawk|crab|octopus|kraken|elephant|mammoth|unicorn|bull/, 'beast'],
  [/archer|\bbows?\b|arrow|sniper|gunner|rifle|\bguns?\b|bomb|lobber|grenade|thrower|slinger|crossbow|marksman|ranger/, 'ranged'],
  [/golem|giant|ogre|troll|titan|colossus|stone|boulder|juggernaut|brute|behemoth/, 'heavy'],
];

export function soundKind(words: string, range: number, maxHp: number, groupSize: number): SoundKind {
  const w = words.toLowerCase();
  for (const [re, k] of KIND_WORDS) if (re.test(w)) return k;
  if (groupSize >= 4) return 'swarm';
  if (range > 1) return 'ranged';
  if (maxHp >= 1500) return 'heavy';
  return 'blade';
}

const MUTE_KEY = 'arena.muted';
const VOLUME = 0.35;

// Minimum gap between two plays of the same sound, in seconds. Keeps swarms from roaring.
const GAP: Partial<Record<SfxName, number>> = {
  click: 0.05, hit: 0.07, attack: 0.08, death: 0.08, land: 0.09, towerHit: 0.12, incoming: 0.3, deploy: 0.15, buzz: 0.3, tooExpensive: 1.5,
  slam: 0.1, zap: 0.1, whoosh: 0.08, boom: 0.12, puff: 0.15, stun: 0.12,
  tick: 0.035, chime: 0.08, stamp: 0.08, shatter: 0.2, thud: 0.06, shimmer: 0.15,
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
  private buffers = new Map<string, AudioBuffer>(); // pack files that have loaded
  private loading = false;
  private music = new Map<string, HTMLAudioElement>(); // looping tracks, by path
  private musicGain: GainNode | null = null;
  private wanted: MusicTrack | null = null; // set before the context exists, applied on unlock
  private playing: MusicTrack | null = null;
  private held = false; // music paused in place (the pause menu), not switched off
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
      if (!this.loading) {
        this.loading = true;
        void this.load();
      }
      this.applyMusic();
    } catch { /* no audio, no problem */ }
  }

  // Fetch and decode the pack (~1 MB of short files), a few at a time. Until each lands, its
  // events play the synth version.
  private async load(): Promise<void> {
    const ac = this.ctx;
    if (!ac) return;
    const queue = [...SAMPLES];
    const worker = async () => {
      for (let key = queue.shift(); key; key = queue.shift()) {
        try {
          const r = await fetch(`${AUDIO}${key}.mp3`);
          if (r.ok) this.buffers.set(key, await ac.decodeAudioData(await r.arrayBuffer()));
        } catch { /* keep the synth for this one */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  // Background music: menu in the lobby, battle during a match, overtime in the last 30 s, with
  // arena ambience under the fight. Streams from <audio> elements routed through the master gain.
  setMusic(track: MusicTrack | null): void {
    if (track === this.wanted) return;
    this.wanted = track;
    this.applyMusic();
  }

  private applyMusic(): void {
    const ac = this.ctx, out = this.master;
    if (!ac || !out || this.wanted === this.playing) return;
    if (!this.musicGain) {
      this.musicGain = ac.createGain();
      this.musicGain.gain.value = 1;
      this.musicGain.connect(out);
    }
    const want = new Set<string>();
    if (this.wanted) want.add(`music/${this.wanted}`);
    if (this.wanted === 'battle' || this.wanted === 'overtime') want.add('sfx/game/arena_ambience');
    for (const [key, el] of this.music) if (!want.has(key)) el.pause();
    for (const key of want) {
      if (this.held) break;
      let el = this.music.get(key);
      if (!el) {
        el = new Audio(`${AUDIO}${key}.mp3`);
        el.loop = true;
        el.preload = 'auto';
        const g = ac.createGain();
        g.gain.value = key.startsWith('music/') ? MUSIC_GAIN : AMBIENCE_GAIN;
        ac.createMediaElementSource(el).connect(g).connect(this.musicGain);
        this.music.set(key, el);
      }
      if (key.startsWith('music/')) el.currentTime = 0;
      el.play().catch(() => { /* blocked or missing: silence is fine */ });
    }
    this.playing = this.wanted;
  }

  // Freeze the current music where it is, and pick it up from the same spot.
  holdMusic(held: boolean): void {
    if (held === this.held) return;
    this.held = held;
    const want = this.playing;
    for (const [key, el] of this.music) {
      const on = !!want && (key === `music/${want}` || (key === 'sfx/game/arena_ambience' && want !== 'menu'));
      if (held || !on) el.pause();
      else el.play().catch(() => {});
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    writeMuted(m);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : VOLUME, this.ctx.currentTime, 0.02);
    for (const f of this.listeners) f(m);
  }

  toggle(): void { this.setMuted(!this.muted) }

  onMuteChange(f: (muted: boolean) => void): void { this.listeners.add(f) }

  // `kind` picks the troop family for unit events (land, attack, hit, death). `pitch` scales the
  // synth's frequencies (the landing thud drops for big troops); the pack's samples ignore it.
  play(name: SfxName, kind?: SoundKind, pitch = 1): void {
    const ac = this.ctx, out = this.master;
    if (!ac || !out || this.muted || ac.state !== 'running') return;
    const now = ac.currentTime;
    const gap = GAP[name];
    if (gap && now - (this.last.get(name) ?? -1) < gap) return;
    this.last.set(name, now);
    try {
      const s = samplesFor(name, kind);
      const ready = s.pick.filter(k => this.buffers.has(k));
      if (ready.length) this.sample(ready[Math.floor(Math.random() * ready.length)], s.gain, name === 'hit' || name === 'attack');
      else this.synth(name, ac, out, now, pitch);
      if (s.voice) this.sample(`voice/announcer/${s.voice}`, VOICE_GAIN, false);
    } catch { /* ignore */ }
  }

  // The live context and output for one-off synth sounds made elsewhere (react.ts), or null while
  // muted or before the first gesture, so those respect M too.
  out(): { ac: AudioContext; out: GainNode } | null {
    const ac = this.ctx, out = this.master;
    return ac && out && !this.muted && ac.state === 'running' ? { ac, out } : null;
  }

  // One shot of a loaded file. Busy sounds get a little pitch wobble so repeats don't drone.
  private sample(key: string, gain: number, wobble: boolean): void {
    const ac = this.ctx, out = this.master, buf = this.buffers.get(key);
    if (!ac || !out || !buf) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    if (wobble) src.playbackRate.value = 0.92 + Math.random() * 0.16;
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start();
  }

  private synth(name: SfxName, ac: AudioContext, out: GainNode, t: number, pitch = 1): void {
    const p = pitch;
    switch (name) {
      case 'tick': // a slot reel clicking over: short bright tick
        this.tone(ac, out, t, 'square', 1900 * p, 1500 * p, 0.025, 0.07, 5000);
        break;
      case 'chime': // the cost settles: two bell partials
        this.tone(ac, out, t, 'sine', 1320 * p, 1320 * p, 0.5, 0.22);
        this.tone(ac, out, t, 'sine', 1980 * p, 1980 * p, 0.35, 0.1);
        this.tone(ac, out, t + 0.06, 'triangle', 2640 * p, 2640 * p, 0.25, 0.06);
        break;
      case 'stamp': // the name stamps down: dull wooden knock
        this.tone(ac, out, t, 'sine', 240, 90, 0.12, 0.5);
        this.noiseHit(ac, out, t, 0.07, 0.3, 'bandpass', 1100, 500, 1.4);
        break;
      case 'shatter': // a refused troop's coin breaking: glassy crack and tinkle
        this.noiseHit(ac, out, t, 0.18, 0.4, 'highpass', 4200, 2600, 1.2);
        for (const [i, f] of [2900, 3700, 2400, 4300].entries()) this.tone(ac, out, t + 0.02 + i * 0.035, 'triangle', f, f * 0.94, 0.12, 0.08);
        break;
      case 'thud': // a troop landing: pitch drops with size
        this.tone(ac, out, t, 'sine', 170 * p, 38 * p, 0.18 + 0.25 / p, Math.min(1, 0.45 / p));
        this.noiseHit(ac, out, t, 0.09 + 0.12 / p, Math.min(0.6, 0.25 / p), 'lowpass', 1100 * p, 160 * p, 0.7);
        break;
      case 'shimmer': // art lands on a troop: rising sparkle
        for (const [i, f] of [1568, 2093, 2637, 3136].entries()) this.tone(ac, out, t + i * 0.04, 'sine', f, f, 0.18, 0.07);
        break;
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
      case 'click': // menu tick
        this.tone(ac, out, t, 'triangle', 880, 660, 0.05, 0.18);
        break;
      case 'joined':
        this.tone(ac, out, t, 'triangle', 660, 660, 0.12, 0.25);
        this.tone(ac, out, t + 0.1, 'triangle', 990, 990, 0.2, 0.25);
        break;
      case 'versus': // the two cards slam together
        this.tone(ac, out, t, 'sine', 120, 40, 0.4, 1);
        this.noiseHit(ac, out, t, 0.3, 0.6, 'lowpass', 2400, 200, 0.7);
        break;
      case 'forfeit':
        this.tone(ac, out, t, 'sine', 196, 98, 0.9, 0.5);
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
      case 'boom': // death burst: short low blast
        this.tone(ac, out, t, 'sine', 140, 35, 0.35, 0.8);
        this.noiseHit(ac, out, t, 0.4, 0.5, 'lowpass', 2400, 160, 0.8);
        break;
      case 'puff': // spawner minion: soft pop
        this.noiseHit(ac, out, t, 0.12, 0.2, 'bandpass', 1200, 500, 1);
        this.tone(ac, out, t, 'sine', 300, 520, 0.08, 0.12);
        break;
      case 'stun': // stun lands: bright ding
        this.tone(ac, out, t, 'triangle', 1760, 1500, 0.18, 0.18);
        this.tone(ac, out, t + 0.04, 'triangle', 2350, 2000, 0.14, 0.1);
        break;
      case 'count':
      case 'lastTen':
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
      case 'draw':
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
