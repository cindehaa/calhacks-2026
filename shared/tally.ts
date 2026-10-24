// What each deployed troop actually did, for the logs: cost against value is how the pricing
// formula gets tuned. Fed by step()'s hits, spawns and deaths; the server tick and bot mode both use it.
import type { StepResult } from './sim';

export interface TroopTally {
  unitDamage: number; // dealt to enemy units
  towerDamage: number;
  kills: number; // enemy units finished off
  towersDestroyed: number;
  alive: number; // units still standing
  diedAt: number; // match seconds when the last unit fell; -1 while any stand
}

export const newTally = (count: number): TroopTally => ({
  unitDamage: 0, towerDamage: 0, kills: 0, towersDestroyed: 0, alive: count, diedAt: -1,
});

// The troops one step touched, so the caller only writes those back.
export function troopsHit<K>(res: StepResult, troopOf: (unitId: number) => K | undefined): Set<K> {
  const out = new Set<K>();
  for (const h of res.hits) {
    const k = troopOf(h.by);
    if (k !== undefined) out.add(k);
  }
  for (const id of [...res.deadUnitIds, ...res.spawned.map(b => b.parentId)]) {
    const k = troopOf(id);
    if (k !== undefined) out.add(k);
  }
  return out;
}

// Adds one step's hits and deaths at match time `time`. Unit ids without a tally are skipped.
export function tallyStep<K>(tallies: Map<K, TroopTally>, res: StepResult, troopOf: (unitId: number) => K | undefined, time: number): void {
  const get = (unitId: number) => {
    const k = troopOf(unitId);
    return k === undefined ? undefined : tallies.get(k);
  };
  for (const h of res.hits) {
    const t = get(h.by);
    if (!t) continue;
    if (h.tower) {
      t.towerDamage += h.damage;
      if (h.kill) t.towersDestroyed++;
    } else {
      t.unitDamage += h.damage;
      if (h.kill) t.kills++;
    }
  }
  // Spawner minions count as their spawner's troop.
  for (const b of res.spawned) {
    const t = get(b.parentId);
    if (t) t.alive++;
  }
  for (const id of res.deadUnitIds) {
    const t = get(id);
    if (!t) continue;
    t.alive = Math.max(0, t.alive - 1);
    if (t.alive === 0 && t.diedAt < 0) t.diedAt = time;
  }
}
