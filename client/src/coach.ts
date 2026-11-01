// Coaching in a new player's first matches with the camera: one short line, as a notice, when
// they look stuck (coachrules.ts decides when). Off after COACHED_MATCHES matches, counted in
// this browser, and never in the first summon, which coaches every step itself (onboard.ts).
import { COACH, CoachRules, type CoachRule } from './coachrules';
import type { InputController } from './input/controller';
import { ADVICE_TEXT } from './input/framing';
import { notice } from './notice';
import { logEvent } from './telemetry';

const COUNT_KEY = 'arena.coachMatches';
const COACHED_MATCHES = 3;

function count(): number {
  try { return Number(localStorage.getItem(COUNT_KEY)) || 0 } catch { return 0 }
}
function bump(): number {
  const n = count() + 1;
  try { localStorage.setItem(COUNT_KEY, String(n)) } catch { /* private mode */ }
  return n;
}

// playing: a match (not the first summon) under way, past its countdown.
export function initCoach(input: InputController, playing: () => boolean): void {
  let rules: CoachRules | null = null;
  let was = false;

  input.listeners.signal.push(s => {
    if (!rules) return;
    if (s.kind === 'hand') rules.hand(s.t, s.visible);
    else if (s.kind === 'pinch') rules.pinch(s.t);
    else if (s.kind === 'ignored') rules.ignoredWords(s.t);
  });

  const say = (rule: CoachRule, r: CoachRules): string => {
    const a = r.currentAdvice;
    switch (rule) {
      case 'idle': return 'Pinch your thumb to a finger and hold it, then say what you want';
      case 'talkNoPinch': return 'Only words said while you pinch count: pinch, then talk';
      case 'handFlaky': return a !== 'ok' && a !== 'none' ? ADVICE_TEXT[a] : 'Keep your hand in the middle of the camera’s view';
      case 'framing': return ADVICE_TEXT[a];
    }
  };

  setInterval(() => {
    const now = performance.now(), on = playing() && input.framing() !== null;
    // A new match with the camera on: one of the first few gets coached.
    if (on && !was) rules = bump() <= COACHED_MATCHES ? new CoachRules() : null;
    if (!on && was) rules = null;
    was = on;
    if (!rules) return;
    rules.framing(now, input.framing() ?? 'none');
    const rule = rules.tick(now, true);
    if (!rule) return;
    logEvent(`coach:${rule}`, rule === 'framing' || rule === 'handFlaky' ? rules.currentAdvice : '');
    notice(say(rule, rules), { tone: 'info', ms: COACH.gapMs - 3000, key: 'coach' });
  }, 100);
}
