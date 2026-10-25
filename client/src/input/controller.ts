// Camera + mic input: the input hub. It owns the camera, mic and recogniser, publishes what they
// read as signals to the control scheme (schemes/pinch.ts), and carries out the intents it emits:
// commit, cancel, clear, click a menu. The game only sees the InputHost calls.
//
// The mic listens the whole time it's on, and everything said since the last fire is the troop.
// Aim with the index fingertip (or the mouse). Fire by touching the thumb to the middle or index
// finger, pressing Space, or clicking the board with words waiting: the troop goes where you were
// pointing just before. Thumbs down or "cancel" takes back a troop still being summoned; before a
// pinch, thumbs down, Esc or "cancel" throws the words away. Typed text and click-to-type work as before.
import { drawCursor, drawDwell, MISS_MS, type CursorState, type InputView } from './draw';
import { clearNotice, notice, noticeShowing } from '../notice';
import { sfx } from '../sfx';
import { OneEuro } from './filter';
import { HAND_CONNECTIONS, HandTracker, pointerOf, releaseHandTracker, type HandFrame } from './hand';
import { drawHandView, drawScreenInset } from './handview';
import { HandPicker, type HandPref } from './handpick';
import { applyH, DEFAULT_H, invertH, type Pt2 } from './homography';
import { PINCH_DEFAULTS, PinchDetector, extension, thumbDownScore, type PinchShot, type PinchThresholds } from './pose';
import { NearMiss } from './nearmiss';
import { hidePinchHint, showPinchHint } from './pinchhint';
import { AutoSpeech } from './cartesia_stt';
import { chooseDescription, FIRE_WAIT_MS, fireWaits, isCancel, isMismatch, routeWords, Transcript } from './speech';
import { KEYS, load, save } from './store';
import { CursorHistory, type Pt } from './trail';
import { Mic, Vad, VAD_DEFAULTS } from './voice';
import { activateUi, menuBack, menuMode, menuPointer } from './menus';
import { pinch, THUMB_DOWN } from './schemes/pinch';
import type { Intent, Scheme, SchemeCtx, SchemeInstance, Signal } from './schemes/types';
import { DEV_MODE } from '../devmode';
import './input.css';

// A phone or tablet: no hover, Space or Esc, so the hints say tap.
export const TOUCH = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

type Spot = [number, number]; // world coords


// What the game provides. begin() starts the server-side deploy clock and returns its handle
// (null refuses); deploy() and cancel() finish it.
export interface InputHost {
  playing(): boolean;
  started?(): boolean; // past the versus card and countdown
  canDeploy(spot: Spot): boolean; // anywhere on the board: past your zone it casts a spell
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
  // A box that takes spoken words (the room code) has focus: it gets them instead of the prompt.
  // True if it took them.
  dictate?(raw: string, final: boolean, epoch: number): boolean;
  event?(kind: string, detail?: string, nonce?: number): void;
}

export interface DeployHow {
  from: 'typed' | 'voice';
  by: string; // what fired it: 'release' (of a pinch), 'key', 'mouse'
  transcript: string;
}

// pinch: thresholds fitted to the player's hand (practice.ts) or set in the ⋯ menu, null for the defaults.
interface Prefs { preview: boolean; vadDb: number; camera: boolean; mic: boolean; mouseKeys: boolean; hand: HandPref; pinch: PinchThresholds | null }

// A fire waiting for the recogniser to finish its last words: those from audio up to cut. The cut
// happens FIRE_GRACE_MS after the fire (cut is Infinity until then: every word is the troop's).
interface Firing { nonce: number; spot: Spot; at: Pt; by: string; words: Transcript; cut: number; done: Promise<void>; t: number }

// A fire cuts the audio this long after its moment, so a word still being finished when the hand
// fires ("a fire drag|on") stays with the troop instead of starting the next one.
export const FIRE_GRACE_MS = 150;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
// Index straight and the other fingers curled, roughly: index tip far from the wrist vs the rest.
function pointing(f: HandFrame): number {
  const w = f.world, d = (i: number) => Math.hypot(w[i].x - w[0].x, w[i].y - w[0].y, w[i].z - w[0].z);
  const others = (d(12) + d(16) + d(20)) / 3;
  return (d(8) / (others || 1e-9) - 1.1) / 0.6;
}

const PINCH_AIM_MS = 100; // a pinch aims from where the hand was this long before it closed
// A held pinch is let go once the measure has read open this long, so a frame or two of flicker
// mid-drag doesn't place early, and it aims from this long before the hand began to open, since
// spreading thumb and finger moves the aim point.
const RELEASE_OPEN_MS = 80;
const RELEASE_AIM_MS = 100;

const FLUSH_MS = 600; // cap on finalising an utterance when the talking stops or the words are cleared
const LOST_MS = 1000; // hand out of view this long before "show your hand"
const FADE_MS = 450; // the cursor fades out over this when the hand goes
const FIRE_SHOW_MS = 180; // the cursor fills this long after a pinch
const SCREEN_IN_CAMERA = invertH(DEFAULT_H); // the screen's edges in camera coords, for the preview

export class InputController {
  private tracker: HandTracker | null = null;
  private mic = new Mic();
  private vad = new Vad({ ...VAD_DEFAULTS });
  private speech = new AutoSpeech(() => this.mic.media); // Cartesia, else the browser's recogniser
  private prompt = new Transcript(); // words since the last fire or cancel
  private firing: Firing | null = null;
  private dropped = -1; // newest speech epoch already fired or cleared: its late words are dropped

  private fx = new OneEuro(1.0, 0.007);
  private fy = new OneEuro(1.0, 0.007);
  private thumbDown = 0; // the last thumbs-down score, 0..1
  private pinch = new PinchDetector();
  private ratio: number | null = null; // the control hand's pinch measure, null with no hand
  private shot: PinchShot | null = null; // the pinch at pinchT, for the logs
  private switchedAt = -Infinity; // when the control hand was last chosen
  private speechAt = -Infinity; // when the mic last heard speech start (VAD)
  private firedAt = -Infinity; // when the last deploy began
  private nearMiss = new NearMiss(); // pinches that almost close, for the pinch guide
  private trail = new CursorHistory(); // the hand cursor, to aim from before a pinch

