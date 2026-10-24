// The "Most creative troop" card on the result screen: your troop that did the most damage, with its
// art, its name and the words that summoned it. The total damage all your troops dealt goes in its own
// slab (#dmgTotal). Bot matches have exact numbers from the round's
// tallies (LocalMatch.report()); online, each hit a unit lands (its attackSeq bumping) is credited
// with that unit's damage per hit, which leaves out splash and chain targets past the first.
import './mvp.css';
import type { MatchUnit } from './match';
import type { DrawTroop } from './render';
import { glyphImage, troopGlyph } from './tokens';

export interface MvpPick { name: string; words: string; spriteUrl: string; damage: number; cost: number; exact: boolean }
interface Info { side: number; name: string; words: string; spriteUrl: string; cost: number }

export class MvpTracker {
  private seq = new Map<bigint, number>(); // unit id → last attackSeq
  private dmg = new Map<bigint, number>(); // troop id → damage credited
  private info = new Map<bigint, Info>();

  reset(): void {
    this.seq.clear();
    this.dmg.clear();
    this.info.clear();
  }

  // Once a frame during a match. Troop rows can go when their units die, so keep what we need.
  observe(units: MatchUnit[], troops: Map<bigint, DrawTroop>, time: number): void {
    if (time < 0) {
      if (this.info.size) this.reset();
      return;
    }
    for (const u of units) {
      const before = this.seq.get(u.id);
      this.seq.set(u.id, u.attackSeq);
      if (before !== undefined && u.attackSeq > before && u.delay <= 0) {
        this.dmg.set(u.troopId, (this.dmg.get(u.troopId) ?? 0) + (u.damage ?? 0) * (u.attackSeq - before));
      }
      const t = troops.get(u.troopId);
      if (t) this.info.set(u.troopId, { side: u.side, name: t.name, words: t.description ?? '', spriteUrl: t.spriteUrl, cost: t.cost });
    }
  }

  // Damage dealt by all your troops; `exact` as for best().
  total(side: number, exact?: { side: number; unitDamage: number; towerDamage: number }[]): number {
    if (exact) return exact.reduce((n, t) => n + (t.side === side ? t.unitDamage + t.towerDamage : 0), 0);
    let n = 0;
    for (const [tid, d] of this.dmg) if (this.info.get(tid)?.side === side) n += d;
    return n;
  }

  // Your best troop. `exact` (bot matches) is the round's tallies by troop id.
  best(side: number, exact?: { troopId: bigint; side: number; unitDamage: number; towerDamage: number; name: string; description: string; cost: number }[]): MvpPick | null {
    if (exact) {
      let top: (typeof exact)[number] | null = null;
      for (const t of exact) if (t.side === side && (!top || t.unitDamage + t.towerDamage > top.unitDamage + top.towerDamage)) top = t;
      if (!top || top.unitDamage + top.towerDamage <= 0) return null;
      const i = this.info.get(top.troopId);
      return { name: top.name, words: top.description, spriteUrl: i?.spriteUrl ?? '', damage: top.unitDamage + top.towerDamage, cost: top.cost, exact: true };
    }
    let id: bigint | null = null, most = 0;
    for (const [tid, d] of this.dmg) if (this.info.get(tid)?.side === side && d > most) { most = d; id = tid }
    if (id === null) return null;
    const i = this.info.get(id)!;
    return { name: i.name, words: i.words, spriteUrl: i.spriteUrl, damage: most, cost: i.cost, exact: false };
  }
}

// Fills the card on the result screen, just above the buttons. With no troop to show (none
// deployed, or none landed a hit) it still shows the total.
export function renderMvp(pick: MvpPick | null, total: number): void {
  let card = document.getElementById('mvpCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'mvpCard';
    card.className = 'gPanel mvpCard';
    document.querySelector('#result .resultCol .actions')?.before(card);
  }
  const art = pick && /^\/api\/sprite\//.test(pick.spriteUrl) ? pick.spriteUrl.replace(/\?key$/, '') : '';
  const words = !pick ? '' : pick.words.length > 90 ? pick.words.slice(0, 89) + '…' : pick.words;
  card.innerHTML = `<div class="gFace">
    <div class="mvpArt"></div>
    <div class="mvpText">
      <span class="gLabel">Most creative troop</span>
      <b class="mvpName"></b>
      <q class="mvpWords"></q>
    </div>
  </div>`;
  // Total damage is everyone's, not this troop's: it has its own slab beside the XP.
  document.getElementById('dmgTotal')!.textContent = Math.round(total).toLocaleString('en-US');
  card.classList.toggle('none', !pick);
  card.querySelector('.mvpName')!.textContent = pick?.name ?? 'No troops landed a hit';
  card.querySelector('.mvpWords')!.textContent = words;
  if (!pick) return;
  const box = card.querySelector('.mvpArt')!;
  if (art) {
    const img = new Image();
    img.alt = pick.name;
    img.src = art;
    box.append(img);
  } else {
    const c = glyphImage(troopGlyph(pick.name, pick.words), 96) as HTMLCanvasElement;
    box.append(c);
  }
}
