// The first summon: a new player's first minute, on the real arena with the real pipeline (the
// designer, the art), one step at a time. A coach panel at the top says what to do next and
// watches the input signals to see it done, and a glowing ring on your half says where. It ends
// with a troop of theirs on the field, then a card offering a first match against the easy bot.
//
// The steps depend on the input: with the camera, show your hand (framing.ts), pinch and hold,
// say it while holding, move to the ring and let go. With the mic only, say it, then click the
// ring (or press Space; on a phone, hold the ring and lift). With neither, type it, then click
// the ring and press Enter. Mistakes send the player back a step with a sentence saying why.
import { MID_Y, type Side } from '../../shared/arena';
import type { TroopDesign } from '../../shared/troop';
import { TOUCH, type InputController } from './input/controller';
import { ADVICE_TEXT } from './input/framing';
import { pinchArt, pointArt, sayArt } from './input/handart';
import { LocalMatch } from './local';
import { sfx } from './sfx';
import { logEvent } from './telemetry';

const RING: [number, number] = [9, MID_Y - 5]; // where the ring sits on your half (side 0)
const EXAMPLE = 'a fire dragon';
const FRAMED_MS = 500; // framing ok this long to move on
const LANDED_MS = 3500; // the troop on the field this long before the done card
const CLOCK_MAX = 20; // the match clock is kept under this, so it never runs out (MATCH_SECONDS)

type Mode = 'hand' | 'voice' | 'type';
type Step = 'frame' | 'grab' | 'say' | 'place' | 'summon' | 'landed';
export type OnboardEnd = 'done' | 'skipped';

// A match with no bot and no clock: your embers stay full and the clock never runs out. It tells
// the coach when you lock a spot, when a troop of yours goes out, and when one is cancelled.
export class TutorialMatch extends LocalMatch {
  override readonly label = 'First summon';
  on: { lock?(): void; deploy?(name: string): void; cancel?(): void; leave?(): void } = {};

  constructor(onLeave: () => void) {
    super('easy', onLeave);
    this.s.time = 0.6; // past the versus card and the countdown
  }

  protected override runBot() {}

  override tick(dt?: number): void {
    this.s.elixir[0] = this.rules.max;
    if (this.s.time > CLOCK_MAX) {
      this.s.time -= CLOCK_MAX / 2;
      for (const l of this.locks) l.at -= CLOCK_MAX / 2;
    }
    super.tick(dt);
  }

  protected override lock(side: Side, nonce: number, x: number, y: number) {
    super.lock(side, nonce, x, y);
    if (side === 0) this.on.lock?.();
  }

  protected override deploy(side: Side, nonce: number, x: number, y: number, description: string, raw: TroopDesign, spriteUrl: string) {
    super.deploy(side, nonce, x, y, description, raw, spriteUrl);
    if (side === 0) this.on.deploy?.(raw.name);
  }

  override async cancelDeploy(nonce: number) {
    await super.cancelDeploy(nonce);
    this.on.cancel?.();
  }

  // Left from the pause menu, or by the coach when it's over.
  override async leave() {
    await super.leave();
    this.on.leave?.();
  }
}

export interface OnboardHost {
  start(m: LocalMatch): void; // make it the match the game shows and deploys to
  stop(): void; // and when it's left, back to home
  toScreen(x: number, y: number): [number, number] | null;
  playBot(): void;
}

