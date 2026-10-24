// Camera + mic input: aim and fire.
//
// The mic listens the whole time it's on, and everything said since the last fire is the troop.
// Aim with the index fingertip (or the mouse). Fire by flicking the wrist down, pressing Space, or
// clicking the board with words waiting: the troop goes where you were pointing just before.
// Close your hand into a fist, press Esc or say "cancel" to throw the words away. Typed text,
// number keys and click-to-type work as before.
import { drawCursor, FLASH_MS, type CursorState, type InputView } from './draw';
import { OneEuro } from './filter';
import { FlickDetector } from './flick';
import { HAND_CONNECTIONS, HandTracker, pointerOf, type HandFrame } from './hand';
import { applyH, DEFAULT_H, invertH, type Pt2 } from './homography';
import { FistDetector } from './pose';
import { AutoSpeech } from './cartesia_stt';
import { chooseDescription, isCancel, isMismatch, Transcript } from './speech';
import { KEYS, load, save } from './store';
import { CursorHistory, type Pt } from './trail';
import { Mic, Vad, VAD_DEFAULTS } from './voice';
import './input.css';

type Spot = [number, number]; // world coords

// What the game provides. begin() starts the server-side deploy clock and returns its handle
// (null refuses); deploy() and cancel() finish it.
export interface InputHost {
  playing(): boolean;
  canDeploy(spot: Spot): boolean; // your half, or a pocket you've opened
  toWorld(px: number, py: number): Spot;
  begin(spot: Spot, by: string): number | null;
  deploy(nonce: number, spot: Spot, description: string, how: DeployHow): void;
  cancel(nonce: number, reason: string, transcript: string): void;
  status(msg: string, bad?: boolean): void;
  typedText(): string;
  clearTyped(): void;
  prefetch?(words: string): void; // start designing from words heard so far
  released?(nonce: number, words: string): void; // fired; the last words are still being finalised
  // For the logs.
  heard?(text: string, nonce: number): void; // a finished speech segment; nonce 0 outside a fire
  mismatch?(): void; // the player said their last troop isn't what they asked for
  event?(kind: string, detail?: string): void;
}

export interface DeployHow {
  from: 'typed' | 'voice';
  by: string; // what fired it: 'flick', 'key' or 'mouse'
  transcript: string;
}

interface Prefs { preview: boolean; vadDb: number; camera: boolean; mic: boolean; mouseKeys: boolean }

// A fire waiting for the recogniser to finish its last words.
interface Firing { nonce: number; spot: Spot; at: Pt; by: string; words: Transcript }

const FLUSH_MS = 600; // how long a fire waits for the recogniser to finalise the last words (Cartesia: ~0.1 s)
const FLICK_SHOW_MS = 180; // the cursor fills this long after a flick
const SCREEN_IN_CAMERA = invertH(DEFAULT_H); // the screen's edges in camera coords, for the preview

export class InputController {
  private tracker: HandTracker | null = null;
  private mic = new Mic();
  private vad = new Vad({ ...VAD_DEFAULTS });
  private speech = new AutoSpeech(() => this.mic.media); // Cartesia, else the browser's recogniser
  private prompt = new Transcript(); // words since the last fire or cancel
  private firing: Firing | null = null;
  private skipUtterance = false; // the utterance in progress was cancelled: drop it until its final

  private fx = new OneEuro(1.0, 0.007);
  private fy = new OneEuro(1.0, 0.007);
  private flicker = new FlickDetector();
  private fist = new FistDetector();
  private trail = new CursorHistory(); // the hand cursor, to aim from before a flick
  private flickT = -Infinity;
  private slips: number[] = []; // px each recent flick moved the fingertip, for tuning
  private prefs: Prefs = {
    preview: true, vadDb: VAD_DEFAULTS.thresholdDb, camera: false, mic: false, mouseKeys: true,
    ...load<Partial<Prefs>>(KEYS.prefs),
  };

