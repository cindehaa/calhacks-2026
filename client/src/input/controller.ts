// Camera + mic input: wires the hand tracker, the mic level and the transcript into the lock
// machine, and reports locks, deploys and cancels to the game.
//
// With the camera on, the pinch is push to talk: speech goes to Cartesia only while you hold it
// (plus 300 ms from just before), and letting go finalises it straight away, with no quiet timer.
// Voice click (talking alone locks at the cursor) is what the mic does without a camera, and an
// option with one. With the mic on, holding the mouse button or Space works like a pinch. Keys,
// clicks and the text box work as before.
import { drawCursor, FLASH_MS, type InputView } from './draw';
import { OneEuro } from './filter';
import { FlickDetector } from './flick';
import { HAND_CONNECTIONS, HandTracker, pointerOf, type AimPoint, type HandFrame } from './hand';
import { applyH, DEFAULT_H, invertH, type Pt2 } from './homography';
import { CursorHistory, LockMachine, LOCK_DEFAULTS, type Lock, type Pt } from './lock';
import { DEFAULT_PINCH, Hysteresis, pinchMetric2d, PinchOnset } from './pinch';
import { AutoSpeech } from './cartesia_stt';
import { chooseDescription, isCancel, isMismatch, Transcript } from './speech';
import { gated, voiceLocks, wasClick } from './ptt';
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
  released?(nonce: number, words: string): void; // let go; the last words are still being finalised
  // For the logs.
  heard?(text: string, nonce: number): void; // a finished speech segment; nonce 0 outside a lock
  mismatch?(): void; // the player said their last troop isn't what they asked for
  event?(kind: string, detail?: string): void;
}

export interface DeployHow {
  from: 'typed' | 'voice';
  by: string; // what held the lock at release: 'pinch', 'mouse', 'key', 'voice' or 'flick'
  transcript: string;
}

// The hand scheme, picked in the ⋯ menu so schemes can be tried side by side. Click: thumb against
// the middle or index finger (hold, like now), or a flick of the wrist (a tap). Steady: aim from
// lagMs before the pinch, or from when the fingers started closing.
type Click = 'middle' | 'index' | 'flick';
type Steady = 'lag' | 'onset';

interface Prefs {
  preview: boolean; vadDb: number; vadEndMs: number; voiceClick: boolean; camera: boolean; mic: boolean; mouseKeys: boolean;
  aim: AimPoint; click: Click; steady: Steady;
}

interface Active { nonce: number; spot: Spot; words: Transcript }

const FLUSH_MS = 600; // how long a deploy waits for the recogniser to finalise the last words (Cartesia: ~0.1 s)
const FLICK_SHOW_MS = 180; // the cursor fills this long after a flick
const SCREEN_IN_CAMERA = invertH(DEFAULT_H); // the screen's edges in camera coords, for the preview

export class InputController {
  private machine: LockMachine;
  private tracker: HandTracker | null = null;
  private mic = new Mic();
  private vad = new Vad({ ...VAD_DEFAULTS });
  private speech = new AutoSpeech(() => this.mic.media); // Cartesia, else the browser's recogniser
  private listeners = new Map<Transcript, number>(); // transcripts still taking words → their nonce
  private active: Active | null = null;

  private fx = new OneEuro(1.0, 0.007);
  private fy = new OneEuro(1.0, 0.007);
  private hyst = new Hysteresis(DEFAULT_PINCH.on, DEFAULT_PINCH.off);
  private pinchOnset = new PinchOnset();
  private flicker = new FlickDetector();
  private trail = new CursorHistory(); // the hand cursor, for measuring slip
  private press: { onset: number } | null = null; // a click this frame, consumed by tick()
  private flickT = -Infinity;
  private slips: number[] = []; // px the pointer moved during each recent click
  private prefs: Prefs = {
    preview: true, vadDb: VAD_DEFAULTS.thresholdDb, vadEndMs: VAD_DEFAULTS.endMs, voiceClick: false, camera: false, mic: false, mouseKeys: true,
    aim: 'knuckle', click: 'middle', steady: 'lag',
    ...load<Partial<Prefs>>(KEYS.prefs),
  };

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
  private pressT = 0; // when the current mouse press began
  private clickTaken = false; // the last mouse press became a voice deploy, not a click
  private setupPreview: HTMLCanvasElement | null = null;
  private openMic = false; // the setup screen's voice check: stream everything, no pinch needed
  onSetup?: () => void; // the ⋯ menu's "Run setup again"

