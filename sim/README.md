# Balance sim

Headless battles on the real `shared/sim.ts` `step()`, with no rendering. It reports how much each troop gets for its elixir, so K, the pricing formula, the tower stats and the anchors can be tuned from numbers rather than feel.

```sh
npm run balance                                        # the 15 anchors, a few seconds
npm run balance -- --troops sim/sample_troops.json     # plus 22 hand-made designs, about 7 s
npm run balance -- --rangePerTile 0.2 --speedSlope 0   # try a pricing change
npm run balance -- --K 90 --towerDamage 70 --towerHealth 3000
npm run balance -- --anchors my_anchors.json           # try anchor stat tweaks
npm run balance -- --help
```

The table goes to stdout. `sim/out/results.json` (every number, plus each troop's record against each opponent) and `sim/out/summary.md` are written each run; `sim/out/` is gitignored.

Designs in `--troops` / `--anchors` files are a JSON array of `{name, health, damage, attack_speed, move_speed, range, count}`, plus any quirk fields (`attack`, `targets`, `on_hit`, `windup`, `trait`); missing quirks are plain. Each one goes through `clampStats` and `price` as a deploy does in the game, and anything priced above 10 is listed as rejected. That is the format to feed it Claude-generated troops.

Knobs (`--K`, `--ranged`, `--rangePerTile`, `--speedSlope`, `--towerHealth`, `--towerDamage`, `--towerSpeed`, `--towerRange`) are passed into `price()` and `step()` as parameters. The game defaults in `shared/` are untouched.

## What it runs

- **Duels.** Every troop against every anchor (`--field all`: against every affordable troop). A deploys on side 0 and B on side 1, at the same time, 8 tiles apart across the river, which is outside every aggro radius, so both walk in and engage on their own terms. Towers stay on the board as walking targets but never shoot, so a duel measures troop against troop. A duel runs until one side is wiped, or 60 s. There are 8 placements per pair: in front of a bridge or mid-board (so both walk to a bridge first), which side acts first within a tick, and B straight ahead or 1 tile to the side.
  - **1v1:** one copy each.
  - **Elixir-matched:** copies chosen so both sides spend about the same, up to 20 elixir each (2 vs 7 elixir → 7 copies vs 2), capped at 60 bodies a side.
- **Tower pressure.** Each troop alone, from the river bank, against full-strength towers (two princess towers and a sleeping king), in front of a bridge and mid-board, for up to 90 s.

## Metrics

| Column | Meaning |
|---|---|
| Win1v1 | Share of 1v1 duels won (draws count half). Not adjusted for cost. |
| WinEM | Same, elixir-matched. |
| **Trade** | Elixir-matched: enemy elixir destroyed ÷ own elixir lost, summed over the field. A troop at x% HP counts as having lost (100−x)% of its cost. 1.00 is an even trade. **This is the efficiency metric**: the table is sorted and flagged by it. Losses are floored at 5% of spend, so a troop that is never touched gets a finite ratio (at most 20). |
| Net/e | (destroyed − lost) ÷ spent: −1 is wiped for nothing, +1 is wiping them for free. |
| HP/e | Enemy HP destroyed per elixir spent, elixir-matched. |
| Twr/e | Enemy tower HP removed per elixir in the tower runs, mean of the bridge and mid-board runs. |
| Took | Towers destroyed alone, bridge / mid-board. |
| Alive s | Seconds alive in those runs. |
| ~Fair | cost × √(Trade ÷ anchor median). A fight to the end trades HP × DPS = power², so trading x times the median means roughly √x times underpriced. Groups fighting at once amplify this (Lanchester's square law), so treat it as the largest correction worth making. |
| Flag | `++` / `--`: Trade above 1.5× or below 0.67× the anchor median. `T+` / `T-`: the same test for Twr/e. Medians come from the anchors only, so extra troops don't shift each other's flags. |

## Where it stands (2026-10-24, about 3:30 AM)

Defaults: K = 95, f_range = 1.3 + 0.2 per tile above 1, no speed charge, towers 2400 hp / 60 dps / range 6. The 15 anchors are the 10 plain fighters (retuned after the first findings below) plus 5 quirked troops.

| Troop | Cost | Power | Win1v1 | WinEM | Trade | Net/e | HP/e | Twr/e | Took | Alive s | ~Fair | Flag |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Rooftop Sniper | 6 | 591 | 76% | 69% | 2.34 | 0.43 | 155 | 200 | 0/0 | 6/11 | 8.9 | ++ |
| Storm Wizard | 6 | 607 | 72% | 67% | 1.88 | 0.31 | 151 | 47 | 0/0 | 8/14 | 8.0 | ++ T- |
| Fire Wizard | 6 | 590 | 77% | 59% | 1.73 | 0.34 | 151 | 173 | 0/0 | 9/15 | 7.7 | ++ |
| Fire Dragon | 7 | 666 | 47% | 49% | 1.60 | 0.23 | 141 | 51 | 0/0 | 11/13 | 8.6 | ++ T- |
| Twin Archers | 5 | 497 | 56% | 58% | 1.44 | 0.25 | 133 | 84 | 0/0 | 10/10 | 5.9 | T- |
| Spark Cannon | 7 | 642 | 52% | 50% | 1.42 | 0.23 | 131 | 94 | 0/0 | 14/22 | 8.1 | T- |
| Ice Archer | 4 | 393 | 50% | 50% | 1.13 | 0.08 | 100 | 68 | 0/0 | 7/12 | 4.2 | T- |
| Iron Charger | 4 | 398 | 54% | 58% | 0.97 | −0.02 | 92 | 540 | 0/0 | 20/23 | 3.8 | T+ |
| Bomb Lobber | 7 | 702 | 70% | 43% | 0.89 | −0.08 | 114 | 257 | 0/0 | 14/20 | 6.4 | |
| Shield Knight | 3 | 325 | 38% | 59% | 0.82 | −0.12 | 110 | 360 | 0/0 | 22/28 | 2.7 | T+ |
| Shadow Ninja | 3 | 328 | 28% | 48% | 0.76 | −0.18 | 113 | 230 | 0/0 | 7/9 | 2.5 | |
| Bee Swarm | 3 | 263 | 37% | 42% | 0.70 | −0.21 | 100 | 12 | 0/0 | 8/8 | 2.5 | -- T- |
| Stone Golem | 8 | 735 | 65% | 53% | 0.66 | −0.26 | 89 | 488 | 1/1 | 47/57 | 6.3 | -- T+ |
| Goblin Scrapper | 2 | 215 | 20% | 48% | 0.62 | −0.27 | 75 | 150 | 0/0 | 8/11 | 1.5 | -- |
| Battering Ram | 4 | 367 | 13% | 13% | 0.00 | −0.87 | 0 | 600 | 1/1 | 25/30 | – | T+ |

Anchor median Trade 1.05 (the Battering Ram only targets buildings, so duels don't rate it and it's left out of that median). The plain fighters now sit between 0.62 and 1.44 apart from the Sniper, so the pricing change did most of what it was meant to. What's left:

- **Ranged casters are still cheap:** the Sniper (plays like ~9), Storm Wizard and Fire Wizard (~8) and the Fire Dragon (~8.6) all trade 1.6–2.3×. The quirk multipliers for chain, breath and burn are first guesses and look low.
- **Cheap melee is still a little weak:** Goblin Scrapper, Bee Swarm, and the Stone Golem in duels (it does its job on towers).
- **Tower pressure** follows the design: rams, chargers, knights and the golem push towers; ranged and quirked casters barely touch them alone.

## First findings (2026-10-24, before the pricing change)

Kept for the reasoning behind the pricing change and the anchor retune, which both followed it. Defaults then: K = 95, f_range 1.3 flat, f_speed slope 0.25, towers 2400 hp / 60 dps / range 6, the 10 plain anchors only.

| Troop | Cost | Power | Win1v1 | WinEM | Trade | Net/e | HP/e | Twr/e | Took | Alive s | ~Fair | Flag |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Twin Archers | 3 | 308 | 44% | 92% | 3.19 | 0.66 | 180 | 187 | 0/0 | 13/13 | 5.4 | ++ |
| Rooftop Sniper | 6 | 597 | 94% | 72% | 3.07 | 0.62 | 168 | 400 | 1/1 | 10/10 | 10.7 | ++ T+ |
| Fire Wizard | 4 | 356 | 83% | 83% | 2.22 | 0.51 | 170 | 260 | 0/0 | 12/12 | 6.1 | ++ |
| Bomb Lobber | 5 | 456 | 67% | 56% | 1.26 | 0.15 | 137 | 360 | 0/0 | 17/17 | 5.7 | T+ |
| Bee Swarm | 3 | 302 | 14% | 51% | 1.06 | 0.05 | 155 | 0 | 0/0 | 7/7 | 3.1 | T- |
| Stone Golem | 7 | 643 | 89% | 50% | 0.88 | −0.09 | 121 | 300 | 1/0 | 42/31 | 6.7 | T+ |
| Iron Charger | 5 | 458 | 56% | 36% | 0.62 | −0.34 | 101 | 162 | 0/0 | 13/10 | 4.0 | -- |
| Shield Knight | 3 | 267 | 22% | 44% | 0.59 | −0.37 | 104 | 37 | 0/0 | 16/14 | 2.3 | -- T- |
| Shadow Ninja | 4 | 402 | 31% | 3% | 0.40 | −0.60 | 95 | 0 | 0/0 | 6/6 | 2.6 | -- T- |
| Goblin Scrapper | 2 | 194 | 0% | 22% | 0.39 | −0.58 | 78 | 0 | 0/0 | 7/6 | 1.3 | -- T- |

Anchor median Trade 0.97. The spread is 0.39 to 3.19 (log standard deviation 0.74).

**Over-priced for what they do (too weak):** Goblin Scrapper, Shadow Ninja, Shield Knight, Iron Charger: every cheap or fast melee anchor. **Under-priced (too strong):** Twin Archers, Rooftop Sniper, Fire Wizard: every ranged anchor except the Bomb Lobber (range 4), which is roughly fair. Bee Swarm and Stone Golem are about right.

What's behind it:

1. **Range is badly underpriced.** Units walk straight in and there is no kiting, so a range-5 unit gets free hits for the whole approach (about 6 s against a speed-0.8 knight). A 3000 hp golem dies to 10 archers without landing a hit. The flat ×1.3 doesn't cover that, and it is the same for range 2 and range 6. Among the samples, slow range-6 designs are the worst: Siege Catapult (cost 3) trades 14×, Arcane Sentinel (3) 7×, Crossbow Squad (4) 5×. Claude can produce these.
2. **Speed is charged for but is worth nothing in a fight.** Both sides close the gap anyway, and fast fragile melee still dies on the walk to a tower. The ×1.125–1.225 speed charge is why the Ninja, Charger and Scrapper sit at the bottom.
3. **The Rooftop Sniper is out of band.** 600 damage × 1.6/s is 960 DPS, and with 220 hp the sqrt(HP × DPS) formula calls that cheap. It wins 94% of 1v1s, and alone it takes a tower in either lane in about 2.5 s, from range 5 inside a single tower's cover.
4. **Towers.** Alone, only the Stone Golem (side lane only, as intended) and the Sniper take a tower. The middle tower also covers both side towers' approaches, so a side lane faces 120 dps and the middle 180. Swarms (one-shot by 60-damage shots) and every melee under about 1000 hp do roughly zero tower damage alone, so the `T-` flags on cheap melee are expected. Tower stats don't affect the duels, and 2400 / 60 / 6 looks fine once the Sniper is fixed. If it isn't, `--towerHealth 3000` or `--towerRange 7` both stop the lone Sniper tower kill and keep the Golem's side-tower take.
5. **K = 95 isn't the problem.** It only rescales costs, and the anchors already round close to their intended costs (power ÷ K: Scrapper 2.04, Golem 6.77). The shape of the formula is what's off.

### Suggested tweaks (all three since applied)

| Change | Anchor costs after | Anchor Trade spread |
|---|---|---|
| Today | 2 3 3 3 4 4 5 5 6 7 | 0.39–3.19 (log-sd 0.74) |
| 1. `--rangePerTile 0.2`, so f_range = 1.3 + 0.2 × (range − 1): range 2 → 1.5, 4 → 1.9, 5 → 2.1, 6 → 2.3 | Archers 5, Wizard 6, Lobber 7, Sniper 10 | |
| 2. plus `--speedSlope 0` (no speed charge) | Ninja 3, Charger 4, Golem 8 | 0.46–1.83 (0.35) |
| 3. plus Sniper `attack_speed` 1.6 → 0.6; Goblin Scrapper 420 hp / 100 dmg; Shield Knight 1100 hp / 120 dmg | Sniper 6; Goblin 2 and Knight 3 unchanged | 0.65–1.61 (0.25) |

With all three, eight of the ten anchors trade between 0.73 and 1.26. The edges are the Sniper (1.61, flagged strong) and the Bomb Lobber (0.65, flagged weak; range 4 now costs 7). Nothing takes a tower alone except the Golem in the side lane. If the ranged anchors should keep their costs of 3/4/5/6, trim their damage instead of accepting the new prices. The formula change still matters either way, because it is what prices Claude's ranged designs.

### Limits

Duels are a single troop type against a single troop type, with no mixed armies or kiting. So a tank screening ranged units is never measured, and near-zero-damage sponges look worse here than they would in a match: Paper Wall (3000 hp, 10 damage) costs **1** because sqrt(HP × DPS) barely charges for HP when DPS is tiny. A cost floor tied to HP (for example cost ≥ HP × count ÷ 1000) would close that.