  private hand: HandFrame | null = null;
  private handCursor: Pt | null = null;
  private mouse: Pt | null = null;
  private flashes: InputView['flashes'] = [];
  private overlayDrawn = false;
  private camStatus = '';
  private heard = '';
  private heardWords = false; // the recogniser has returned words at least once
  private flaggedAt = 0; // last mismatch flag: interim words flag it, then the final repeats them
  private lastPanel = 0;
  private clickTaken = false; // the last mouse press fired, so it isn't also a click-to-type
  private setupPreview: HTMLCanvasElement | null = null;
  onSetup?: () => void; // the ⋯ menu's "Run setup again"

  // DOM
  private el = document.createElement('div');
  private overlay = document.createElement('canvas'); // the hand cursor outside a match
  private preview!: HTMLCanvasElement;
  private hintEl = document.getElementById('talkHint'); // how to fire, under the board

  constructor(canvas: HTMLCanvasElement, private host: InputHost) {
    this.vad.o.thresholdDb = this.prefs.vadDb;
    this.speech.setGated(false); // always listening
    this.speech.onPartial = t => this.words(t, false);
    this.speech.onFinal = t => this.words(t, true);
    this.speech.onError = msg => {
      this.heard = msg;
      this.host.event?.('speech:error', msg);
      this.renderPanel();
    };

    canvas.addEventListener('mousemove', e => (this.mouse = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('mouseleave', () => (this.mouse = null));
    // Clicking the board with words waiting fires them there. With nothing said it's an ordinary
    // click, which picks the spot for typing.
    canvas.addEventListener('mousedown', e => {
      this.clickTaken = false;
      if (e.button !== 0 || !this.prefs.mouseKeys || !this.prompt.text || this.firing) return;
      this.clickTaken = this.fire({ x: e.clientX, y: e.clientY }, 'mouse');
    });
    // Space fires at the cursor (hand or mouse); Esc throws the words away. An empty text box
    // doesn't count as typing during a match: clicking the board focuses it.
    const idleBox = (t: EventTarget | null) => this.host.playing() && t instanceof HTMLInputElement && !t.value;
    const typing = (t: EventTarget | null) =>
      (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) && !idleBox(t);
    addEventListener('keydown', e => {
      if (e.key === 'Escape') this.clear('key');
      else if (e.code === 'Space' && !typing(e.target)) {
        e.preventDefault(); // no page scroll, no clicking a focused button
        if (idleBox(e.target)) (e.target as HTMLInputElement).blur();
        if (!e.repeat) this.fire(this.cursor(), 'key');
      }
    });
    this.mountUi();
    const loop = () => {
      requestAnimationFrame(loop);
      this.tick(performance.now());
    };
    requestAnimationFrame(loop);
    // Turn back on whatever was on last visit; the browser remembers the permission.
    if (this.prefs.camera) void this.setCamera(true);
    if (this.prefs.mic) void this.setMic(true);
  }

  // Mouse and keyboard mode: the mouse aims and clicks, number keys drop troops. On by default
  // alongside the hand, and the fallback if vision fails; Space and Esc work either way.
  get mouseKeys(): boolean {
    return this.prefs.mouseKeys;
  }

  setMouseKeys(on: boolean): void {
    this.prefs.mouseKeys = on;
    save(KEYS.prefs, this.prefs);
    const box = this.el.querySelector<HTMLInputElement>('[data-act="mouseKeys"]');
    if (box) box.checked = on;
  }

  // What the setup screen shows.
  setupState() {
    return {
      camera: !!this.tracker,
      cameraReady: !!this.tracker?.ready,
      camStatus: this.camStatus,
      hand: !!this.hand,
      mic: this.mic.on,
      micStatus: this.heard,
      level: this.vad.level,
      speaking: this.vad.speaking,
      heardWords: this.heardWords,
    };
  }

  // A second, larger camera preview (the setup screen's). Drawn while it's visible.
  attachPreview(c: HTMLCanvasElement): void {
    this.setupPreview = c;
  }

  // Open the STT sockets ahead of the first fire (match start). Nothing to do with the mic off.
  warm(): void {
    if (this.mic.on) this.speech.warm();
  }

  // True once if the mouse press that just ended fired, so the game's click handler leaves it
  // alone instead of also picking a typing spot.
  tookClick(): boolean {
    const t = this.clickTaken;
    this.clickTaken = false;
    return t;
  }

  // What the board (pov.ts) draws over itself. Undefined while camera and mic are both off.
  view(): InputView | undefined {
    if (!this.tracker && !this.mic.on && !this.flashes.length) return undefined;
    const playing = this.host.playing(), at = this.cursor();
    const words = this.firing ? '' : this.prompt.text;
    return {
      cursor: this.handCursor && playing ? { ...this.handCursor, state: this.cursorState(performance.now()) } : null,
      prompt: playing && at && (words || this.vad.speaking) ? { x: at.x, y: at.y, text: words, speaking: this.vad.speaking } : null,
      flashes: this.flashes,
      hint: this.tracker?.ready && !this.hand && playing ? 'no hand in view' : '',
    };
  }

  // ---------- per frame ----------

  private tick(now: number): void {
    const f = this.tracker?.detect(now);
    if (f !== undefined) this.onHandFrame(f, now);
    if (this.mic.on) {
      const ev = this.vad.push(now, this.mic.levelDb());
      // Close each utterance when the talking stops, so its words are final before the next fire.
      if (ev?.kind === 'end') void this.speech.flush(FLUSH_MS);
    }
    this.flashes = this.flashes.filter(x => now - x.t < FLASH_MS);
    this.drawOverlay();
    if (now - this.lastPanel > 250) this.renderPanel();
    else this.renderHint();
  }

  private onHandFrame(f: HandFrame | null, now: number): void {
    this.hand = f;
    if (!f) {
      this.resetHand();
      this.drawPreviews();
      return;
    }
    const [u, v] = applyH(DEFAULT_H, pointerOf(f.lm));
    this.handCursor = { x: this.fx.filter(u * innerWidth, now / 1000), y: this.fy.filter(v * innerHeight, now / 1000) };
    this.trail.push(now, this.handCursor);
    if (this.fist.update(now, f.world)) this.clear('fist');
    const onset = this.flicker.update(now, f.lm, f.vw, f.vh);
    if (onset !== null && this.fist.allowsFlick(now)) {
      this.flickT = now;
      const aim = this.trail.at(onset) ?? this.handCursor;
      this.noteSlip(aim);
      this.fire(aim, 'flick');
    }
    this.drawPreviews();
  }

  private resetHand(): void {
    this.handCursor = null;
    this.fx.reset();
    this.fy.reset();
    this.trail.clear();
    this.flicker.reset();
    this.fist.reset();
  }

  private cursor(): Pt | null {
    return this.handCursor ?? (this.prefs.mouseKeys ? this.mouse : null);
  }

  // How far the fingertip moved between the flick starting and registering: what aiming from
  // before the flick saves. Shown in the panel and logged, for tuning.
  private noteSlip(from: Pt): void {
    const to = this.handCursor;
    if (!to) return;
    const px = Math.round(Math.hypot(to.x - from.x, to.y - from.y));
    this.slips = [...this.slips.slice(-9), px];
    this.host.event?.('gesture:slip', `flick ${px}px`);
  }

  private cursorState(now: number): CursorState {
    return this.fist.closed ? 'fist' : now - this.flickT < FLICK_SHOW_MS ? 'fire' : 'open';
  }

  // ---------- fire / cancel ----------

  // Send the words (or the typed text) to the spot at p. True if it handled the input, even by
  // refusing it, so a mouse press that fired isn't also a click.
  private fire(p: Pt | null, by: string): boolean {
    if (!p || !this.host.playing() || this.firing) return false;
    const said = this.prompt.text, typed = this.host.typedText().trim();
    if (!said && !typed) {
      const how = !this.mic.on ? 'type a troop or turn the mic on' : this.speech.available ? 'say a troop first' : 'type a troop first';
      this.flash(p, 'cancel', how);
      return true;
    }
    const spot = this.host.toWorld(p.x, p.y);
    if (!this.host.canDeploy(spot)) {
      this.flash(p, 'cancel', 'your half only');
      return true;
    }
    const nonce = this.host.begin(spot, by);
    if (nonce === null) return false;
    // The prompt keeps taking words until the recogniser has finished the last of them.
    this.firing = { nonce, spot, at: p, by, words: this.prompt };
    this.flash(p, 'deploy', '');
    this.host.released?.(nonce, said);
    void this.land(this.firing);
    return true;
  }

  private async land(f: Firing): Promise<void> {
    if (this.mic.on && f.words.text) await this.speech.flush(FLUSH_MS);
    if (this.firing !== f) return; // cancelled meanwhile
    this.firing = null;
    this.prompt = new Transcript();
    const d = chooseDescription(this.host.typedText(), f.words.text);
    if (d.ok) {
      if (d.from === 'typed') this.host.clearTyped();
      this.host.deploy(f.nonce, f.spot, d.text, { from: d.from, by: f.by, transcript: f.words.text });
      return;
    }
    this.flash(f.at, 'cancel', d.reason === 'cancel' ? 'cancelled' : 'no description');
    this.host.cancel(f.nonce, d.reason === 'cancel' ? 'cancelled' : 'cancelled: no description heard', f.words.text);
  }

  // Throw away the words said so far, and a fire still waiting on its last words.
  private clear(why: 'fist' | 'key' | 'said' | 'mismatch'): void {
    const f = this.firing, words = f?.words.text ?? this.prompt.text;
    if (!f && !words) return;
    if (this.prompt.pending) this.skipUtterance = true; // its final would bring the words back
    this.firing = null;
    this.prompt = new Transcript();
    if (this.mic.on) void this.speech.flush(FLUSH_MS);
    const at = f?.at ?? this.cursor();
    if (why !== 'mismatch' && at) this.flash(at, 'cancel', 'cleared');
    if (f) this.host.cancel(f.nonce, `cancelled (${why})`, words);
    this.host.event?.('prompt:cleared', `${why}: ${words}`);
    if (why !== 'mismatch') this.host.status('');
  }

  private words(text: string, final: boolean): void {
    this.heard = text ? `heard: “${text}”` : this.heard;
    if (text) this.heardWords = true;
    if (final && text) this.host.heard?.(text, this.firing?.nonce ?? 0);
    if (this.skipUtterance) {
      if (final) this.skipUtterance = false;
      return;
    }
    // Act on interim words too: waiting for the final result adds most of a second.
    if (isCancel(text)) return this.clear('said');
    if (isMismatch(text)) {
      this.clear('mismatch');
      return this.flagMismatch();
    }
    if (final) this.prompt.final(text);
    else this.prompt.interim(text);
    const all = this.prompt.text;
    if (all && this.host.playing() && !this.firing) {
      this.host.status(`“${all}”`);
      this.host.prefetch?.(all);
    }
  }

  private flagMismatch(): void {
    const now = performance.now();
    if (now - this.flaggedAt < 3000) return;
    this.flaggedAt = now;
    this.host.mismatch?.();
  }

  private flash(p: Pt, kind: 'deploy' | 'cancel', label: string): void {
    this.flashes.push({ x: p.x, y: p.y, kind, label, t: performance.now() });
  }

  // ---------- camera and mic ----------

  async setCamera(on: boolean): Promise<void> {
    if (on === !!this.tracker) return;
    if (!on) {
      this.tracker?.stop();
      this.tracker = null;
      this.hand = null;
      this.resetHand();
      this.camStatus = '';
      this.remember('camera', false);
      this.renderPanel();
      return;
    }
    const t = (this.tracker = new HandTracker());
    this.camStatus = 'starting camera…';
    this.renderPanel();
    try {
      await t.start(s => {
        this.camStatus = s;
        this.renderPanel();
      });
      if (this.tracker === t) {
        this.camStatus = '';
        this.remember('camera', true);
        this.host.event?.('camera:on');
      }
    } catch (e) {
      if (this.tracker === t) {
        t.stop();
        this.tracker = null;
        this.remember('camera', false);
        this.camStatus = `camera failed: ${(e as Error).name === 'NotAllowedError' ? 'blocked' : (e as Error).message}`;
        this.host.event?.('camera:failed', this.camStatus);
      }
    }
    this.renderPanel();
  }

  async setMic(on: boolean): Promise<void> {
    if (on === this.mic.on) return;
    if (!on) {
      this.clear('key');
      this.speech.stop();
      this.mic.stop();
      this.vad.reset();
      this.heard = '';
      this.remember('mic', false);
      this.renderPanel();
      return;
    }
    try {
      await this.mic.start();
      this.speech.start();
      this.heard = this.speech.available ? `listening (${this.speech.engine})` : 'no speech recognition in this browser: type the troop instead';
      this.remember('mic', true);
      this.host.event?.('mic:on', this.speech.available ? '' : 'no speech recognition');
    } catch (e) {
      this.heard = `mic failed: ${(e as Error).name === 'NotAllowedError' ? 'blocked' : (e as Error).message}`;
      this.host.event?.('mic:failed', this.heard);
      this.remember('mic', false);
    }
    this.renderPanel();
  }

  private remember(k: 'camera' | 'mic', on: boolean): void {
    this.prefs[k] = on;
    save(KEYS.prefs, this.prefs);
  }

  private drawOverlay(): void {
    // The board draws the cursor during a match; in the lobby and the setup screen it's drawn
    // here, above everything.
    const p = this.handCursor && !this.host.playing() ? this.handCursor : null;
    if (!p && !this.overlayDrawn) return;
    const c = this.overlay, dpr = devicePixelRatio || 1, w = innerWidth, h = innerHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (p) drawCursor(g, p.x, p.y, this.cursorState(performance.now()));
    this.overlayDrawn = !!p;
  }

  // ---------- UI ----------

  private mountUi(): void {
    this.el.id = 'inputPanel';
    this.el.innerHTML = `
      <div class="inRow">
        <button data-act="cam" title="Point with your index finger, flick your wrist down to send the troop there, make a fist to clear what you said">Camera</button>
        <button data-act="mic" title="Always listening while on: say the troop, then flick, click or press Space to send it">Mic</button>
        <button data-act="menu" class="ghost" title="Camera and mic settings">⋯</button>
      </div>
      <div class="inPreview"><canvas></canvas></div>
      <div class="inStatus"></div>
      <div class="inMenu" hidden>
        <button data-act="setup" class="ghost">Run setup again</button>
        <label><input type="checkbox" data-act="mouseKeys"> Mouse and keyboard</label>
        <label><input type="checkbox" data-act="preview"> Camera preview</label>
        <label>Speech above <input type="range" data-act="vadDb" min="-80" max="-10" step="1"><span class="inVal" data-val="vadDb"></span></label>
        <div class="inMeter"><div class="inLevel"></div><div class="inThresh"></div></div>
      </div>`;
    document.body.appendChild(this.el);
    this.preview = this.el.querySelector('.inPreview canvas')!;
    this.overlay.id = 'inputOverlay';
    document.body.appendChild(this.overlay);

    const q = <T extends HTMLElement>(act: string) => this.el.querySelector<T>(`[data-act="${act}"]`)!;
    const menu = this.el.querySelector<HTMLElement>('.inMenu')!;
    q<HTMLInputElement>('mouseKeys').checked = this.prefs.mouseKeys;
    q<HTMLInputElement>('preview').checked = this.prefs.preview;
    q<HTMLInputElement>('vadDb').value = String(this.prefs.vadDb);
    this.el.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      b.blur(); // keep keyboard shortcuts going to the game
      const act = b.dataset.act;
      if (act === 'cam') this.setCamera(!this.tracker);
      else if (act === 'mic') this.setMic(!this.mic.on);
      else if (act === 'menu') menu.hidden = !menu.hidden;
      else if (act === 'setup') {
        menu.hidden = true;
        this.onSetup?.();
      }
      this.renderPanel();
    });
    this.el.addEventListener('input', e => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.act === 'mouseKeys') this.prefs.mouseKeys = t.checked;
      if (t.dataset.act === 'preview') this.prefs.preview = t.checked;
      if (t.dataset.act === 'vadDb') this.prefs.vadDb = this.vad.o.thresholdDb = Number(t.value);
      save(KEYS.prefs, this.prefs);
      this.renderPanel();
    });
    this.renderPanel();
  }

  private renderPanel(): void {
    this.lastPanel = performance.now();
    const $ = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    $('[data-act="cam"]').classList.toggle('on', !!this.tracker);
    $('[data-act="mic"]').classList.toggle('on', this.mic.on);
    $('.inPreview').hidden = !this.tracker || !this.prefs.preview;
    const s = this.slips;
    const slip = s.length ? ` · flick slip ${s[s.length - 1]}px (avg ${Math.round(s.reduce((a, b) => a + b, 0) / s.length)})` : '';
    const pose = this.fist.closed ? 'fist' : `fingers ${this.fist.ext.toFixed(1)}`;
    const cam = this.tracker ? this.camStatus || (this.hand ? `hand · ${pose}${slip}` : 'no hand in view') : '';
    const mic = this.mic.on ? `${this.vad.level.toFixed(0)} dB${this.vad.speaking ? ' · speaking' : ''} · ${this.heard}` : this.heard;
    $('.inStatus').textContent = [cam, mic].filter(Boolean).join('\n');
    $('[data-val="vadDb"]').textContent = `${this.prefs.vadDb} dB`;
    const pct = (db: number) => `${Math.max(0, Math.min(100, ((db + 90) / 90) * 100))}%`;
    $('.inLevel').style.width = pct(this.mic.on ? this.vad.level : -90);
    $('.inLevel').classList.toggle('speaking', this.vad.speaking);
    $('.inThresh').style.left = pct(this.prefs.vadDb);
    this.renderHint();
  }

  // How to send a troop, shown during a match while nothing has been said yet (once there are
  // words, they show at the cursor instead).
  private renderHint(): void {
    const el = this.hintEl;
    if (!el) return;
    const text = !this.host.playing() || this.prompt.text || this.firing ? '' : this.hintText();
    if (el.textContent !== text) el.textContent = text;
    el.hidden = !text;
  }

  private hintText(): string {
    if (!this.mic.on) return this.heard.startsWith('mic failed') ? `${this.heard} · allow it from the address bar, then press Mic` : 'Turn on the Mic (top left) to speak troops in';
    const send = this.tracker ? 'point and flick your wrist' : this.prefs.mouseKeys ? 'click or press Space' : 'press Space';
    const clear = this.tracker ? 'make a fist' : 'press Esc';
    if (!this.speech.available) return `No speech recognition here: type the troop, then ${send}`;
    return `Say the troop, then ${send} to send it · ${clear} to clear`;
  }

  // Mirrored camera frame with the skeleton, and the screen's edges projected back into it
  // (the touchpad area).
  private drawPreviews(): void {
    if (!this.tracker) return;
    if (this.prefs.preview) this.drawPreview(this.preview, 160);
    const s = this.setupPreview;
    if (s?.clientWidth) this.drawPreview(s, s.clientWidth);
  }

  private drawPreview(c: HTMLCanvasElement, w: number): void {
    const v = this.tracker!.video, h = Math.round((w * (v.videoHeight || 9)) / (v.videoWidth || 16));
    const dpr = devicePixelRatio || 1;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.height = `${h}px`;
    }
    const g = c.getContext('2d')!;
    g.setTransform(-dpr, 0, 0, dpr, w * dpr, 0); // mirror the video
    g.drawImage(v, 0, 0, w, h);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const inv = SCREEN_IN_CAMERA;
    if (inv) {
      g.strokeStyle = '#4ade80';
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      g.beginPath();
      ([[0, 0], [1, 0], [1, 1], [0, 1]] as Pt2[]).forEach((p, i) => {
        const [x, y] = applyH(inv, p);
        if (i) g.lineTo(x * w, y * h);
        else g.moveTo(x * w, y * h);
      });
      g.closePath();
      g.stroke();
      g.setLineDash([]);
    }
    const lm = this.hand?.lm;
    if (!lm) return;
    const P = (i: number): Pt2 => [(1 - lm[i].x) * w, lm[i].y * h];
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      g.moveTo(...P(a));
      g.lineTo(...P(b));
    }
    g.stroke();
    const state = this.cursorState(performance.now());
    g.fillStyle = state === 'fire' ? '#4aa3ff' : state === 'fist' ? '#fbbf24' : '#ff5d6c';
    g.beginPath();
    g.arc(...P(8), 4, 0, Math.PI * 2);
    g.fill();
  }
}