  // DOM
  private el = document.createElement('div');
  private overlay = document.createElement('canvas'); // the hand cursor outside a match
  private preview!: HTMLCanvasElement;
  private hintEl = document.getElementById('talkHint'); // "hold Space to talk" under the board

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
    // Hold to talk with the mouse, when the mic is on. Up is watched on the window so letting go
    // off the canvas still counts.
    canvas.addEventListener('mousedown', e => {
      this.clickTaken = false;
      if (e.button !== 0 || !this.mic.on || !this.prefs.mouseKeys) return;
      this.pressT = performance.now();
      this.machine.press(this.pressT, { x: e.clientX, y: e.clientY });
    });
    addEventListener('mousemove', e => this.machine.pressMove({ x: e.clientX, y: e.clientY }));
    addEventListener('mouseup', e => {
      if (e.button === 0) this.machine.pressEnd({ x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener('mouseleave', () => (this.mouse = null));
    // Space and Escape stand in for the hand at any time: hold Space to lock at the cursor (hand or
    // mouse), let go to deploy; Escape cancels whatever is locked, like dragging off or saying "cancel".
    // An empty text box doesn't count as typing during a match: clicking the board focuses the
    // description box, and Space there would otherwise type a space instead of talking.
    const idleBox = (t: EventTarget | null) => this.host.playing() && t instanceof HTMLInputElement && !t.value;
    const typing = (t: EventTarget | null) =>
      (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) && !idleBox(t);
    addEventListener('keydown', e => {
      if (e.key === 'Escape') this.machine.cancel('key');
      else if (e.code === 'Space' && !typing(e.target)) {
        e.preventDefault(); // no page scroll, no clicking a focused button
        if (idleBox(e.target)) (e.target as HTMLInputElement).blur();
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

  // While the setup screen is open, audio streams without a pinch so "say hello" is heard even
  // with the camera on (push to talk would hold it back). Talking still can't lock: no match.
  listenFreely(on: boolean): void {
    this.openMic = on;
    this.syncGate();
  }

  // Open the STT sockets ahead of the first deploy (match start). Nothing to do with the mic off.
  warm(): void {
    if (this.mic.on) this.speech.warm();
  }

  // True once if the mouse press that just ended was a hold-to-talk deploy, so the game's click
  // handler leaves it alone instead of also picking a typing spot.
  tookClick(): boolean {
    const t = this.clickTaken;
    this.clickTaken = false;
    return t;
  }

  // What the board (pov.ts) draws over itself. Undefined while camera and mic are both off.
  view(): InputView | undefined {
    if (!this.tracker && !this.mic.on && !this.flashes.length) return undefined;
    const l = this.machine.lock, now = performance.now();
    return {
      cursor: this.handCursor && this.host.playing() ? { ...this.handCursor, pinched: this.clicking(now) } : null,
      lock: l && {
        x: l.x,
        y: l.y,
        by: l.by,
        out: this.machine.dragDistance(now) > this.machine.o.dragRadius,
        radius: l.by === 'flick' ? 0 : this.machine.o.dragRadius,
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
      // A flick lock is a tap, so going quiet deploys it even when talking alone doesn't lock.
      const voice = this.voiceLocks() || this.machine.lock?.by === 'flick';
      if (voice && ev?.kind === 'start') this.machine.speechStart(ev.t);
      else if (ev?.kind === 'end' && voice) {
        this.machine.speechEnd();
        // Close the utterance so the next one starts clean (a no-op if a deploy already flushed).
        // Push to talk doesn't need this: only held audio is sent, and letting go flushes it.
        const by = this.machine.lock?.by;
        if (by !== 'pinch' && by !== 'mouse' && by !== 'key') this.speech.flush(FLUSH_MS);
      }
    }
    const press = this.press;
    this.press = null;
    const pinchOnset = press && this.prefs.click !== 'flick' && this.prefs.steady === 'onset' ? press.onset : undefined;
    this.machine.frame(now, { cursor: this.handCursor ?? (this.prefs.mouseKeys ? this.mouse : null), hand: !!this.hand, pinched: this.pinched, onset: pinchOnset });
    if (press && this.prefs.click === 'flick') {
      this.machine.flick(now, press.onset);
      // Without the mic nothing will be said: deploy what's typed straight away.
      if (!this.mic.on && this.machine.lock?.by === 'flick') this.machine.release();
    }
    this.flashes = this.flashes.filter(x => now - x.t < FLASH_MS);
    this.drawOverlay();
    if (now - this.lastPanel > 250) this.renderPanel();
    else this.renderHint(); // hides the moment a lock starts
  }

  private onHandFrame(f: HandFrame | null, now: number): void {
    this.hand = f;
    if (!f) {
      this.resetHand();
      this.drawPreviews();
      return;
    }
    const [u, v] = applyH(DEFAULT_H, pointerOf(f.lm, this.prefs.aim));
    this.handCursor = { x: this.fx.filter(u * innerWidth, now / 1000), y: this.fy.filter(v * innerHeight, now / 1000) };
    this.trail.push(now, this.handCursor);
    let onset: number | null = null;
    if (this.prefs.click === 'flick') {
      onset = this.flicker.update(now, f.lm, f.vw, f.vh);
      if (onset !== null) this.flickT = now;
    } else {
      this.ratio = pinchMetric2d(f.lm, f.vw, f.vh, this.prefs.click);
      this.pinchOnset.push(now, this.ratio);
      const was = this.pinched;
      this.pinched = this.hyst.update(this.ratio);
      if (this.pinched && !was) onset = this.pinchOnset.onset() ?? now;
    }
    if (onset !== null) {
      this.press = { onset };
      this.noteSlip(onset);
    }
    this.drawPreviews();
  }

  private resetHand(): void {
    this.handCursor = null;
    this.fx.reset();
    this.fy.reset();
    this.trail.clear();
    this.pinchOnset.clear();
    this.flicker.reset();
  }

  // How far the pointer moved between the click starting and registering: what the click gesture
  // itself does to the aim. Shown in the panel and logged, to compare schemes.
  private noteSlip(onset: number): void {
    const from = this.trail.at(onset), to = this.handCursor;
    if (!from || !to) return;
    const px = Math.round(Math.hypot(to.x - from.x, to.y - from.y));
    this.slips = [...this.slips.slice(-9), px];
    this.host.event?.('gesture:slip', `${this.scheme()} ${px}px`);
  }

  private scheme(): string {
    const p = this.prefs;
    return `${p.aim}/${p.click}${p.click === 'flick' ? '' : '/' + p.steady}`;
  }

  // The cursor fills while pinched, or for a moment after a flick.
  private clicking(now: number): boolean {
    return this.prefs.click === 'flick' ? now - this.flickT < FLICK_SHOW_MS : this.pinched;
  }

  // A new scheme starts from a clean slate: nothing locked, no half-finished pinch.
  private setScheme(): void {
    this.machine.cancel('scheme changed');
    this.resetHand();
    this.hyst.reset();
    this.pinched = false;
    this.ratio = 0;
    this.slips = [];
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
    if (l.by !== 'voice' && this.mic.on) void this.speech.hold(true);
    const letGo = l.by === 'key' ? 'let go of Space' : l.by === 'flick' ? 'go quiet or flick again' : 'let go';
    this.host.status(this.mic.on ? `say what the troop is, ${letGo} to deploy, Esc to cancel` : `locked: ${letGo} to deploy what's in the text box, Esc to cancel`);
    return true;
  }

  private async onDeploy(l: Lock): Promise<void> {
    const a = this.active;
    this.active = null;
    if (!a) return;
    // A quick click with nothing said or typed: hand it back to the click-to-type spot.
    if (l.by === 'mouse' && wasClick(performance.now() - this.pressT, a.words.text, this.host.typedText())) {
      this.listeners.delete(a.words);
      void this.speech.hold(false).then(() => this.speech.flush(FLUSH_MS));
      this.host.cancel(a.nonce, '', a.words.text);
      return;
    }
    if (l.by === 'mouse') this.clickTaken = true;
    this.flash(l, 'deploy', '');
    this.host.released?.(a.nonce, a.words.text);
    if (this.mic.on) {
      await this.speech.hold(false);
      await this.speech.flush(FLUSH_MS);
    }
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
    if (l.by === 'mouse') this.clickTaken = true;
    this.listeners.delete(a.words);
    // Close what was said so it can't bleed into the next lock.
    if (this.mic.on) void this.speech.hold(false).then(() => this.speech.flush(FLUSH_MS));
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

  // Whether talking alone locks a spot (voice click), and with it whether audio streams all the
  // time or only while a pinch or press is held.
  private voiceLocks(): boolean {
    return voiceLocks(!!this.tracker, this.prefs.voiceClick);
  }

  private syncGate(): void {
    this.speech.setGated(gated(this.mic.on, this.voiceLocks() || this.openMic));
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
      this.syncGate();
      this.renderPanel();
      return;
    }
    const t = (this.tracker = new HandTracker());
    this.syncGate();
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
        this.syncGate();
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
      this.syncGate();
      this.speech.start();
      this.heard = this.speech.available ? `listening (${this.speech.engine})` : 'no speech recognition in this browser: voice locks, typed text describes';
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
    if (p) drawCursor(g, p.x, p.y, this.clicking(performance.now()));
    this.overlayDrawn = !!p;
  }

  // ---------- UI ----------

  private mountUi(): void {
    this.el.id = 'inputPanel';
    this.el.innerHTML = `
      <div class="inRow">
        <button data-act="cam">Camera</button>
        <button data-act="mic" title="Pinch (or hold the mouse or Space) and talk, let go to deploy. Without the camera, starting to talk also locks.">Mic</button>
        <button data-act="menu" class="ghost" title="Camera and mic settings">⋯</button>
      </div>
      <div class="inPreview"><canvas></canvas></div>
      <div class="inStatus"></div>
      <div class="inMenu" hidden>
        <button data-act="setup" class="ghost">Run setup again</button>
        <label><input type="checkbox" data-act="mouseKeys"> Mouse and keyboard</label>
        <label><input type="checkbox" data-act="preview"> Camera preview</label>
        <label>Aim with <select data-act="aim">
          <option value="knuckle">index knuckle</option>
          <option value="tip">index fingertip</option>
          <option value="palm">palm centre</option>
        </select></label>
        <label>Click with <select data-act="click">
          <option value="middle">pinch thumb + middle (hold)</option>
          <option value="index">pinch thumb + index (hold)</option>
          <option value="flick">flick wrist down (tap)</option>
        </select></label>
        <label>Aim from <select data-act="steady">
          <option value="lag">100 ms before the pinch</option>
          <option value="onset">when fingers start closing</option>
        </select></label>
        <label title="With the camera on, the pinch is push to talk. Tick this to also lock by just talking (open mic)."><input type="checkbox" data-act="voiceClick"> Voice click with camera</label>
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
    q<HTMLSelectElement>('aim').value = this.prefs.aim;
    q<HTMLSelectElement>('click').value = this.prefs.click;
    q<HTMLSelectElement>('steady').value = this.prefs.steady;
    q<HTMLInputElement>('voiceClick').checked = this.prefs.voiceClick;
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
      if (t.dataset.act === 'aim' || t.dataset.act === 'click' || t.dataset.act === 'steady') {
        (this.prefs as unknown as Record<string, string>)[t.dataset.act] = t.value;
        this.setScheme();
        this.host.event?.('gesture:scheme', this.scheme());
        t.blur(); // keep Space going to the game
      }
      if (t.dataset.act === 'mouseKeys') this.prefs.mouseKeys = t.checked;
      if (t.dataset.act === 'preview') this.prefs.preview = t.checked;
      if (t.dataset.act === 'voiceClick') {
        this.prefs.voiceClick = t.checked;
        this.syncGate();
      }
      if (t.dataset.act === 'vadDb') this.prefs.vadDb = this.vad.o.thresholdDb = Number(t.value);
      if (t.dataset.act === 'vadEnd') this.prefs.vadEndMs = this.vad.o.endMs = Number(t.value);
      save(KEYS.prefs, this.prefs);
      this.renderPanel();
    });
    this.renderPanel();
  }

  private howTo(): string {
    const aim = { knuckle: 'your index knuckle', tip: 'your index fingertip', palm: 'the middle of your palm' }[this.prefs.aim];
    const click = {
      middle: 'pinch thumb + middle finger to lock, let go to deploy',
      index: 'pinch thumb + index finger to lock, let go to deploy',
      flick: 'flick your wrist down to lock, then describe it; go quiet or flick again to deploy',
    }[this.prefs.click];
    return `Aim with ${aim}, ${click}`;
  }

  private renderPanel(): void {
    this.lastPanel = performance.now();
    const $ = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    $('[data-act="cam"]').classList.toggle('on', !!this.tracker);
    $('[data-act="cam"]').title = this.howTo();
    $<HTMLSelectElement>('[data-act="steady"]').disabled = this.prefs.click === 'flick';
    $('[data-act="mic"]').classList.toggle('on', this.mic.on);
    $('.inPreview').hidden = !this.tracker || !this.prefs.preview;
    const now = performance.now();
    const grip = this.prefs.click === 'flick' ? `flick${this.clicking(now) ? ' ✓' : ''}` : `pinch ${this.ratio.toFixed(2)}${this.pinched ? ' ✓' : ''}`;
    const s = this.slips;
    const slip = s.length ? ` · slip ${s[s.length - 1]}px (avg ${Math.round(s.reduce((a, b) => a + b, 0) / s.length)} of ${s.length})` : '';
    const cam = this.tracker
      ? this.camStatus || (this.hand ? `hand · ${grip}${slip}` : 'no hand in view')
      : '';
    const mode = this.voiceLocks() ? 'talk to lock' : 'pinch or hold to talk';
    const mic = this.mic.on ? `${this.vad.level.toFixed(0)} dB${this.vad.speaking ? ' · speaking' : ''} · ${mode} · ${this.heard}` : this.heard;
    $('.inStatus').textContent = [cam, mic].filter(Boolean).join('\n');
    $('[data-val="vadDb"]').textContent = `${this.prefs.vadDb} dB`;
    $('[data-val="vadEnd"]').textContent = `${this.prefs.vadEndMs} ms`;
    const pct = (db: number) => `${Math.max(0, Math.min(100, ((db + 90) / 90) * 100))}%`;
    $('.inLevel').style.width = pct(this.mic.on ? this.vad.level : -90);
    $('.inLevel').classList.toggle('speaking', this.vad.speaking);
    $('.inThresh').style.left = pct(this.prefs.vadDb);
    this.renderHint();
  }

  // How to talk a troop in, shown during a match while nothing is locked (a lock draws its own
  // "say the troop… let go to deploy" at the spot).
  private renderHint(): void {
    const el = this.hintEl;
    if (!el) return;
    const text = !this.host.playing() || this.machine.lock ? '' : this.hintText();
    if (el.textContent !== text) el.textContent = text;
    el.hidden = !text;
  }

  private hintText(): string {
    if (!this.mic.on) return this.heard.startsWith('mic failed') ? `${this.heard} · allow it from the address bar, then press Mic` : 'Turn on the Mic (top left) to speak troops in';
    const ways = [this.tracker && 'pinch', this.prefs.mouseKeys ? 'hold Space or the mouse' : 'hold Space'].filter(Boolean).join(', ');
    const how = `${ways[0].toUpperCase()}${ways.slice(1)} over your half, say the troop, let go to deploy`;
    if (!this.speech.available) return `${how} · no speech recognition here, so type the troop first`;
    return this.voiceLocks() ? `${how} · or just start talking` : how;
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
    g.fillStyle = this.clicking(performance.now()) ? '#4aa3ff' : '#ff5d6c';
    g.beginPath();
    const [ax, ay] = pointerOf(lm, this.prefs.aim);
    g.arc(ax * w, ay * h, 4, 0, Math.PI * 2);
    g.fill();
  }
}
