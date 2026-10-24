// The end-of-round story: why you won or lost, and the numbers behind it. Pure, so the
// result screen and the tests share it.
import { MATCH_SECONDS, TIEBREAK_AT } from '../../shared/arena';

export interface RoundSummary {
  outcome: 'win' | 'lose' | 'draw';
  forfeit: boolean; // ended by a forfeit rather than towers or the clock
  towersTaken: number; // enemy towers you destroyed (king included)
  towersLost: number;
  theirKingDown: boolean;
  myKingDown: boolean;
  myKingStruck: boolean; // your king tower lost any health
  theirKingFellAt: number | null; // match seconds
  myKingFellAt: number | null;
  cappedSecs: number; // time you sat on full elixir
  endedAt: number; // match seconds; past MATCH_SECONDS is overtime, past TIEBREAK_AT the tiebreaker
  myBest: { name: string; damage: number } | null;
  theirBest: { name: string; towerDamage: number } | null;
}

export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');

// How a match level on towers at the buzzer was settled, or null if it wasn't.
function decider(s: RoundSummary, won: boolean): string | null {
  if (s.forfeit || s.theirKingDown || s.myKingDown) return null;
  if (s.endedAt > TIEBREAK_AT) return won ? 'Their weakest tower fell first in the tiebreaker' : 'Your weakest tower fell first in the tiebreaker';
  if (s.endedAt > MATCH_SECONDS + 0.1) return won ? 'You took the first tower in overtime' : 'They took the first tower in overtime';
  return won ? 'You held more towers when time ran out' : 'They held more towers when time ran out';
}

// An overtime or tiebreaker finish is the headline; a lead at the buzzer is one reason among several.
function settle(out: string[], s: RoundSummary, won: boolean) {
  const how = decider(s, won);
  if (how && s.endedAt > MATCH_SECONDS + 0.1) out.unshift(how);
  else if (how) out.push(how);
}

export function reasons(s: RoundSummary): string[] {
  const out: string[] = [];
  if (s.outcome === 'win') {
    if (s.forfeit) out.push('Your opponent forfeited');
    if (s.theirKingDown) out.push(`You destroyed their king tower${s.theirKingFellAt !== null ? ` at ${clock(s.theirKingFellAt)}` : ''}`);
    const princess = s.towersTaken - (s.theirKingDown ? 1 : 0);
    if (princess >= 2) out.push('You took both princess towers');
    else if (princess === 1) out.push('You took a princess tower');
    settle(out, s, true);
    if (!s.myKingStruck) out.push('Your king tower was never struck');
    if (s.myBest && s.myBest.damage > 0) out.push(`${s.myBest.name} dealt ${num(s.myBest.damage)} damage`);
  } else if (s.outcome === 'lose') {
    if (s.forfeit) out.push('You forfeited');
    if (s.myKingDown) out.push(`Your king tower fell${s.myKingFellAt !== null ? ` at ${clock(s.myKingFellAt)}` : ''}`);
    else if (s.towersLost > 0) out.push(`They took ${s.towersLost === 1 ? 'one' : s.towersLost} of your towers`);
    if (s.theirBest && s.theirBest.towerDamage > 0) out.push(`Their ${s.theirBest.name} did ${num(s.theirBest.towerDamage)} to your towers`);
    if (s.cappedSecs >= 5) out.push(`You sat on full embers for ${Math.round(s.cappedSecs)} s`);
    settle(out, s, false);
  } else {
    out.push(s.endedAt > TIEBREAK_AT ? 'Both weakest towers fell together in the tiebreaker' : 'Neither king fell');
    out.push(`Towers even at ${s.towersTaken}–${s.towersLost}`);
    if (s.cappedSecs >= 5) out.push(`You sat on full embers for ${Math.round(s.cappedSecs)} s`);
  }
  return out.slice(0, 3);
}
