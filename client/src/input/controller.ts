// Camera + mic input: wires the hand tracker, the mic level and the transcript into the lock
// machine, and reports locks, deploys and cancels to the game. Mouse and keyboard keep working
// untouched; this only adds a second way in.
import { drawCursor, FLASH_MS, type InputView } from './draw';
import { OneEuro } from './filter';
import { HAND_CONNECTIONS, HandTracker, pointerOf, type HandFrame } from './hand';
import { applyH, DEFAULT_H, invertH, type Pt2 } from './homography';
import { LockMachine, LOCK_DEFAULTS, type Lock, type Pt } from './lock';
import { DEFAULT_PINCH, Hysteresis, pinchMetric2d } from './pinch';
import { chooseDescription, isCancel, isMismatch, Transcript, WebSpeechSource, type SpeechSource } from './speech';
import { KEYS, load, save } from './store';
import { Mic, Vad, VAD_DEFAULTS } from './voice';
import './input.css';

type Spot = [number, number]; // world coords

// What the game provides. begin() starts the server-side deploy clock at lock time and returns
// its handle (null refuses the lock); deploy() and cancel() finish it.
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
  // For the logs.
  heard?(text: string, nonce: number): void; // a finished speech segment; nonce 0 outside a lock
  mismatch?(): void; // the player said their last troop isn't what they asked for
  event?(kind: string, detail?: string): void;
}

export interface DeployHow {
  from: 'typed' | 'voice';
  by: string; // what held the lock at release: 'pinch' or 'voice'
  transcript: string;
}

interface Prefs { preview: boolean; vadDb: number; vadEndMs: number; camera: boolean; mic: boolean; mouseKeys: boolean }

interface Active { nonce: number; spot: Spot; words: Transcript }

const FLUSH_MS = 600; // how long a deploy waits for the recogniser to finalise the last words

export class InputController {
  private machine: LockMachine;
  private tracker: HandTracker | null = null;
  private mic = new Mic();
  private vad = new Vad({ ...VAD_DEFAULTS });
  private speech: SpeechSource = new WebSpeechSource();
  private listeners = new Map<Transcript, number>(); // transcripts still taking words → their nonce
  private active: Active | null = null;

  private fx = new OneEuro(1.0, 0.007);
  private fy = new OneEuro(1.0, 0.007);
  private hyst = new Hysteresis(DEFAULT_PINCH.on, DEFAULT_PINCH.off);
  private prefs: Prefs = { preview: true, vadDb: VAD_DEFAULTS.thresholdDb, vadEndMs: VAD_DEFAULTS.endMs, camera: false, mic: false, mouseKeys: true, ...load<Partial<Prefs>>(KEYS.prefs) };

  private hand: HandFrame | null = null;
  private handCursor: Pt | null = null;
  private pinched = false;
  private ratio = 0;
  private mouse: Pt | null = null;
  private flashes: InputView['flashes'] = [];
  private overlayDrawn = false;
  private camStatus = '';
  private heard = '';
  private heardWords = false; // the recogniser has returned words at least once
  private flaggedAt = 0; // last mismatch flag: interim words cancel the lock, then the final repeats them
  private lastPanel = 0;
  private setupPreview: HTMLCanvasElement | null = null;
  onSetup?: () => void; // the ⋯ menu's "Run setup again"

