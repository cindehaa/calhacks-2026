// Camera + mic input: wires the hand tracker, the mic level and the transcript into the lock
// machine, and reports locks, deploys and cancels to the game. Mouse and keyboard keep working
// untouched; this only adds a second way in.
import { ARENA_W, onOwnHalf, type Side } from '../../../shared/arena';
import { KEYS, load, PinchCalibration, PointerCalibration, save, type PointerCal } from './calibrate';
import { drawPinchCalibration, drawPointerCalibration, FLASH_MS, type InputView } from './draw';
import { OneEuro } from './filter';
import { HAND_CONNECTIONS, HandTracker, pointerOf, type HandFrame } from './hand';
import { applyH, DEFAULT_H, invertH, type Pt2 } from './homography';
import { LockMachine, LOCK_DEFAULTS, type Lock, type Pt } from './lock';
import { DEFAULT_PINCH, Hysteresis, pinchMetric2d, pinchMetric3d, type PinchThresholds } from './pinch';
import { AutoSpeech } from './cartesia_stt';
import { chooseDescription, isCancel, Transcript } from './speech';
import { Mic, Vad, VAD_DEFAULTS } from './voice';
import './input.css';

type Spot = [number, number]; // world coords

// What the game provides. begin() starts the server-side deploy clock at lock time and returns
// its handle (null refuses the lock); deploy() and cancel() finish it.
export interface InputHost {
  playing(): boolean;
  side(): Side;
  toWorld(px: number, py: number): Spot;
  begin(spot: Spot): number | null;
  deploy(nonce: number, spot: Spot, description: string): void;
  cancel(nonce: number, reason: string): void;
  status(msg: string, bad?: boolean): void;
  typedText(): string;
  clearTyped(): void;
  prefetch?(words: string): void; // start designing from words heard so far
}

interface Prefs { preview: boolean; vadDb: number; vadEndMs: number }

interface Active { nonce: number; spot: Spot; words: Transcript }

const FLUSH_MS = 600; // how long a deploy waits for the recogniser to finalise the last words (Cartesia: ~0.1 s)

export class InputController {
  private machine: LockMachine;
  private tracker: HandTracker | null = null;
  private mic = new Mic();
  private vad = new Vad({ ...VAD_DEFAULTS });
  private speech = new AutoSpeech(() => this.mic.media); // Cartesia, else the browser's recogniser
  private listeners = new Set<Transcript>(); // transcripts still taking words
  private active: Active | null = null;

  private fx = new OneEuro(1.0, 0.007);
  private fy = new OneEuro(1.0, 0.007);
  private pinchCfg: PinchThresholds = load<PinchThresholds>(KEYS.pinch) ?? DEFAULT_PINCH;
  private hyst = new Hysteresis(this.pinchCfg.on, this.pinchCfg.off);
  private pointerCal: PointerCal | null = load<PointerCal>(KEYS.pointer);
  private prefs: Prefs = { preview: true, vadDb: VAD_DEFAULTS.thresholdDb, vadEndMs: VAD_DEFAULTS.endMs, ...load<Partial<Prefs>>(KEYS.prefs) };

  private hand: HandFrame | null = null;
  private handCursor: Pt | null = null;
  private raw: Pt2 | null = null;
  private pinched = false;
  private ratio = 0;
  private mouse: Pt | null = null;
  private flashes: InputView['flashes'] = [];
  private calibPointer: PointerCalibration | null = null;
  private calibPinch: PinchCalibration | null = null;
  private calPinchedPrev = false;
  private camStatus = '';
  private heard = '';
  private lastPanel = 0;

