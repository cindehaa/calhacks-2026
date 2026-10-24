// The control scheme: a small state machine that turns raw input signals into game intents. The
// input hub (controller.ts) owns the camera, mic and recogniser and publishes signals; the scheme
// (pinch.ts) reads them and emits intents; the controller carries the intents out. Times are
// performance.now() ms; points are screen px.
import type { Pt } from '../trail';

export type { Pt };

export type Gestures = Record<'Thumb_Down' | 'Open_Palm' | 'Pointing_Up' | 'Pinch', number>; // 0..1

export type Signal =
  // A camera frame. With visible false there was no hand in it.
  | { kind: 'hand'; t: number; visible: false }
  | {
      kind: 'hand'; t: number; visible: true;
      cursor: Pt; // index fingertip, filtered
      overHalf: boolean; // the fingertip points somewhere you may deploy
      gestures: Gestures;
      pinched: boolean; // the pinch measure says closed (thumb on the index or middle finger)
    }
  // Gestures the hub reads off the hand.
  | { kind: 'pinch'; t: number; aim: Pt } // thumb to index or middle finger, once per pinch; aim: the fingertip ~100 ms before
  // Mic voice activity: t is when the sound started or stopped.
  | { kind: 'voice'; t: number; phase: 'start' | 'end' }
  | { kind: 'level'; t: number; db: number; loud: boolean } // every frame while the mic is on
  // Transcript: one partial or final segment, and everything waiting to be sent.
  | { kind: 'words'; t: number; text: string; final: boolean; waiting: string; cancel: boolean } // cancel: it was "cancel"
  | { kind: 'key'; t: number; key: 'Space' | 'Escape'; repeat: boolean }
  | { kind: 'mouse'; t: number; at: Pt; phase: 'down' | 'move' } // down: left button on the board
  // The deploy pipeline. pending: begin_deploy sent, nothing paid yet (cancel refunds it all).
  // sent: deploy_troop went out; too late to take back.
  | { kind: 'deploy'; t: number; phase: 'pending' | 'sent' | 'done'; nonce: number }
  | { kind: 'tick'; t: number };

export type SignalKind = Signal['kind'];

export type Intent =
  | { kind: 'commit'; t: number; by: string; at?: Pt } // deploy the words said up to t
  | { kind: 'cancel'; why: string } // take back a deploy that's still pending (refunded)
  | { kind: 'clear'; why: string } // throw away the words waiting
  | { kind: 'uiActivate'; at: Pt | null; fallback?: boolean }; // click the menu item at `at`

// What a scheme may ask about the game, read at the moment of the signal.
export interface SchemeCtx {
  menus(): boolean; // a menu or dialog is up: the hand works buttons, not the board
  playing(): boolean;
  cursor(): Pt | null; // the default cursor: the fingertip, else the mouse
  waiting(): string; // words said since the last commit (and typed text)
  camera(): boolean;
  canDeployAt(p: Pt): boolean;
}

export interface SchemeInstance {
  on(s: Signal): void;
  state?(): string; // for the workshop page
}

export interface Scheme {
  id: string;
  name: string;
  howTo: string; // one line, on the setup card and under the board
  needs: SignalKind[];
  create(emit: (i: Intent) => boolean | void, ctx: SchemeCtx): SchemeInstance;
}