  // DOM
  private el = document.createElement('div');
  private overlay = document.createElement('canvas'); // the hand cursor outside a match
  private preview!: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, private host: InputHost) {
    this.machine = new LockMachine({
      onLock: l => this.onLock(l),
      onDeploy: l => this.onDeploy(l),
      onCancel: (l, why) => this.onCancel(l, why),
    }, LOCK_DEFAULTS);
    this.vad.o.thresholdDb = this.prefs.vadDb;
    this.vad.o.endMs = this.prefs.vadEndMs;
    this.speech.onPartial = t => this.words(t, false);
    this.speech.onFinal = t => this.words(t, true);
    this.speech.onError = msg => {
      this.heard = msg;
      this.host.event?.('speech:error', msg);
      this.renderPanel();
    };

    canvas.addEventListener('mousemove', e => (this.mouse = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('mouseleave', () => (this.mouse = null));
    // Space and Escape stand in for the hand at any time: hold Space to lock at the cursor (hand or
    // mouse), let go to deploy; Escape cancels whatever is locked, like dragging off or saying "cancel".
    const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    addEventListener('keydown', e => {
      if (e.key === 'Escape') this.machine.cancel('key');
      else if (e.code === 'Space' && !typing(e.target)) {
        e.preventDefault(); // no page scroll, no clicking a focused button
        if (!e.repeat) this.machine.keyDown(performance.now());
      }
    });
    addEventListener('keyup', e => {
      if (e.code !== 'Space' || typing(e.target)) return;
      e.preventDefault();
      this.machine.keyUp();
    });
    // A Space held while the window loses focus never sends its keyup.
    addEventListener('blur', () => {
      if (this.machine.lock?.by === 'key') this.machine.cancel('focus lost');
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

  // What render.ts draws over the board. Undefined while camera and mic are both off.
  view(): InputView | undefined {
    if (!this.tracker && !this.mic.on && !this.flashes.length) return undefined;
    const l = this.machine.lock, now = performance.now();
    return {
      cursor: this.handCursor && this.host.playing() ? { ...this.handCursor, pinched: this.pinched } : null,
      lock: l && {
        x: l.x,
        y: l.y,
        by: l.by,
        out: this.machine.dragDistance(now) > this.machine.o.dragRadius,
        radius: this.machine.o.dragRadius,
        transcript: this.active?.words.text ?? '',
        speaking: this.vad.speaking,
      },
      flashes: this.flashes,
      hint: this.tracker?.ready && !this.hand && this.host.playing() ? 'no hand in view' : '',
    };
  }

  // ---------- per frame ----------

  private tick(now: number): void {
    const f = this.tracker?.detect(now);
    if (f !== undefined) this.onHandFrame(f, now);
    if (this.mic.on) {
      const ev = this.vad.push(now, this.mic.levelDb());
      if (ev?.kind === 'start') this.machine.speechStart(ev.t);
      else if (ev?.kind === 'end') this.machine.speechEnd();
    }
    this.machine.frame(now, { cursor: this.handCursor ?? (this.prefs.mouseKeys ? this.mouse : null), hand: !!this.hand, pinched: this.pinched });
    this.flashes = this.flashes.filter(x => now - x.t < FLASH_MS);
    this.drawOverlay();
    if (now - this.lastPanel > 250) this.renderPanel();
  }

  private onHandFrame(f: HandFrame | null, now: number): void {
    this.hand = f;
    if (!f) {
      this.handCursor = null;
      this.fx.reset();
      this.fy.reset();
      this.drawPreviews();
      return;
    }
    this.ratio = pinchMetric2d(f.lm, f.vw, f.vh);
    this.pinched = this.hyst.update(this.ratio);
    const [u, v] = applyH(DEFAULT_H, pointerOf(f.lm));
    this.handCursor = { x: this.fx.filter(u * innerWidth, now / 1000), y: this.fy.filter(v * innerHeight, now / 1000) };
    this.drawPreviews();
  }

  // ---------- lock → deploy / cancel ----------

  private onLock(l: Lock): boolean {
    if (!this.host.playing()) return false;
    const [x, y] = this.host.toWorld(l.x, l.y);
    if (!this.host.canDeploy([x, y])) {
      if (l.by !== 'voice') this.flash(l, 'cancel', 'your half only');
      return false;
    }
    const nonce = this.host.begin([x, y], l.by);
    if (nonce === null) return false;
    const words = new Transcript();
    this.listeners.set(words, nonce);
    this.active = { nonce, spot: [x, y], words };
    const letGo = l.by === 'key' ? 'let go of Space' : 'let go';
    this.host.status(this.mic.on ? `say what the troop is, ${letGo} to deploy, Esc to cancel` : `locked: ${letGo} to deploy what's in the text box, Esc to cancel`);
    return true;
  }

  private async onDeploy(l: Lock): Promise<void> {
    const a = this.active;
    this.active = null;
    if (!a) return;
    this.flash(l, 'deploy', '');
    if (this.mic.on) await this.speech.flush(FLUSH_MS);
    this.listeners.delete(a.words);
    const d = chooseDescription(this.host.typedText(), a.words.text);
    if (d.ok) {
      if (d.from === 'typed') this.host.clearTyped();
      this.host.deploy(a.nonce, a.spot, d.text, { from: d.from, by: l.by, transcript: a.words.text });
      return;
    }
    const why =
      d.reason === 'cancel' ? 'cancelled'
      : this.mic.on && this.speech.available ? 'cancelled: no description heard'
      : this.mic.on ? 'cancelled: no speech recognition in this browser, type a description first'
      : 'cancelled: type a description first, or turn the mic on';
    this.flash(l, 'cancel', d.reason === 'cancel' ? 'cancelled' : 'no description');
    this.host.cancel(a.nonce, why, a.words.text);
  }

  private onCancel(l: Lock, reason: string): void {
    const a = this.active;
    this.active = null;
    if (!a) return;
    this.listeners.delete(a.words);
    const label = reason === 'drag' ? 'dragged off' : reason === 'hand lost' ? 'hand lost' : reason === 'key' ? '' : reason;
    if (reason === 'mismatch') {
      // Saying "that's wrong" starts a voice lock like any speech; it flags the last troop instead.
      this.flash(l, 'cancel', 'noted');
      this.host.cancel(a.nonce, 'cancelled (mismatch flag)', a.words.text);
      this.flagMismatch();
      return;
    }
    this.flash(l, 'cancel', label ? `cancel · ${label}` : 'cancel');
    this.host.cancel(a.nonce, label ? `cancelled (${label})` : 'cancelled', a.words.text);
  }

  private words(text: string, final: boolean): void {
    this.heard = text ? `heard: “${text}”` : this.heard;
    if (text) this.heardWords = true;
    for (const t of this.listeners.keys()) final ? t.final(text) : t.interim(text);
    if (final && text) this.host.heard?.(text, this.listeners.values().next().value ?? 0);
    const a = this.active;
    if (!a) {
      if (final && isMismatch(text)) this.flagMismatch();
      return;
    }
    // Act on interim words too: waiting for the final result adds most of a second.
    if (isCancel(a.words.text)) return this.machine.cancel('cancelled');
    if (isMismatch(a.words.text)) return this.machine.cancel('mismatch');
    if (a.words.text) {
      this.host.status(`“${a.words.text}”`);
      this.host.prefetch?.(a.words.text);
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
      this.machine.cancel('camera off');
      this.tracker?.stop();
      this.tracker = null;
      this.hand = null;
      this.handCursor = null;
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
      this.heard = this.speech.available ? 'listening' : 'no speech recognition in this browser: voice locks, typed text describes';
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
    if (p) drawCursor(g, p.x, p.y, this.pinched);
    this.overlayDrawn = !!p;
  }

  // ---------- UI ----------

  private mountUi(): void {
    this.el.id = 'inputPanel';
    this.el.innerHTML = `
      <div class="inRow">
        <button data-act="cam" title="Aim with your index knuckle, pinch thumb + middle finger to lock">Camera</button>
        <button data-act="mic" title="Start talking to lock, describe the troop, go quiet to deploy">Mic</button>
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
        <label>Done after <input type="range" data-act="vadEnd" min="300" max="1500" step="50"><span class="inVal" data-val="vadEnd"></span></label>
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
    q<HTMLInputElement>('vadEnd').value = String(this.prefs.vadEndMs);
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
      if (t.dataset.act === 'vadEnd') this.prefs.vadEndMs = this.vad.o.endMs = Number(t.value);
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
    const cam = this.tracker
      ? this.camStatus || (this.hand ? `hand · pinch ${this.ratio.toFixed(2)}${this.pinched ? ' ✓' : ''}` : 'no hand in view')
      : '';
    const mic = this.mic.on ? `${this.vad.level.toFixed(0)} dB${this.vad.speaking ? ' · speaking' : ''} · ${this.heard}` : this.heard;
    $('.inStatus').textContent = [cam, mic].filter(Boolean).join('\n');
    $('[data-val="vadDb"]').textContent = `${this.prefs.vadDb} dB`;
    $('[data-val="vadEnd"]').textContent = `${this.prefs.vadEndMs} ms`;
    const pct = (db: number) => `${Math.max(0, Math.min(100, ((db + 90) / 90) * 100))}%`;
    $('.inLevel').style.width = pct(this.mic.on ? this.vad.level : -90);
    $('.inLevel').classList.toggle('speaking', this.vad.speaking);
    $('.inThresh').style.left = pct(this.prefs.vadDb);
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
    const inv = invertH(DEFAULT_H);
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
    g.fillStyle = this.pinched ? '#4aa3ff' : '#ff5d6c';
    g.beginPath();
    g.arc(...P(5), 4, 0, Math.PI * 2);
    g.fill();
  }
}
