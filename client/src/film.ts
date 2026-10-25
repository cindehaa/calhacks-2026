// Film mode (dev only, ?film): a scripted match for the demo video. Both players' lines come from a
// script, timed in seconds from FIGHT!, and go through the game's own paths: the viewer's like a
// pinch and their voice (the hand cursor, the words at it, the orb, the summoning circle, the cost
// reel), the other side's as the opponent's drops and bubbles. Designs and art are whatever /api
// answers, which video-assets/scripts/film.mjs serves from the baked troops, so every render of
// the script is the same match. The match clock runs slower than the action (clockRate), so a
// long duel still ends before overtime; towers can be guarded and felled on cue.
import { TICK_HZ, type Side } from '../../shared/arena';
import { price, type TroopDesign } from '../../shared/troop';
import type { Drops } from './drops';
import type { DeployHow } from './input/controller';
import type { InputView } from './input/draw';
import { LocalMatch } from './local';
import type { Pose, PovBoard } from './pov';
import { sfx } from './sfx';

export interface FilmTroop { line: string; design: TroopDesign; sprite: string }
export type FilmEvent = { t: number } & (
  | { aim: [number, number]; side: Side; dur: number } // that player's hand glides to a board spot (shown on their screen)
  | { say: string; side: Side; at: [number, number]; talk: number } // a troop from `troops`, said for `talk` s
  | { guard: Side; min: number } // that side's towers can't drop below min × their health
  | { unguard: Side }
  | { fell: Side; lane: number; over: number } // drain a tower to nothing over `over` s
  | { stun: Side } // every unit of that side stands frozen
  | { camera: Pose | null } // a fixed camera (board units), or back to the player's eye
);
export interface FilmScript {
  view: Side; // whose screen this is
  names: [string, string]; // blue, red
  clockRate: number; // match clock seconds per second of action
  hand?: boolean; // false: no hand cursor or words (plates without a player)
  troops: Record<string, FilmTroop>;
  events: FilmEvent[];
}

interface Host {
  board: PovBoard;
  drops: Drops;
  beginAt(spot: [number, number], by: string): number | null;
  designAt(nonce: number, spot: [number, number], description: string, how?: DeployHow): Promise<void>;
  start(m: LocalMatch): void;
  setView(v: () => InputView | undefined): void;
}

// A bot match with the bot switched off: the script deploys for the other side.
class FilmMatch extends LocalMatch {
  override readonly side: Side;
  override readonly label: string; // "vs Isaac" on the clock and the result screen, not "vs Bot"
  t = -Infinity; // seconds of action since FIGHT!
  private guards = new Map<Side, number>();
  private drains: { side: Side; lane: number; from: number; at: number; over: number }[] = [];
  private stunned = new Set<Side>();
  private onTick: (t: number) => void = () => {};

  constructor(private script: FilmScript) {
    super('normal');
    this.side = script.view;
    this.foe = script.names[1 - script.view];
    this.label = `vs ${this.foe}`;
  }

  protected override runBot() {}

  every(f: (t: number) => void) { this.onTick = f; }

  override tick(dt?: number): void {
    const step = dt ?? 1 / TICK_HZ, before = this.s.time;
    super.tick(step);
    // The countdown's last tick snaps the clock to 0; only ticks of the match proper count.
    if (before < 0) return;
    // Slow the clock down by the part of this step it shouldn't have counted.
    this.t = this.t < 0 ? this.s.time : this.t + step;
    this.s.time -= step * (1 - this.script.clockRate);
    for (const tw of this.s.towers) {
      const min = this.guards.get(tw.side);
      if (min !== undefined && tw.hp > 0) tw.hp = Math.max(tw.hp, tw.maxHp * min);
    }
    for (const d of this.drains) {
      const tw = this.s.towers.find(w => w.side === d.side && w.lane === d.lane);
      if (tw && tw.hp > 0) tw.hp = Math.min(tw.hp, d.from * Math.max(0, 1 - (this.t - d.at) / d.over));
    }
    for (const u of this.s.units) if (this.stunned.has(u.side)) u.stunT = 1;
    this.onTick(this.t);
  }

  guard(side: Side, min: number | null) {
    if (min === null) this.guards.delete(side);
    else this.guards.set(side, min);
  }
  fell(side: Side, lane: number, over: number) {
    const tw = this.s.towers.find(w => w.side === side && w.lane === lane);
    if (tw) this.drains.push({ side, lane, from: tw.hp, at: this.t, over });
  }
  stun(side: Side) { this.stunned.add(side); }
  // The script is the rules: whoever speaks has the embers for it.
  afford(side: Side, cost: number) { this.s.elixir[side] = Math.max(this.s.elixir[side], cost); }
  say(side: Side, nonce: number, [x, y]: [number, number]) { this.lock(side, nonce, x, y); }
  drop(side: Side, nonce: number, [x, y]: [number, number], t: FilmTroop) { this.deploy(side, nonce, x, y, t.line, t.design, t.sprite); }
}