  readonly scheme: Scheme = pinch;
  private inst!: SchemeInstance;
  private inFlight = new Map<number, { at: Pt; sent: boolean }>(); // begun deploys, until they settle
  private handled = false; // an intent during this publish did something (a click that fired)
  readonly listeners: { signal: ((s: Signal) => void)[]; intent: ((i: Intent, ok: boolean) => void)[] } = { signal: [], intent: [] };
  private pinchT = -Infinity; // the last release (or pinch, before one), for the cursor flash and the logs
  private held = false; // a pinch closed and hasn't been let go
  private openSince: number | null = null; // the held pinch has read open since
  private prefs: Prefs = {
    preview: true, vadDb: VAD_DEFAULTS.thresholdDb, camera: false, mic: false, mouseKeys: true, hand: 'auto', pinch: null,
    ...load<Partial<Prefs>>(KEYS.prefs),
  };

  private hand: HandFrame | null = null; // the control hand
  private others: HandFrame[] = []; // hands in view that aren't (the mic hand, usually)
  private picker = new HandPicker();
  private handCursor: Pt | null = null;
  private mouse: Pt | null = null;
  private flashes: InputView['flashes'] = [];
  private overlayDrawn = false;
  private camStatus = '';
  private heard = '';
  private heardWords = false; // the recogniser has returned words at least once
  private lostAt = 0; // when the hand went out of view, 0 while it's in view
  private lostCursor: Pt | null = null; // where it was, for the fade
  private fellBack = false; // Cartesia gave up; say so once, in a match
  private hinted = false; // the how-to after a fire with no words shows once
  private flaggedAt = 0; // last mismatch flag: interim words flag it, then the final repeats them
  private lastPanel = 0;
  private clickTaken = false; // the last mouse press fired, so it isn't also a click-to-type
  private setupPreview: HTMLCanvasElement | null = null;
  private setupSeen: { c: HTMLCanvasElement; label: HTMLElement } | null = null;
  onSetup?: () => void; // the ⋯ menu's "Run setup again"
  onCalibrate?: () => void; // the ⋯ menu's "Fit pinch to my hand"

  // DOM
  private el = document.createElement('div');
  private overlay = document.createElement('canvas'); // the hand cursor outside a match
  private preview!: HTMLCanvasElement;
  private handView = document.createElement('div'); // the virtual hand, bottom right
  private hintEl = document.getElementById('talkHint'); // how to fire, under the board