  // DOM
  private el = document.createElement('div');
  private calCanvas = document.createElement('canvas');
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
      this.renderPanel();
    };

    canvas.addEventListener('mousemove', e => (this.mouse = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('mouseleave', () => (this.mouse = null));
    addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (this.calibPointer || this.calibPinch) this.endCalibration('calibration cancelled');
      else this.machine.cancel('key');
    });
    this.mountUi();
    const loop = () => {
      requestAnimationFrame(loop);
      this.tick(performance.now());
    };
    requestAnimationFrame(loop);
  }

  // Open the STT sockets ahead of the first deploy (match start). Nothing to do with the mic off.
  warm(): void {
    if (this.mic.on) this.speech.warm();
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
    const calibrating = !!(this.calibPointer || this.calibPinch);

    if (this.mic.on) {
      const ev = this.vad.push(now, this.mic.levelDb());
      if (!calibrating && ev?.kind === 'start') this.machine.speechStart(ev.t);
      else if (ev?.kind === 'end') {
        this.machine.speechEnd();
        // Close the utterance so the next one starts clean (a no-op if a deploy already flushed).
        this.speech.flush(FLUSH_MS);
      }
    }
    if (!calibrating) {
      this.machine.frame(now, { cursor: this.handCursor ?? this.mouse, hand: !!this.hand, pinched: this.pinched });
    }
    this.flashes = this.flashes.filter(x => now - x.t < FLASH_MS);
    this.drawCalibration(now);
    if (now - this.lastPanel > 250) this.renderPanel();
  }

  private onHandFrame(f: HandFrame | null, now: number): void {
    this.hand = f;
    if (!f) {
      this.handCursor = this.raw = null;
      this.fx.reset();
      this.fy.reset();
      this.drawPreview();
      return;
    }
    const m2 = pinchMetric2d(f.lm, f.vw, f.vh), m3 = pinchMetric3d(f.world);
    this.ratio = this.pinchCfg.metric === '3d' ? m3 : m2;
    this.pinched = this.hyst.update(this.ratio);
    this.raw = pointerOf(f.lm);
    const [u, v] = applyH(this.pointerCal?.H ?? DEFAULT_H, this.raw);
    this.handCursor = { x: this.fx.filter(u * innerWidth, now / 1000), y: this.fy.filter(v * innerHeight, now / 1000) };

    if (this.calibPointer) {
      const c = this.calibPointer;
      c.pushRaw(now, this.raw);
      if (this.pinched && !this.calPinchedPrev && c.click(now) && c.done) this.finishPointerCalibration();
    }
    this.calPinchedPrev = this.pinched;
    if (this.calibPinch) {
      this.calibPinch.push(now, m2, m3);
      if (this.calibPinch.done(now)) this.finishPinchCalibration();
    }
    this.drawPreview();
  }

  // ---------- lock → deploy / cancel ----------

  private onLock(l: Lock): boolean {
    if (!this.host.playing()) return false;
    const [x, y] = this.host.toWorld(l.x, l.y);
    if (!onOwnHalf(this.host.side(), y) || x <= 0 || x >= ARENA_W) {
      if (l.by === 'pinch') this.flash(l, 'cancel', 'your half only');
      return false;
    }
    const nonce = this.host.begin([x, y]);
    if (nonce === null) return false;
    const words = new Transcript();
    this.listeners.add(words);
    this.active = { nonce, spot: [x, y], words };
    this.host.status(this.mic.on ? 'say what the troop is…' : 'locked: type a troop, or let go to use the text box');
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
      this.host.deploy(a.nonce, a.spot, d.text);
      return;
    }
    const why =
      d.reason === 'cancel' ? 'cancelled'
      : this.mic.on && this.speech.available ? 'cancelled: no description heard'
      : this.mic.on ? 'cancelled: no speech recognition in this browser, type a description first'
      : 'cancelled: type a description first, or turn the mic on';
    this.flash(l, 'cancel', d.reason === 'cancel' ? 'cancelled' : 'no description');
    this.host.cancel(a.nonce, why);
  }

  private onCancel(l: Lock, reason: string): void {
    const a = this.active;
    this.active = null;
    if (!a) return;
    this.listeners.delete(a.words);
    const label = reason === 'drag' ? 'dragged off' : reason === 'hand lost' ? 'hand lost' : reason === 'key' ? '' : reason;
    this.flash(l, 'cancel', label ? `cancel · ${label}` : 'cancel');
    this.host.cancel(a.nonce, label ? `cancelled (${label})` : 'cancelled');
  }

  private words(text: string, final: boolean): void {
    this.heard = text ? `heard: “${text}”` : this.heard;
    for (const t of this.listeners) final ? t.final(text) : t.interim(text);
    const a = this.active;
    if (!a) return;
    // Act on interim words too: waiting for the final result adds most of a second.
    if (isCancel(a.words.text)) return this.machine.cancel('cancelled');
    if (a.words.text) {
      this.host.status(`“${a.words.text}”`);
      this.host.prefetch?.(a.words.text);
    }
  }

  private flash(p: Pt, kind: 'deploy' | 'cancel', label: string): void {
    this.flashes.push({ x: p.x, y: p.y, kind, label, t: performance.now() });
  }

  // ---------- camera and mic ----------

  private async setCamera(on: boolean): Promise<void> {
    if (on === !!this.tracker) return;
    if (!on) {
      this.machine.cancel('camera off');
      this.tracker?.stop();
      this.tracker = null;
      this.hand = null;
      this.handCursor = null;
      this.camStatus = '';
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
      if (this.tracker === t) this.camStatus = this.pointerCal ? '' : 'not calibrated: using the default box';
    } catch (e) {
      if (this.tracker === t) {
        t.stop();
        this.tracker = null;
        this.camStatus = `camera failed: ${(e as Error).name === 'NotAllowedError' ? 'blocked' : (e as Error).message}`;
      }
    }
    this.renderPanel();
  }

  private async setMic(on: boolean): Promise<void> {
    if (on === this.mic.on) return;
    if (!on) {
      this.speech.stop();
      this.mic.stop();
      this.vad.reset();
      this.heard = '';
      this.renderPanel();
      return;
    }
    try {
      await this.mic.start();
      this.speech.start();
      this.heard = this.speech.available ? `listening (${this.speech.engine})` : 'no speech recognition in this browser: voice locks, typed text describes';
    } catch (e) {
      this.heard = `mic failed: ${(e as Error).name === 'NotAllowedError' ? 'blocked' : (e as Error).message}`;
    }
    this.renderPanel();
  }

  // ---------- calibration ----------

  private startPointerCalibration(): void {
    if (!this.tracker) return void this.host.status('turn the camera on first', true);
    this.machine.cancel('calibrating');
    this.calibPinch = null;
    this.calibPointer = new PointerCalibration(LOCK_DEFAULTS.lagMs);
    this.calCanvas.hidden = false;
  }

  private finishPointerCalibration(): void {
    const r = this.calibPointer?.result(innerWidth, innerHeight);
    if (!r) return this.endCalibration('calibration failed: point at the dots with bigger hand movements');
    this.pointerCal = r;
    save(KEYS.pointer, r);
    this.fx.reset();
    this.fy.reset();
    this.camStatus = '';
    this.endCalibration(`calibrated, fit ±${r.residual.toFixed(0)} px`);
  }

  private startPinchCalibration(): void {
    if (!this.tracker) return void this.host.status('turn the camera on first', true);
    this.machine.cancel('calibrating');
    this.calibPointer = null;
    this.calibPinch = new PinchCalibration(performance.now());
    this.calCanvas.hidden = false;
  }

  private finishPinchCalibration(): void {
    const r = this.calibPinch?.result();
    if (!r) return this.endCalibration('pinch calibration failed: keep your hand in view');
    this.pinchCfg = { metric: r.metric, on: r.on, off: r.off };
    this.hyst = new Hysteresis(r.on, r.off);
    save(KEYS.pinch, this.pinchCfg);
    this.endCalibration(`pinch: ${r.metric.toUpperCase()}, on < ${r.on}, off > ${r.off}${r.score > 0 ? '' : ' (overlap, best guess)'}`);
  }

  private endCalibration(msg: string): void {
    this.calibPointer = this.calibPinch = null;
    this.calCanvas.hidden = true;
    this.host.status(msg);
  }

  private drawCalibration(now: number): void {
    if (this.calCanvas.hidden) return;
    const c = this.calCanvas, dpr = devicePixelRatio || 1, w = innerWidth, h = innerHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.calibPointer) drawPointerCalibration(g, w, h, this.calibPointer.index, !!this.hand, now);
    else if (this.calibPinch) drawPinchCalibration(g, w, h, this.calibPinch, !!this.hand, now);
  }

  // ---------- UI ----------

  private mountUi(): void {
    this.el.id = 'inputPanel';
    this.el.innerHTML = `
      <div class="inRow">
        <button data-act="cam" title="Aim with your index knuckle, pinch thumb + middle finger to lock">Camera</button>
        <button data-act="mic" title="Start talking to lock, describe the troop, go quiet to deploy">Mic</button>
        <button data-act="calPointer" title="Point at 4 dots and pinch at each">Calibrate</button>
        <button data-act="menu" class="ghost" title="Pinch calibration and mic settings">⋯</button>
      </div>
      <div class="inPreview"><canvas></canvas></div>
      <div class="inStatus"></div>
      <div class="inMenu" hidden>
        <button data-act="calPinch">Calibrate pinch (7 s)</button>
        <button data-act="reset" class="ghost">Reset calibration</button>
        <label><input type="checkbox" data-act="preview"> Camera preview</label>
        <label>Speech above <input type="range" data-act="vadDb" min="-80" max="-10" step="1"><span class="inVal" data-val="vadDb"></span></label>
        <div class="inMeter"><div class="inLevel"></div><div class="inThresh"></div></div>
        <label>Done after <input type="range" data-act="vadEnd" min="300" max="1500" step="50"><span class="inVal" data-val="vadEnd"></span></label>
      </div>`;
    document.body.appendChild(this.el);
    this.preview = this.el.querySelector('.inPreview canvas')!;
    this.calCanvas.id = 'inputCalibration';
    this.calCanvas.hidden = true;
    document.body.appendChild(this.calCanvas);

    const q = <T extends HTMLElement>(act: string) => this.el.querySelector<T>(`[data-act="${act}"]`)!;
    const menu = this.el.querySelector<HTMLElement>('.inMenu')!;
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
      else if (act === 'calPointer') this.startPointerCalibration();
      else if (act === 'calPinch') this.startPinchCalibration();
      else if (act === 'reset') {
        this.pointerCal = null;
        this.pinchCfg = DEFAULT_PINCH;
        this.hyst = new Hysteresis(DEFAULT_PINCH.on, DEFAULT_PINCH.off);
        save(KEYS.pointer, null);
        save(KEYS.pinch, null);
        this.host.status('calibration reset to defaults');
      }
      this.renderPanel();
    });
    this.el.addEventListener('input', e => {
      const t = e.target as HTMLInputElement;
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
  // (the touchpad area: amber for the default box, green once calibrated).
  private drawPreview(): void {
    const t = this.tracker, c = this.preview;
    if (!t || !this.prefs.preview) return;
    const v = t.video, w = 160, h = Math.round((w * (v.videoHeight || 9)) / (v.videoWidth || 16));
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
    const inv = invertH(this.pointerCal?.H ?? DEFAULT_H);
    if (inv) {
      g.strokeStyle = this.pointerCal ? '#4ade80' : '#fbbf24';
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