export function openFilm(host: Host): void {
  // Every sound the game plays, with when: video-assets builds the match's audio from it.
  const cues: { t: number; name: string; kind?: string; pitch?: number }[] = [];
  const play = sfx.play.bind(sfx);
  sfx.play = (name, kind, pitch) => {
    cues.push({ t: performance.now(), name, kind, pitch });
    play(name, kind, pitch);
  };
  let m: FilmMatch | null = null;
  // The render (film.mjs) starts the script, then reads where the action is and whether it's over.
  Object.assign(window, { film: {
    start: (s: FilmScript) => void (m = run(host, s)),
    time: () => m?.t ?? -Infinity,
    status: () => m?.status ?? 'none',
    // A camera the render moves itself, frame by frame (the cold open's drone shot), or null for the eye.
    camera: (p: Pose | null) => setCamera(host.board, p),
    cues,
  } });
}

// From a film camera your king is an ordinary tower; only your own eye stands it up as a lookout.
function setCamera(board: PovBoard, p: Pose | null) {
  board.filmPose = p;
  board.eye = p ? 'high' : 'top';
}

function run(host: Host, script: FilmScript): FilmMatch {
  const m = new FilmMatch(script);
  host.start(m);
  // A player with camera and mic on knows how to send; the dock's how-to and status lines stay out of shot.
  document.head.append(Object.assign(document.createElement('style'), { textContent: '#talkHint, #status { visibility: hidden }' }));
  const { board } = host;
  const events = [...script.events].sort((a, b) => a.t - b.t);
  const mine = (side: Side) => side === script.view;

  // The viewer's hand: a cursor gliding between board spots, the words they're saying at it, and
  // the flash that pulls them into an orb.
  let cursor: [number, number] = [9, 6], from = cursor, to = cursor, glideAt = 0, glide = 0;
  let speaking: { words: string; at: number; talk: number } | null = null;
  let fireAt = -1;
  const flashes: InputView['flashes'] = [];
  const ease = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
  const spot = (t: number): [number, number] => {
    const k = glide > 0 ? ease(Math.min(1, Math.max(0, (t - glideAt) / glide))) : 1;
    // A hand held up is never quite still.
    const wob = speaking ? 0.06 : 0.12;
    return [from[0] + (to[0] - from[0]) * k + Math.sin(t * 1.7) * wob, from[1] + (to[1] - from[1]) * k + Math.sin(t * 1.3 + 1) * wob];
  };
  host.setView(() => {
    if (m.status !== 'playing' || m.t < 0 || script.hand === false) return undefined;
    const now = performance.now();
    cursor = spot(m.t);
    const s = board.toScreen(cursor[0], cursor[1]);
    if (!s) return undefined;
    const [x, y] = s;
    let words = '';
    if (speaking) {
      const all = speaking.words.split(' '), k = Math.min(1, (m.t - speaking.at) / (speaking.talk * 0.85));
      words = all.slice(0, Math.max(1, Math.ceil(all.length * k))).join(' ');
    }
    const firing = fireAt >= 0 && now - fireAt < 260;
    return {
      cursor: { x, y, state: firing ? 'fire' : 'open' },
      prompt: speaking ? { x, y, text: words, speaking: true } : null,
      flashes: flashes.filter(f => now - f.t < 1400),
      mic: speaking ? { x, y, db: -32 + 14 * Math.abs(Math.sin(m.t * 9)) + 6 * Math.sin(m.t * 23), speaking: true } : null,
      hint: '',
    };
  });

  const nonces = new Map<FilmEvent, number>();
  let next = 0;
  const later: { t: number; f: () => void }[] = [];
  m.every(t => {
    for (; next < events.length && events[next].t <= t; next++) fire(events[next], t);
    for (let i = later.length - 1; i >= 0; i--) if (later[i].t <= t) later.splice(i, 1)[0].f();
  });

  function fire(e: FilmEvent, t: number) {
    if ('aim' in e) {
      if (!mine(e.side)) return;
      from = spot(t);
      to = e.aim;
      glideAt = t;
      glide = e.dur;
    } else if ('say' in e) {
      const troop = script.troops[e.say];
      if (mine(e.side)) {
        from = spot(t);
        to = e.at;
        glideAt = t;
        glide = 0.35;
        const nonce = host.beginAt(e.at, 'release');
        speaking = { words: troop.line, at: t, talk: e.talk };
        later.push({ t: t + e.talk, f: () => {
          speaking = null;
          fireAt = performance.now();
          const s = board.toScreen(e.at[0], e.at[1]);
          if (s) flashes.push({ x: s[0], y: s[1], kind: 'deploy', label: '', t: fireAt, words: troop.line });
          if (nonce === null) return;
          m.afford(e.side, price(troop.design));
          host.drops.release(nonce, troop.line, fireAt);
          void host.designAt(nonce, e.at, troop.line, { from: 'voice', by: 'release', transcript: troop.line });
        } });
      } else {
        const nonce = 1_000_000 + nonces.size;
        nonces.set(e, nonce);
        m.say(e.side, nonce, e.at);
        later.push({ t: t + e.talk, f: () => {
          m.afford(e.side, price(troop.design));
          m.drop(e.side, nonce, e.at, troop);
        } });
      }
    } else if ('guard' in e) m.guard(e.guard, e.min);
    else if ('unguard' in e) m.guard(e.unguard, null);
    else if ('fell' in e) m.fell(e.fell, e.lane, e.over);
    else if ('stun' in e) m.stun(e.stun);
    else if ('camera' in e) setCamera(board, e.camera);
  }
  return m;
}

