// The end-of-round story: why the day was won or lost, and the numbers behind it. Pure, so the
// result screen and the tests share it.

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
  myBest: { name: string; damage: number } | null;
  theirBest: { name: string; towerDamage: number } | null;
}

export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');

export function reasons(s: RoundSummary): string[] {
  const out: string[] = [];
  if (s.outcome === 'win') {
    if (s.forfeit) out.push('Your foe yielded the field');
    if (s.theirKingDown) out.push(`You toppled their king tower${s.theirKingFellAt !== null ? ` at ${clock(s.theirKingFellAt)}` : ''}`);
    const princess = s.towersTaken - (s.theirKingDown ? 1 : 0);
    if (princess >= 2) out.push('You took both princess towers');
    else if (princess === 1) out.push('You took a princess tower');
    if (!s.forfeit && !s.theirKingDown) out.push('You held more towers when time ran out');
    if (!s.myKingStruck) out.push('Your king tower was never struck');
    if (s.myBest && s.myBest.damage > 0) out.push(`${s.myBest.name} dealt ${num(s.myBest.damage)} damage`);
  } else if (s.outcome === 'lose') {
    if (s.forfeit) out.push('You yielded the field');
    if (s.myKingDown) out.push(`Your king tower fell${s.myKingFellAt !== null ? ` at ${clock(s.myKingFellAt)}` : ''}`);
    else if (s.towersLost > 0) out.push(`They took ${s.towersLost === 1 ? 'one' : s.towersLost} of your towers`);
    if (s.theirBest && s.theirBest.towerDamage > 0) out.push(`Their ${s.theirBest.name} did ${num(s.theirBest.towerDamage)} to your towers`);
    if (s.cappedSecs >= 5) out.push(`You sat on full elixir for ${Math.round(s.cappedSecs)} s`);
    if (!s.forfeit && !s.myKingDown) out.push('They held more towers when time ran out');
  } else {
    out.push('Neither king fell');
    out.push(`Towers even at ${s.towersTaken}–${s.towersLost}`);
    if (s.cappedSecs >= 5) out.push(`You sat on full elixir for ${Math.round(s.cappedSecs)} s`);
  }
  return out.slice(0, 3);
}