export function initOnboard(input: InputController, host: OnboardHost): { run(): Promise<OnboardEnd> } {
  const el = document.getElementById('onboard')!, done = document.getElementById('onboardDone')!, ring = document.getElementById('onboardRing')!;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const title = q('[data-title]'), msg = q('[data-msg]'), count = q('[data-count]'), art = q('.handArt'), meter = q('.pinchMeter i'), fit = q<HTMLButtonElement>('[data-act="fit"]');
  let m: TutorialMatch | null = null;
  let mode: Mode = 'hand';
  let step: Step = 'frame';
  let say = ''; // a sentence holding over the step's own until sayUntil, while still on sayStep
  let sayUntil = 0;
  let sayStep: Step | null = null;
  let heard = '';
  let landed = '';
  let framedAt = 0;
  let finish: ((how: OnboardEnd) => void) | null = null;
  let holding = false; // a pinch is held (for engines whose words only come after it)
  let raf = 0;
  let timer = 0;

  const STEPS: Record<Mode, Step[]> = {
    hand: ['frame', 'grab', 'say', 'place', 'landed'],
    voice: ['say', 'place', 'landed'],
    type: ['say', 'place', 'landed'],
  };

  // quiet: going back a step, which gets no chime.
  function enter(s: Step, quiet = false) {
    if (s === step) return;
    step = s;
    logEvent(`onboard:${s}`, mode);
    if (s === 'landed') sfx.play('shimmer');
    else if (!quiet && s !== 'summon' && s !== 'frame') sfx.play('chime');
    render();
  }

  // Why the last try didn't work, over the current step's own line until the player moves on.
  function tell(text: string, ms: number, why: string) {
    say = text;
    sayUntil = performance.now() + ms;
    sayStep = step;
    logEvent(`onboard:retry:${why}`, mode);
    art.classList.remove('nudge');
    void art.offsetWidth;
    art.classList.add('nudge');
    render();
  }

  // Back to the start of a try (the grab with the camera, the words without), saying why.
  function retry(text: string, why: string) {
    enter(mode === 'hand' ? 'grab' : 'say', true);
    tell(text, 4000, why);
  }

  function text(): [string, string, () => string] {
    const ring = TOUCH ? 'Hold the glowing ring, then lift your finger' : mode === 'type' ? 'Click the glowing ring, then press Enter' : 'Click the glowing ring (or press Space) to send it there';
    switch (step) {
      case 'frame': {
        const a = input.framing();
        return ['Show your hand', !a || a === 'none' ? 'Hold your hand up to the camera, pointing at the screen' : a === 'ok' ? 'That’s it. Hold it there.' : ADVICE_TEXT[a], pointArt];
      }
      case 'grab': return ['Pinch and hold', 'Touch your thumb to any finger, and keep holding', pinchArt];
      case 'say':
        if (mode === 'hand') return ['Now say it', `Keep pinching, and say “${EXAMPLE}”`, sayArt];
        if (mode === 'voice') return ['Say a troop', `Say “${EXAMPLE}”, or anything you like`, sayArt];
        return ['Type a troop', `Type “${EXAMPLE}” in the box at the bottom, or anything you like`, sayArt];
      case 'place':
        if (mode === 'hand') return ['Aim and let go', `${heard ? `“${heard}”. ` : ''}Move onto the glowing ring, then open your hand`, pointArt];
        return ['Send it', `${heard ? `“${heard}”. ` : ''}${ring}`, pointArt];
      case 'summon': return ['Summoning…', 'Your words are becoming a troop', sayArt];
      case 'landed': return [`${landed || 'Your troop'} is on the field!`, mode === 'hand' ? 'That’s the game. Thumbs down cancels a troop before it lands.' : 'That’s the game. Esc cancels a troop before it lands.', pointArt];
    }
  }

  let artFor: (() => string) | null = null;
  function render() {
    const [t, line, a] = text();
    title.textContent = t;
    msg.textContent = performance.now() < sayUntil && step === sayStep ? say : line;
    if (artFor !== a) {
      artFor = a;
      art.innerHTML = a();
    }
    const steps = STEPS[mode], i = steps.indexOf(step === 'summon' ? 'place' : step);
    count.textContent = `${i + 1} of ${steps.length}`;
    q('.pinchMeter').hidden = mode !== 'hand' || (step !== 'grab' && step !== 'frame');
    fit.hidden = mode !== 'hand' || step !== 'grab';
    ring.hidden = step !== 'place' && step !== 'say';
  }

  // Every frame: follow the framing, the meter, the ring, and things the signals don't say.
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!finish) return;
    const now = performance.now();
    if (step === 'frame') {
      if (input.framing() === 'ok') {
        framedAt ||= now;
        if (now - framedAt >= FRAMED_MS) {
          logEvent('onboard:framed');
          enter('grab');
        }
      } else framedAt = 0;
      render();
    }
    // Speech turned out not to work here (speech.ts, the controller's watchdog): type it instead.
    if (mode !== 'type' && step !== 'summon' && step !== 'landed' && !input.speechStatus().ok) {
      mode = 'type';
      logEvent('onboard:typing', input.speechStatus().why);
      enter('say', true);
      tell(`Speech isn’t working here (${input.speechStatus().why}). Type it instead.`, 8000, 'no-speech');
    }
    if (mode === 'type' && step === 'say' && document.querySelector<HTMLInputElement>('#descInput')?.value.trim()) enter('place');
    meter.style.width = `${input.pinchProgress() * 100}%`;
    const p = host.toScreen(...RING);
    if (p) {
      ring.style.left = `${p[0]}px`;
      ring.style.top = `${p[1]}px`;
    }
    if (now < sayUntil + 50) render();
  }

  input.listeners.signal.push(s => {
    if (!finish || mode !== 'hand' && s.kind !== 'words') return;
    switch (s.kind) {
      case 'voice':
        // Speech that only becomes words after the release (the on-device model): talking while
        // holding is enough to move on to aiming.
        if (s.phase === 'start' && holding && step === 'say' && !input.speechStatus().live) enter('place');
        break;
      case 'pinch':
        holding = true;
        // A new pinch starts the words over (pinch to talk), so after one that went nowhere it's the words again.
        if (step === 'frame' || step === 'grab' || step === 'place') {
          heard = '';
          enter('say');
        }
        break;
      case 'words':
        if (s.cancel || !s.text) break;
        heard = s.waiting || s.text;
        if (step === 'say') enter('place');
        else if (step === 'place') render();
        break;
      case 'release':
        holding = false;
        // Let go before saying anything: the words have to come while the pinch is held.
        if (step === 'say') {
          retry('Say it while you’re still pinching, then let go', 'released-silent');
        }
        break;
      case 'ignored':
        if (step === 'grab' || step === 'frame') tell('Pinch first, then talk: only words said while you pinch count', 4000, 'talked-unpinched');
        break;
    }
  });

  function end(how: OnboardEnd) {
    if (!finish) return;
    const f = finish;
    finish = null;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    logEvent(how === 'done' ? 'onboard:done' : `onboard:skipped:${step}`, mode);
    el.hidden = ring.hidden = true;
    document.body.classList.remove('onboarding');
    const was = m;
    m = null;
    void was?.leave();
    done.hidden = false;
    done.querySelector('h1')!.textContent = how === 'done' ? 'You summoned your first troop' : 'Ready when you are';
    f(how);
  }

  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    b.blur();
    if (b.dataset.act === 'skip') end('skipped');
    else if (b.dataset.act === 'fit') input.onCalibrate?.();
  });
  done.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    b.blur();
    done.hidden = true;
    logEvent(`onboard:after:${b.dataset.act}`);
    if (b.dataset.act === 'bot') host.playBot();
  });

  return {
    run() {
      const s = input.setupState();
      mode = !s.speech.ok ? 'type' : s.cameraReady ? 'hand' : s.mic && input.listening ? 'voice' : 'type';
      step = 'summon'; // never the first step, so enter() below always takes
      heard = landed = say = '';
      sayUntil = framedAt = 0;
      sayStep = null;
      artFor = null;
      m = new TutorialMatch(() => host.stop());
      m.on = {
        leave: () => end('skipped'),
        lock: () => { if (step !== 'landed') enter('summon') },
        deploy: name => {
          landed = name;
          enter('landed');
          timer = window.setTimeout(() => end('done'), LANDED_MS);
        },
        cancel: () => {
          if (step !== 'summon') return;
          retry(mode === 'hand' ? 'That one didn’t go through. Pinch and try again.' : 'That one didn’t go through. Try again.', 'cancelled');
        },
      };
      host.start(m);
      el.hidden = false;
      document.body.classList.add('onboarding');
      done.hidden = true;
      logEvent('onboard:start', mode);
      enter(mode === 'hand' ? (s.framing === 'ok' ? 'grab' : 'frame') : 'say');
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      return new Promise(res => (finish = res));
    },
  };
}