  constructor(canvas: HTMLCanvasElement, private host: InputHost) {
    this.vad.o.thresholdDb = this.prefs.vadDb;
    this.picker.pref = this.prefs.hand;
    this.applyPinch();
    this.speech.setGated(false); // always listening
    this.speech.onPartial = (t, e) => this.words(t, false, e);
    this.speech.onFinal = (t, e) => this.words(t, true, e);
    this.speech.onFallback = () => (this.fellBack = true); // told once a match is under way
    this.speech.onError = msg => {
      this.heard = msg;
      this.host.event?.('speech:error', msg);
      this.renderPanel();
    };

    canvas.addEventListener('mousemove', e => {
      this.mouse = { x: e.clientX, y: e.clientY };
      this.publish({ kind: 'mouse', t: performance.now(), at: this.mouse, phase: 'move' });
    });
    canvas.addEventListener('mouseleave', () => (this.mouse = null));
    // Clicking the board with words waiting fires them there. With nothing said it's an ordinary
    // click, which picks the spot for typing.
    canvas.addEventListener('mousedown', e => {
      this.clickTaken = false;
      if (e.button !== 0 || !this.prefs.mouseKeys || !this.prompt.text || this.firing) return;
      this.clickTaken = this.publish({ kind: 'mouse', t: performance.now(), at: { x: e.clientX, y: e.clientY }, phase: 'down' });
    });
    // Space fires at the cursor (hand or mouse); Esc throws the words away. An empty text box
    // doesn't count as typing during a match: clicking the board focuses it.
    const idleBox = (t: EventTarget | null) => this.host.playing() && t instanceof HTMLInputElement && !t.value;
    const typing = (t: EventTarget | null) =>
      (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) && !idleBox(t);
    addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        this.publish({ kind: 'key', t: performance.now(), key: 'Escape', repeat: e.repeat });
        if (this.menus()) menuBack();
      } else if (e.code === 'Space' && !typing(e.target)) {
        e.preventDefault(); // no page scroll, no clicking a focused button
        if (idleBox(e.target)) (e.target as HTMLInputElement).blur();
        if (e.repeat) return;
        // On a menu Space clicks the button under the hand or mouse, else the focused or main one.
        this.publish({ kind: 'key', t: performance.now(), key: 'Space', repeat: false });
      }
    });
    this.startScheme();
    this.mountUi();
    // Dev builds: drive the hand cursor without a camera (window.__hand.move(x, y), .pinch(),
    // .clear()) and speak without a mic (.say(text)), for headless checks of the menus.
    if (import.meta.env.DEV) {
      let saidN = 0;
      (window as unknown as { __hand: unknown }).__hand = {
        move: (x: number, y: number) => (this.handCursor = { x, y }),
        pinch: () => {
          if (!this.handCursor) return;
          const t = performance.now();
          this.publish({ kind: 'pinch', t, aim: this.handCursor });
          this.pinchT = t + 1;
          this.publish({ kind: 'release', t: t + 1, aim: this.handCursor });
        },
        // A whole frame: drives the hand signal (and the intent gate) without a camera. thumbDown
        // is the score (0..1), pinched what the pinch measure says.
        // ratio drives the pinch measure instead (pose.ts pinchMetric): pinches, near misses and all.
        frame: (x: number, y: number, o: { thumbDown?: number; pinched?: boolean; ratio?: number } = {}) => {
          const now = performance.now();
          this.handCursor = { x, y };
          this.thumbDown = o.thumbDown ?? 0;
          if (o.ratio === undefined) return void this.publish(this.handSignal(now, this.handCursor, null, o.pinched ?? false));
          this.ratio = o.ratio;
          const pinched = this.pinch.push(o.ratio, now);
          this.publish(this.handSignal(now, this.handCursor, null, this.pinch.closed));
          if (pinched) {
            this.held = true;
            this.openSince = null;
            this.publish({ kind: 'pinch', t: now, aim: this.handCursor });
          }
          this.checkRelease(now);
          this.checkNearMiss(now);
        },
        lost: () => {
          this.handCursor = null;
          this.publish({ kind: 'hand', t: performance.now(), visible: false });
        },
        clear: () => (this.handCursor = null),
        // Synthetic MediaPipe frames, up to two hands: { lm, world, side: 'left' | 'right' | null }.
        // Goes through the control-hand choice like the camera does. Returns the choice.
        hands: (hs: Omit<HandFrame, 'vw' | 'vh'>[]) => {
          const t = performance.now();
          this.onHandFrames(hs.map(h => ({ vw: 1280, vh: 720, ...h })), t);
          return { control: this.hand ? hs.findIndex(h => h.lm === this.hand!.lm) : -1, reasons: this.lastPick, cursor: this.handCursor };
        },
        setPref: (p: HandPref) => this.setHandPref(p),
        // Every intent the scheme emitted, and whether it did anything.
        intents: (() => { const a: (Intent & { ok: boolean })[] = []; this.listeners.intent.push((i, ok) => a.push({ ...i, ok })); return a; })(),
        // Words as if the recogniser heard them, each call its own utterance.
        say: (text: string, final = true) => this.words(` ${text}`, final, 1e6 + saidN++),
      };
    }
    const loop = () => {
      requestAnimationFrame(loop);
      this.tick(performance.now());
    };
    requestAnimationFrame(loop);
    // Turn back on whatever was on last visit; the browser remembers the permission.
    if (this.prefs.camera) void this.setCamera(true);
    if (this.prefs.mic) void this.setMic(true);
  }

  // Mouse and keyboard mode: the mouse aims and clicks. On by default
  // alongside the hand, and the fallback if vision fails; Space and Esc work either way.
  get mouseKeys(): boolean {
    return this.prefs.mouseKeys;
  }

  // Which hand points: 'auto' picks it (handpick.ts), 'left' or 'right' only ever accepts that one.
  get handPref(): HandPref {
    return this.prefs.hand;
  }

  setHandPref(p: HandPref): void {
    this.prefs.hand = this.picker.pref = p;
    this.picker.reset();
    save(KEYS.prefs, this.prefs);
    this.el.querySelectorAll<HTMLSelectElement>('[data-act="hand"]').forEach(s => (s.value = p));
    document.querySelectorAll<HTMLSelectElement>('select[data-hand-pref]').forEach(s => (s.value = p));
  }

  // When a pinch closes and opens again: fitted to this player's hand, or the defaults.
  get pinchThresholds(): PinchThresholds {
    return this.prefs.pinch ?? PINCH_DEFAULTS;
  }

  // null goes back to the defaults. The next person at the laptop fits their own in setup.
  setPinch(t: PinchThresholds | null): void {
    this.prefs.pinch = t;
    save(KEYS.prefs, this.prefs);
    this.applyPinch();
    this.syncPinchUi();
    this.renderPanel();
  }

  private applyPinch(): void {
    const t = this.pinchThresholds;
    this.pinch.setThresholds(t);
    this.nearMiss.fit(t);
  }

  // The mic is on and something turns it into words.
  get listening(): boolean {
    return this.mic.on && this.speech.available;
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

  // Setup's camera feed, the one place the raw camera shows, and next to it what the game makes
  // of it: the virtual hand, where the cursor lands on the screen, and the gesture. Drawn while visible.
  attachPreview(c: HTMLCanvasElement, seen?: { c: HTMLCanvasElement; label: HTMLElement }): void {
    this.setupPreview = c;
    this.setupSeen = seen ?? null;
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
      cursor: this.handCursor && playing && !this.menus() ? { ...this.handCursor, state: this.cursorState(performance.now()) }
        : this.lostCursor && playing && performance.now() - this.lostAt < FADE_MS ? { ...this.lostCursor, state: 'open', fade: 1 - (performance.now() - this.lostAt) / FADE_MS } : null,
      prompt: playing && at && (words || this.vad.speaking) ? { x: at.x, y: at.y, text: words, speaking: this.vad.speaking } : null,
      flashes: this.flashes,
      mic: playing && this.mic.on && at ? { x: at.x, y: at.y, db: this.vad.level, speaking: this.vad.speaking } : null,
      hint: '', // "show your hand" is a notice now, after a second out of view
    };
  }

  // ---------- per frame ----------

  private tick(now: number): void {
    const f = this.tracker?.detect(now);
    if (f !== undefined) this.onHandFrames(f, now);
    if (this.mic.on) {
      const db = this.mic.levelDb();
      const ev = this.vad.push(now, db);
      this.publish({ kind: 'level', t: now, db, loud: db > this.vad.o.thresholdDb });
      if (ev?.kind === 'start') this.speechAt = ev.t;
      if (ev) this.publish({ kind: 'voice', t: ev.t, phase: ev.kind });
      // Close each utterance when the talking stops, so its words are final before the next fire.
      if (ev?.kind === 'end') void this.speech.flush(FLUSH_MS);
    }
    this.publish({ kind: 'tick', t: now });
    this.flashes = this.flashes.filter(x => now - x.t < MISS_MS);
    menuPointer.update(now, this.handCursor, this.host.playing());
    // A round under way without the camera: the warm tracker isn't wanted, so give its GPU memory back.
    if (!this.tracker && this.host.playing() && (this.host.started?.() ?? true)) releaseHandTracker();
    // Once the countdown is over, so it isn't missed under the versus card.
    if (this.fellBack && this.mic.on && this.host.playing() && (this.host.started?.() ?? true)) {
      this.fellBack = false;
      notice(this.speech.available ? 'Using your browser’s speech instead · same game, a touch slower' : 'No speech here · type the troop instead', { tone: 'warn', ms: 3400, key: 'speech', rank: 1 });
    }
    this.drawOverlay();
    if (now - this.lastPanel > 250) this.renderPanel();
    else this.renderHint();
  }

  // Every hand in view: one is chosen to control (handpick.ts), the rest are ignored. Pinch and
  // thumbs down are only measured on the control hand.
  private lastPick: string[] = [];
  private onHandFrames(fs: HandFrame[], now: number): void {
    const p = this.picker.update(fs, now);
    this.lastPick = p.reasons;
    this.others = fs.filter((_, i) => i !== p.control);
    if (p.fresh && p.control >= 0) {
      this.pinch.rearm();
      this.switchedAt = now;
    }
    this.onHandFrame(p.control >= 0 ? fs[p.control] : null, now);
  }

  private onHandFrame(f: HandFrame | null, now: number): void {
    this.hand = f;
    if (!f) {
      if (this.handCursor) { this.lostAt = now; this.lostCursor = this.handCursor }
      this.resetHand();
      this.publish({ kind: 'hand', t: now, visible: false });
      this.checkNearMiss(now);
      this.drawPreviews();
      this.handLost(now);
      return;
    }
    if (this.lostAt) { this.lostAt = 0; this.lostCursor = null; clearNotice('hand') }
    const [u, v] = applyH(DEFAULT_H, pointerOf(f.lm));
    this.handCursor = { x: this.fx.filter(u * innerWidth, now / 1000), y: this.fy.filter(v * innerHeight, now / 1000) };
    this.trail.push(now, this.handCursor);
    this.thumbDown = thumbDownScore(f.lm, f.world, f.vw, f.vh);
    const pinched = this.pinch.update(f.lm, f.vw, f.vh, now);
    this.ratio = this.pinch.ratio;
    this.publish(this.handSignal(now, this.handCursor, f, this.pinch.closed));
    if (pinched) {
      this.held = true;
      this.openSince = null;
      this.shot = this.pinch.last;
      this.publish({ kind: 'pinch', t: now, aim: this.trail.at(now - PINCH_AIM_MS) ?? this.handCursor });
    }
    this.checkRelease(now);
    this.checkNearMiss(now);
    this.drawPreviews();
  }

  // A held pinch opening: once it has read open for RELEASE_OPEN_MS, the release fires, aimed from
  // just before it began to open.
  private checkRelease(now: number): void {
    if (!this.held || !this.handCursor) return;
    if (this.pinch.closed) return void (this.openSince = null);
    this.openSince ??= now;
    if (now - this.openSince < RELEASE_OPEN_MS) return;
    const aim = this.trail.at(this.openSince - RELEASE_AIM_MS) ?? this.handCursor;
    this.held = false;
    this.openSince = null;
    this.pinchT = now;
    this.publish({ kind: 'release', t: now, aim });
  }

  // The control hand's pinch measure (thumb to finger, in hand sizes), null with no hand. For the
  // practice screen's meter.
  pinchRatio(): number | null {
    return this.ratio;
  }

  // Trying to pinch and it won't close: a few near misses with the hand over your half, in a
  // match, show the pinch guide in the corner (rate limited in nearmiss.ts).
  private checkNearMiss(now: number): void {
    const c = this.handCursor, playing = this.host.playing();
    if (!playing) hidePinchHint();
    const active = !!c && playing && (this.host.started?.() ?? true) && !this.menus() && this.host.canDeploy(this.host.toWorld(c.x, c.y));
    if (this.nearMiss.push(now, this.ratio, active)) {
      showPinchHint();
      this.host.event?.('hint:pinch');
    }
  }


  // The hand left the camera (or the camera stopped): the cursor fades where it was, and after a
  // second a gentle "show your hand" holds until it's back.
  private handLost(now: number): void {
    if (!this.host.playing() || !this.tracker?.ready) return clearNotice('hand');
    if (!this.lostAt) this.lostAt = now;
    if (now - this.lostAt > LOST_MS && !noticeShowing('hand')) {
      notice('Show your hand to the camera to aim', { tone: 'warn', hold: true, key: 'hand' });
    }
  }

  private resetHand(): void {
    this.handCursor = null;
    this.fx.reset();
    this.fy.reset();
    this.trail.clear();
    this.thumbDown = 0;
    this.pinch.reset();
    this.ratio = null;
    this.held = false; // losing the hand mid-hold places nothing
    this.openSince = null;
  }

  // The hand works the menus (home, setup, dialogs, result) rather than aiming troops.
  private menus(): boolean {
    return menuMode(this.host.playing());
  }

  private cursor(): Pt | null {
    return this.handCursor ?? (this.prefs.mouseKeys ? this.mouse : null);
  }

  // The board spot under the cursor (hand, else mouse), null with neither. Says whether words
  // being spoken now are aimed for a spell.
  cursorSpot(): Spot | null {
    const c = this.cursor();
    return c ? this.host.toWorld(c.x, c.y) : null;
  }

  // Where the hand points, null with no hand. The home screen leans toward it as it does the mouse.
  handPoint(): Pt | null {
    return this.handCursor;
  }

  // ---------- the scheme: signals in, intents out ----------

  private startScheme(): void {
    const ctx: SchemeCtx = {
      menus: () => this.menus(),
      playing: () => this.host.playing(),
      cursor: () => this.cursor(),
      waiting: () => this.prompt.text,
      camera: () => !!this.tracker,
      canDeployAt: p => this.host.playing() && this.host.canDeploy(this.host.toWorld(p.x, p.y)),
    };
    this.inst = this.scheme.create(i => this.act(i), ctx);
  }


  // What the scheme says it's doing, for the workshop page.
  schemeState(): string {
    return this.inst?.state?.() ?? '';
  }

  // Hand a signal to the scheme (and the workshop page). True if an intent it caused did something.
  publish(s: Signal): boolean {
    this.handled = false;
    for (const l of this.listeners.signal) l(s);
    try {
      this.inst?.on(s);
    } catch (e) {
      console.error(`scheme ${this.scheme?.id} failed on ${s.kind}:`, e);
    }
    return this.handled;
  }

  private handSignal(t: number, cursor: Pt, f: HandFrame | null, pinched: boolean): Signal {
    const playing = this.host.playing();
    const ext = f ? extension(f.world) : 2;
    const pinch = this.pinch.ratio;
    return {
      kind: 'hand', t, visible: true, cursor, pinched,
      overHalf: playing && !this.menus() && this.host.canDeploy(this.host.toWorld(cursor.x, cursor.y)),
      // Rough scores from the landmarks (MediaPipe's gesture model isn't loaded).
      gestures: {
        Thumb_Down: this.thumbDown,
        Open_Palm: clamp01((ext - 1.4) / 0.5),
        Pointing_Up: f ? clamp01(pointing(f)) : 0,
        Pinch: clamp01((0.8 - pinch) / 0.4),
      },
    };
  }

  // Carry out what the scheme asked for.
  private act(i: Intent): boolean {
    let ok = false;
    switch (i.kind) {
      case 'commit':
        ok = this.fire(i.at ?? this.cursor(), i.by, i.t);
        break;
      case 'cancel':
        ok = this.cancelPending(i.why);
        break;
      case 'clear':
        ok = this.clear(i.why as 'key');
        break;
      case 'uiActivate':
        ok = activateUi(i.at ?? (i.fallback ? this.handCursor : null), { fallback: i.fallback, playing: this.host.playing() });
        break;
    }
    if (ok) this.handled = true;
    for (const l of this.listeners.intent) l(i, ok);
    return ok;
  }

  // Take back the deploy still being summoned: the words still being finalised, else the oldest
  // one whose deploy_troop hasn't gone out, so with troops queued for embers each thumbs down
  // clears the first in line, then the next. Nothing has been paid by then, so it's a full refund.
  private cancelPending(why: string): boolean {
    if (this.firing) return this.clear(why);
    const open = [...this.inFlight].filter(([, v]) => !v.sent);
    if (!open.length) return false;
    const [nonce, { at }] = open[0];
    this.inFlight.delete(nonce);
    this.flash(at, 'cancel', 'cancelled');
    this.host.cancel(nonce, `cancelled (${why})`, '');
    this.host.event?.('deploy:cancelled', why, nonce);
    this.publish({ kind: 'deploy', t: performance.now(), phase: 'done', nonce });
    return true;
  }

  // From the game: deploy_troop went out for this nonce (too late to cancel), or it settled.
  deploySent(nonce: number): void {
    const f = this.inFlight.get(nonce);
    if (!f) return;
    f.sent = true;
    this.publish({ kind: 'deploy', t: performance.now(), phase: 'sent', nonce });
  }

  // From the game: the match refused it for embers and it went back in the queue, so it can be
  // cancelled again.
  deployQueued(nonce: number): void {
    const f = this.inFlight.get(nonce);
    if (!f || !f.sent) return;
    f.sent = false;
    this.publish({ kind: 'deploy', t: performance.now(), phase: 'pending', nonce });
  }

  deployDone(nonce: number): void {
    if (!this.inFlight.delete(nonce)) return;
    this.publish({ kind: 'deploy', t: performance.now(), phase: 'done', nonce });
  }


  private cursorState(now: number): CursorState {
    // The cursor stays filled while a pinch is held, and flashes as it's let go.
    return now - this.pinchT < FIRE_SHOW_MS || this.schemeState() === 'holding' ? 'fire' : this.thumbDown >= THUMB_DOWN.score && !this.pinch.closed ? 'cancel' : 'open';
  }

  // ---------- fire / cancel ----------

  // Send the words (or the typed text) to the spot at p. True if it handled the input, even by
  // refusing it, so a mouse press that fired isn't also a click.
  private fire(p: Pt | null, by: string, t = performance.now()): boolean {
    if (!p || !this.host.playing() || this.firing) return false;
    const said = this.prompt.text, typed = this.host.typedText().trim();
    // The recogniser runs behind the voice: words just said may not have arrived yet. If the mic
    // heard speech a moment ago, deploy anyway and let the words catch up during the delay.
    const listening = this.mic.on && this.speech.available;
    const spokeSinceFire = this.speechAt > this.firedAt;
    if (!fireWaits({ said, typed, listening, msSinceSpeech: performance.now() - this.vad.lastLoud, spokeSinceFire })) {
      if (by === 'release') this.logPinch(t, 'pinch:missed', 0);
      this.missed(p);
      return true;
    }
    const spot = this.host.toWorld(p.x, p.y);
    if (!this.host.canDeploy(spot)) {
      this.flash(p, 'cancel', 'off the board');
      return true;
    }
    const nonce = this.host.begin(spot, by);
    if (nonce === null) return false;
    if (by === 'release') this.logPinch(t, 'pinch', nonce);
    this.firedAt = t;
    // Cut the audio at the fire (plus a short grace): what was said up to then is this troop, what
    // comes after is the next. Every scheme's commit lands here.
    this.firing = { nonce, spot, at: p, by, words: this.prompt, cut: Infinity, done: Promise.resolve(), t };
    this.prompt = new Transcript();
    const f = this.firing, grace = Math.max(0, t + FIRE_GRACE_MS - performance.now());
    const cutNow = () => {
      if (this.firing !== f) return;
      const c = listening ? this.speech.cut(FIRE_WAIT_MS) : { epoch: this.dropped, done: Promise.resolve() };
      f.cut = c.epoch;
      f.done = c.done;
    };
    if (grace > 0) setTimeout(cutNow, grace);
    else cutNow();
    this.inFlight.set(nonce, { at: p, sent: false });
    this.publish({ kind: 'deploy', t, phase: 'pending', nonce });
    this.flash(p, 'deploy', '', said || typed);
    this.host.released?.(nonce, said);
    void this.land(this.firing);
    return true;
  }

  // How the pinch at t looked, next to the deploy it began (or the miss): the measure as it closed,
  // how long the hand was open before, closes the cooldown held back, and the hands and voice.
  private logPinch(t: number, kind: string, nonce: number): void {
    const s = this.pinchT === t ? this.shot : null, now = performance.now(), ms = (v: number) => (Number.isFinite(v) ? `${Math.round(v)}ms` : '-');
    const parts = s
      ? [`ratio ${s.ratio.toFixed(2)}`, `open ${ms(s.openMs)}`, `since last ${ms(s.sinceLastMs)}`, `held ${s.held}`]
      : ['no measure'];
    parts.push(`hand ${this.hand?.side ?? '-'}`, `hands ${this.others.length + (this.hand ? 1 : 0)}`, `control ${ms(t - this.switchedAt)}`,
      `loud ${ms(now - this.vad.lastLoud)} ago`, `speech ${this.speechAt > this.firedAt ? 'new' : 'old'}`);
    this.host.event?.(kind, parts.join(' · '), nonce);
  }

  private async land(f: Firing): Promise<void> {
    // The cut comes FIRE_GRACE_MS after the fire; then wait for the words up to it to be final,
    // capped; past the cap the partials stand in.
    const grace = f.t + FIRE_GRACE_MS - performance.now();
    if (grace > 0) await new Promise(r => setTimeout(r, grace + 1));
    await Promise.race([f.done, new Promise(r => setTimeout(r, FIRE_WAIT_MS))]);
    if (this.firing !== f) return; // cancelled meanwhile
    this.firing = null;
    if (Number.isFinite(f.cut)) this.dropped = Math.max(this.dropped, f.cut);
    const d = chooseDescription(this.host.typedText(), f.words.text);
    if (d.ok) {
      if (d.from === 'typed') this.host.clearTyped();
      this.host.deploy(f.nonce, f.spot, d.text, { from: d.from, by: f.by, transcript: f.words.text });
    } else {
      if (d.reason === 'cancel') this.flash(f.at, 'cancel', 'cancelled');
      else this.missed(f.at);
      this.host.cancel(f.nonce, d.reason === 'cancel' ? 'cancelled' : 'cancelled: no description heard', f.words.text);
    }
    if (!d.ok) {
      this.inFlight.delete(f.nonce);
      this.publish({ kind: 'deploy', t: performance.now(), phase: 'done', nonce: f.nonce });
    }
    // Words said since the fire are the next troop: show them and start designing.
    if (this.prompt.text) this.words('', false, -Infinity);
  }

  // Throw away the words said so far, and a fire still waiting on its last words.
  private clear(why: string): boolean {
    const f = this.firing, words = f?.words.text ?? this.prompt.text;
    if (!f && !words) return false;
    this.firing = null;
    this.prompt = new Transcript();
    if (f) {
      this.inFlight.delete(f.nonce);
      this.publish({ kind: 'deploy', t: performance.now(), phase: 'done', nonce: f.nonce });
    }
    // Cut so the utterance in progress, whose final would bring the words back, is dropped.
    if (this.mic.on) this.dropped = Math.max(this.dropped, this.speech.cut(FLUSH_MS).epoch);
    const at = f?.at ?? this.cursor();
    if (why !== 'mismatch' && at) this.flash(at, 'cancel', 'cleared', words);
    if (f) this.host.cancel(f.nonce, `cancelled (${why})`, words);
    this.host.event?.('prompt:cleared', `${why}: ${words}`);
    if (why !== 'mismatch') this.host.status('');
    return true;
  }

  // epoch -Infinity: no new words, just refresh what the prompt shows.
  private words(raw: string, final: boolean, epoch: number): void {
    const text = raw.trim(); // the Transcript gets raw, which keeps the source's own spacing
    this.heard = text ? `heard: “${text}”` : this.heard;
    if (text) this.heardWords = true;
    const f = this.firing, to = epoch === -Infinity ? 'prompt' : routeWords(epoch, f?.cut ?? null, this.dropped);
    if (final && text) this.host.heard?.(text, to === 'firing' ? f!.nonce : 0);
    if (!f && epoch !== -Infinity && this.host.dictate?.(raw, final, epoch)) return;
    if (to === 'drop') return;
    if (to === 'firing') {
      if (final) f!.words.final(raw, epoch);
      else f!.words.interim(raw, epoch);
      return;
    }
    // Act on interim words too: waiting for the final result adds most of a second.
    const sig = (cancel: boolean) => this.publish({ kind: 'words', t: performance.now(), text, final, waiting: this.prompt.text, cancel });
    if (isCancel(text)) {
      this.clear('said');
      sig(true);
      return;
    }
    if (isMismatch(text)) {
      this.clear('mismatch');
      return this.flagMismatch();
    }
    if (epoch !== -Infinity) {
      if (final) this.prompt.final(raw, epoch);
      else this.prompt.interim(raw, epoch);
    }
    sig(false);
    const all = this.prompt.text;
    if (all && this.host.playing() && !this.firing) {
      this.host.status(`“${all}”`);
      this.host.prefetch?.(all);
    }
  }

  // Fired with nothing (or nothing usable) heard: a wobbling "didn't catch that" at the spot, a
  // soft "hm?", and the first time only, how to do it.
  private missed(p: Pt): void {
    this.flashes = this.flashes.filter(f => f.kind !== 'miss');
    this.flash(p, 'miss', this.mic.on || this.speech.available ? 'didn’t catch that' : 'nothing to send');
    sfx.play('miss');
    if (this.hinted) return;
    this.hinted = true;
    const send = this.tracker ? 'pinch, aim, let go' : TOUCH ? 'tap your half' : this.prefs.mouseKeys ? 'click or press Space' : 'press Space';
    const how = !this.mic.on ? `Turn on the Mic or type a troop, then ${send}` : this.speech.available ? `Say what it is, then ${send}` : `Type what it is, then ${send}`;
    notice(how, { tone: 'info', ms: 3200, key: 'missHint' });
  }

  private flagMismatch(): void {
    const now = performance.now();
    if (now - this.flaggedAt < 3000) return;
    this.flaggedAt = now;
    this.host.mismatch?.();
  }

  private flash(p: Pt, kind: 'deploy' | 'cancel' | 'miss', label: string, words = ''): void {
    this.flashes.push({ x: p.x, y: p.y, kind, label, t: performance.now(), words });
  }

  // ---------- camera and mic ----------

  async setCamera(on: boolean): Promise<void> {
    if (on === !!this.tracker) return;
    if (!on) {
      this.tracker?.stop();
      this.tracker = null;
      this.hand = null;
      this.others = [];
      this.picker.reset();
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
    // The board draws the cursor during a match; on menus (the lobby, setup, a dialog over the
    // match) it's drawn here, above everything, with the dwell ring filling round it.
    const now = performance.now(), dwell = menuPointer.dwellProgress(now);
    const p = this.handCursor && (!this.host.playing() || this.menus() || dwell > 0) ? this.handCursor : null;
    if (!p && !this.overlayDrawn) return;
    const c = this.overlay, dpr = devicePixelRatio || 1, w = innerWidth, h = innerHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (p && (!this.host.playing() || this.menus())) drawCursor(g, p.x, p.y, this.cursorState(now));
    if (p && dwell > 0) drawDwell(g, p.x, p.y, dwell);
    this.overlayDrawn = !!p;
  }

  // ---------- UI ----------

  private mountUi(): void {
    this.el.id = 'inputPanel';
    this.el.innerHTML = `
      <div class="inRow">
        <button data-act="cam" title="Say it, pinch and hold to aim, let go to place. Thumbs down to cancel.">Camera</button>
        <button data-act="mic" title="Always listening while on: say the troop, then pinch, click or press Space to send it">Mic</button>
        <button data-act="menu" class="ghost" title="Camera and mic settings">⋯</button>
      </div>
      <div class="inPreview"><canvas></canvas></div>
      <div class="inStatus"></div>
      <div class="inMenu" hidden>
        <button data-act="setup" class="ghost">Run setup again</button>
        <label><input type="checkbox" data-act="mouseKeys"> Mouse and keyboard</label>
        <label><input type="checkbox" data-act="preview"> Hand preview</label>
        <label>Pointing hand <select data-act="hand"><option value="auto">Auto</option><option value="left">Left</option><option value="right">Right</option></select></label>
        <label>Speech above <input type="range" data-act="vadDb" min="-80" max="-10" step="1"><span class="inVal" data-val="vadDb"></span></label>
        <div class="inMeter"><div class="inLevel"></div><div class="inThresh"></div></div>
        <button data-act="calibrate" class="ghost">Fit pinch to my hand</button>
        <label title="Thumb to finger, in hand sizes: higher fires with a looser pinch">Pinch below <input type="range" data-act="pinchOn" min="0.15" max="0.8" step="0.01"><span class="inVal" data-val="pinchOn"></span></label>
        <label title="How far the hand has to open before the next pinch">Let go above <input type="range" data-act="pinchOff" min="0.25" max="1" step="0.01"><span class="inVal" data-val="pinchOff"></span></label>
        <div class="inMeter" title="Your thumb to finger now; pinch fires left of the green line"><div class="inLevel" data-level="pinch"></div><div class="inThresh" data-thresh="pinchOn"></div><div class="inThresh off" data-thresh="pinchOff"></div></div>
        <button data-act="pinchReset" class="ghost">Default pinch</button>
      </div>`;
    document.body.appendChild(this.el);
    this.preview = this.el.querySelector('.inPreview canvas')!;
    this.overlay.id = 'inputOverlay';
    document.body.appendChild(this.overlay);
    this.handView.id = 'handView';
    this.handView.hidden = true;
    this.handView.innerHTML = '<canvas></canvas><span class="hvState"></span>';
    document.body.appendChild(this.handView);

    const q = <T extends HTMLElement>(act: string) => this.el.querySelector<T>(`[data-act="${act}"]`)!;
    const menu = this.el.querySelector<HTMLElement>('.inMenu')!;
    q<HTMLInputElement>('mouseKeys').checked = this.prefs.mouseKeys;
    q<HTMLInputElement>('preview').checked = this.prefs.preview;
    q<HTMLSelectElement>('hand').value = this.prefs.hand;
    q<HTMLInputElement>('vadDb').value = String(this.prefs.vadDb);
    this.syncPinchUi();
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
      } else if (act === 'calibrate') {
        menu.hidden = true;
        this.onCalibrate?.();
      } else if (act === 'pinchReset') this.setPinch(null);
      this.renderPanel();
    });
    this.el.addEventListener('input', e => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.act === 'mouseKeys') this.prefs.mouseKeys = t.checked;
      if (t.dataset.act === 'preview') this.prefs.preview = t.checked;
      if (t.dataset.act === 'hand') return this.setHandPref(t.value as HandPref);
      if (t.dataset.act === 'vadDb') this.prefs.vadDb = this.vad.o.thresholdDb = Number(t.value);
      // The two pinch lines can't cross: moving one past the other pushes it along.
      if (t.dataset.act === 'pinchOn' || t.dataset.act === 'pinchOff') {
        const { on, off } = this.pinchThresholds, v = Number(t.value), gap = 0.08;
        return this.setPinch(t.dataset.act === 'pinchOn' ? { on: v, off: Math.max(off, v + gap) } : { on: Math.min(on, v - gap), off: v });
      }
      save(KEYS.prefs, this.prefs);
      this.renderPanel();
    });
    this.renderPanel();
  }

  private syncPinchUi(): void {
    const { on, off } = this.pinchThresholds;
    const set = (act: string, v: number) => {
      const i = this.el.querySelector<HTMLInputElement>(`[data-act="${act}"]`);
      if (i) i.value = String(v);
      const val = this.el.querySelector<HTMLElement>(`[data-val="${act}"]`);
      if (val) val.textContent = v.toFixed(2) + (act === 'pinchOn' && !this.prefs.pinch ? ' (default)' : '');
    };
    set('pinchOn', on);
    set('pinchOff', off);
  }

  private renderPanel(): void {
    this.lastPanel = performance.now();
    const $ = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    $('[data-act="cam"]').classList.toggle('on', !!this.tracker);
    $('[data-act="mic"]').classList.toggle('on', this.mic.on);
    $('.inPreview').hidden = !this.tracker || !this.prefs.preview;
    this.handView.hidden = !this.tracker;
    const pose = this.thumbDown >= THUMB_DOWN.score ? 'thumbs down' : this.hand ? `fingers ${extension(this.hand.world).toFixed(1)}` : '';
    const ignored = this.others.length ? ` · ${this.others.length} ignored` : '';
    const cam = this.tracker ? this.camStatus || (this.hand ? `hand${this.hand.side ? ` (${this.hand.side})` : ''} · ${pose}${ignored}` : this.others.length ? 'no pointing hand' : 'no hand in view') : '';
    const mic = this.mic.on ? `${this.vad.level.toFixed(0)} dB${this.vad.speaking ? ' · speaking' : ''} · ${this.heard}` : this.heard;
    $('.inStatus').textContent = [cam, mic].filter(Boolean).join('\n');
    $('[data-val="vadDb"]').textContent = `${this.prefs.vadDb} dB`;
    const pct = (db: number) => `${Math.max(0, Math.min(100, ((db + 90) / 90) * 100))}%`;
    $('.inLevel').style.width = pct(this.mic.on ? this.vad.level : -90);
    $('.inLevel').classList.toggle('speaking', this.vad.speaking);
    $('.inThresh').style.left = pct(this.prefs.vadDb);
    // The pinch meter runs 0 (touching) to 1.2 (wide open), so it fills as the hand opens.
    const at = (r: number) => `${Math.max(0, Math.min(100, (r / 1.2) * 100))}%`;
    const p = this.pinchThresholds;
    $('[data-level="pinch"]').style.width = at(this.ratio ?? 0);
    $('[data-level="pinch"]').classList.toggle('speaking', this.pinch.closed && this.ratio !== null);
    $('[data-thresh="pinchOn"]').style.left = at(p.on);
    $('[data-thresh="pinchOff"]').style.left = at(p.off);
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
    if (!this.mic.on) return this.heard.startsWith('mic failed') ? `${this.heard} · allow it from the address bar, then press Mic` : `Turn on the Mic (${DEV_MODE ? 'top left' : 'camera button, top right'}) to speak troops in`;
    const send = this.tracker ? 'pinch, aim, let go' : TOUCH ? 'tap your half' : this.prefs.mouseKeys ? 'click or press Space' : 'press Space';
    const clear = this.tracker ? 'thumbs down' : TOUCH ? 'say “cancel”' : 'press Esc';
    if (!this.speech.available) return `No speech recognition here: type the troop, then ${send}`;
    if (this.tracker) return this.scheme.howTo;
    return `Say the troop, then ${send} to send it · ${clear} to cancel`;
  }

  // The skeleton with the screen's edges projected back into the camera frame (the touchpad area):
  // over the mirrored camera image only on the setup screen; the /dev panel draws it on dark.
  private drawPreviews(): void {
    if (!this.tracker) return;
    this.drawHandView();
    if (this.prefs.preview) this.drawPreview(this.preview, 160, false);
    const s = this.setupPreview;
    if (s?.clientWidth) this.drawPreview(s, s.clientWidth, true);
    const seen = this.setupSeen;
    if (seen?.c.clientWidth) {
      const state = this.cursorState(performance.now());
      drawHandView(seen.c, this.hand?.world ?? null, state);
      const p = this.handCursor ? { x: this.handCursor.x / innerWidth, y: this.handCursor.y / innerHeight } : null;
      drawScreenInset(seen.c, p, state, innerWidth / innerHeight);
      const label = this.handLabel(state);
      if (seen.label.textContent !== label) seen.label.textContent = label;
      seen.label.dataset.state = this.hand ? state : 'none';
    }
  }

  private handLabel(state: CursorState): string {
    return !this.tracker?.ready ? 'Starting camera…'
      : !this.hand ? 'Show your hand'
      : state === 'cancel' ? 'Thumbs down · cancel'
      : state === 'fire' ? (this.menus() ? 'Pinch · click' : 'Pinch · send')
      : 'Aiming';
  }

  // What the tracker sees of your hand, as a virtual hand, with the gesture it reads.
  private drawHandView(): void {
    const state = this.cursorState(performance.now());
    const label = this.handLabel(state);
    const el = this.handView.querySelector<HTMLElement>('.hvState')!;
    if (el.textContent !== label) el.textContent = label;
    this.handView.dataset.state = this.hand ? state : 'none';
    drawHandView(this.handView.querySelector('canvas')!, this.hand?.world ?? null, state);
  }

  private drawPreview(c: HTMLCanvasElement, w: number, video: boolean): void {
    const v = this.tracker!.video, h = Math.round((w * (v.videoHeight || 9)) / (v.videoWidth || 16));
    const dpr = devicePixelRatio || 1;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.height = `${h}px`;
    }
    const g = c.getContext('2d')!;
    if (video) {
      g.setTransform(-dpr, 0, 0, dpr, w * dpr, 0); // mirror the video
      g.drawImage(v, 0, 0, w, h);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0a0d1b';
      g.fillRect(0, 0, w, h);
    }
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
    const bones = (lm: HandFrame['lm']) => {
      g.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        g.moveTo((1 - lm[a].x) * w, lm[a].y * h);
        g.lineTo((1 - lm[b].x) * w, lm[b].y * h);
      }
      g.stroke();
    };
    // Ignored hands (the mic hand): a dim dashed outline, so it's clear they don't count.
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    for (const o of this.others) bones(o.lm);
    g.setLineDash([]);
    const lm = this.hand?.lm;
    if (!lm) return;
    const P = (i: number): Pt2 => [(1 - lm[i].x) * w, lm[i].y * h];
    // The control hand: a soft green glow under the skeleton.
    g.strokeStyle = 'rgba(74,222,128,0.35)';
    g.lineWidth = 5;
    bones(lm);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 1.5;
    bones(lm);
    const state = this.cursorState(performance.now());
    g.fillStyle = state === 'fire' ? '#4aa3ff' : state === 'cancel' ? '#fbbf24' : '#ff5d6c';
    g.beginPath();
    g.arc(...P(8), 4, 0, Math.PI * 2);
    g.fill();
  }
}
