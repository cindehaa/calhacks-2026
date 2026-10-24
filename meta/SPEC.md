# Abracadabra — Spec v2

Spec as of 22 Oct 2026. This file is the repo copy of the spec; progress against it lives in [PROGRESS.md](PROGRESS.md). When a decision changes, update both.

## Overview

A real-time, two-player arena battler where you never touch a card. You point at a spot with your hand and say what the troop is. AI turns your words into a fighting unit with stats, a price, artwork and its own voice.

- **One-line pitch:** an arena battler where your deck is whatever you can describe.
- **The hook:** every match is a battle of how quickly and vividly you can describe things. "Wizard with fire", "swarm of angry bees" and "a slow iron golem" all become real units.
- **The gamble:** you don't see the elixir cost before deploying, so every description is a bet.

**What changed in v2:** sponsor fit (SpacetimeDB, Anthropic, Cartesia, Supercell), troop voices, gesture fixes, a concrete latency plan, a balancing harness, and a build order for two people. The working title "Clash Royell" is retired because Supercell is a sponsor and owns that trademark.

## Hackathon context

Cal Hacks 13.0 runs Oct 23–25, 2026 at the Palace of Fine Arts, San Francisco. Submission is a hard deadline at **9:00 AM PT on Oct 25**; we aim to submit by 7:00 AM and edit after.

| Item | Detail |
|---|---|
| Team | 2 to 4 members; we are 2 |
| Code rule | All project work must be done during the hackathon. Learning, API testing and design notes beforehand are fine; no pre-written project code. |
| Submission | Devpost page with an image and the GitHub repo |
| Judging | 3 min pitch + 2 min Q&A, live or pre-recorded demo required |
| Criteria | Application, Intentionality, Functionality, Creativity, Technical Complexity |

**Weak spot:** "Application" asks for real-world use. Our answer: a new kind of game input where imagination is the controller, playable with no cards, buttons or deck-building.

Source: Cal Hacks 13.0 on Devpost.

## Sponsor tracks

We build one game that naturally qualifies for four sponsor tracks plus three main-event categories. Anthropic, SpacetimeDB and Supercell prizes were not posted on Devpost as of Oct 22; read their criteria at opening.

| Priority | Track | Prize (as listed) | How we qualify |
|---|---|---|---|
| 1 | SpacetimeDB (anchor) | Special prize for most impressive use | Multiplayer server: rooms, units and the combat tick live in SpacetimeDB. Attend their CEO's workshop. |
| 1 | Anthropic (anchor) | TBA at opening | Claude is the troop designer: description in, stats JSON out. |
| 1 | Cartesia: Best Use of Cartesia | $1,516 + Meta glasses (TBD) | Speech-to-text for voice input, plus TTS so every troop speaks a battle cry on deploy. |
| 1 | Supercell (sponsor) | None listed yet | Visit their booth Friday night; pitch as "what if your deck was your imagination". |
| 2 | Most Creative Project | Instax per member | Core concept |
| 2 | Most Technically Advanced | NuPhy keyboard per member | Gesture + voice + LLM + realtime multiplayer |
| 2 | Hacker's Choice | MX Master 4 per member | Other hackers can play it at our table |
| 3 | Meta: Bringing People Closer Together with AI | Trip to Round 2 at Meta | Two people playing together; low effort to submit |
| 3 | MLH Best Use of Gemini API | Swag | Only if a Gemini model wins the sprite benchmark |

Convex is a realtime alternative to SpacetimeDB; we pick one, and SpacetimeDB fits a game better.

Sources: Devpost prize list, "Spacetime is Sponsoring Cal Hacks 13.0".

## Core gameplay

Two players on different browsers join a room and fight a 90-second match; destroy the other side's towers to win.

- **Arena:** vertical, dark-themed 18 × 30 board laid out like Clash Royale: a river across the middle with two bridges, one in front of each princess tower. Visuals are our own, not copied from Clash Royale.
- **Towers:** each side has a king tower at the back centre and two princess towers in front of it, one per bridge. The king is bigger and tougher and sleeps until it takes damage or one of its princess towers falls.
- **Placement:** anywhere on your own half, up to the river bank, with no lanes or tile snapping. Taking a princess tower opens that side of the enemy half, from the river to the princess tower's row (the pocket), for your drops too.
- **Movement:** troops are ground units and can't cross the river except on a bridge. A troop headed across walks to whichever bridge makes the shorter trip, then straight at its target. Ranged troops still shoot across the water.
- **Elixir:** refills steadily to a max of 15, starting at 5, at 0.75 a second, doubled in the last 30 s (raised from 10 and 0.5 after playtests, 2026-10-24: too often short of elixir for the troop you wanted). Troop costs still top out at 10. Practice can try other numbers under Dev settings at `/dev`.
- **Deploy delay:** about 2.5 s from release to arrival. This window hides troop generation.
- **Win condition:** destroying the king tower wins at once and counts as all three towers. Otherwise most towers destroyed at 90 s. Level at 90 s: 30 s of overtime at triple elixir, where the first tower down wins. Still level: the tiebreaker. Troops freeze, deploys close, and every standing tower loses 1,200 health a second; the side whose tower falls first loses, and towers that fall together are a draw.
- **Cost reveal:** cost is hidden before deploying, then shown as a small badge on the troop so players learn the economy.

## Controls

Point, pinch, fist, with the mic always listening. Whatever you said since the last fire is the troop. Placement is free, with no tile snapping. This is the only control scheme: no picker, no A/B. (Changed on Oct 24 from knuckle aim + pinch to lock + drag-off cancel, then from a wrist flick to fire, which was unreliable.)

1. **Say:** the mic listens the whole time it's on; the words so far show above the cursor.
2. **Aim:** a cursor follows the index fingertip, whatever the rest of the hand is doing. Place anywhere on your half, or in a pocket you've opened.
3. **Fire:** touch the thumb to the middle finger. The troop goes where the index pointed about 100 ms before the pinch closed. Only the middle finger counts: a thumb nearer the index reads as open. On menus a pinch clicks the button under the fingertip. Fallbacks: Space, or a click with words waiting.
4. **Cancel:** close the hand into a fist (held about 120 ms), press Esc or say "cancel". It takes back a troop still being summoned (refunded), or else throws the words away.

**Known issues:**
- Voice "cancel" can lose the race with the quiet timer (raise it to about 700 ms).
- Voice click only measures loudness, so it needs the close mic and a threshold set on site.
- A pinch facing the camera head-on reads as open, so tilt the hand.

A 10-second on-screen tutorial teaches these steps to judges.

## Troop system

Claude fills one record in a fixed stat schema per description, and a fixed formula turns it into an elixir cost. The schema is the single source of truth: a new mechanic = a new field, engine support, and a line in the prompt.

### Stat schema

Every stat has a hard clamp enforced by JSON schema, so "500 dragons" can't exist. Ranges below are starting guesses.

| Stat | Meaning | Clamp (draft) |
|---|---|---|
| `health` | Damage the unit can take | 50–3000 |
| `damage` | Damage per hit | 10–600 |
| `attack_speed` | Hits per second | 0.3–3 |
| `move_speed` | Tiles per second | 0.3–2 |
| `range` | Tiles; 1 = melee | 1–6 |
| `count` | Copies spawned | 1–12 |
| `name` | Short display name | 1–3 words |
| `battle_cry` | Line spoken on deploy | ≤ 8 words |
| `voice_style` | TTS voice / tone hint | from a fixed list |

Every unit attacks the nearest enemy.

### Pricing

Same stats always give the same cost. Starting formula, tuned by the balancing harness:

```
power = sqrt( (health × count) × (damage × attack_speed × count) ) × f_range × f_speed
f_range = 1.0 for melee (range 1), 1.3 for ranged
f_speed = 1 + 0.25 × (move_speed − 1)
cost = max(1, round(power / K)),  K = 95
```

K is set so anchor troops land on their intended costs. (The formula didn't survive the paste from the doc; this is the draft that was calibrated on Oct 23.)

### Anchor troops

About 10 original troops with fixed stats and costs, given to Claude as few-shot reference points so "a tiny version" prices cheaper. They also have pre-generated art and serve as starter suggestions for players who freeze.

Draft roles: swarm (2–3), melee mini-tank (3), ranged caster (4), fast assassin (4), splash unit (5), glass cannon (6), big tank (7), plus 3 more to fill gaps.

### Rejection

Anything above 10 or above current elixir is rejected and the player sees what it would have cost. No penalty or cooldown, so wild ideas are encouraged.

### Meta inputs

Claude ignores numbers and stat words ("a 7-elixir troop with max health") and reads only the description, so those come out weak and bland.

### Aesthetics multiplier (stretch)

Vivid, coherent descriptions get a small boost (0.8–1.2× stats). Cut from the MVP because it's invisible in a 2-minute demo; mention it in the pitch if built.

## Voice

Voice works both ways: Cartesia speech-to-text hears the player, and Cartesia text-to-speech gives every troop a voice.

### Input

- **Push-to-talk:** audio streams only while the pinch is held, so hall noise between deploys is ignored.
- **Streaming transcript:** text arrives while the player speaks, so it's nearly final by release.
- **Close-talk mics:** one gaming headset with boom mic or clip-on lav per player. Close to the mouth beats expensive in a loud hall.
- **Browser settings:** request `noiseSuppression` and `echoCancellation` in `getUserMedia`.
- **Fallback:** typed input if voice fails.

### Troop voices

- Claude writes a short `battle_cry` and picks a `voice_style` with the stats, in the same call.
- On deploy, Cartesia TTS speaks the line: the golem rumbles "Stone does not yield", the bees buzz "BZZ, ATTACK".
- Optional: a short death line, and an announcer for match start, double elixir and tower falls.
- Play the cry through speakers, not the players' headsets, so judges and passers-by hear it.
- Keep cries ≤ 8 words so audio never piles up; drop a cry if another is still playing.

## Art and animation

Each troop gets one generated sprite, animated in code; full frame-by-frame animation is a stretch goal.

- **Sprite generation:** fal FLUX.1 schnell, 384 px, the troop description first and then one shared style prompt so every troop looks like the same game.
- **Background removal:** fal BiRefNet v2 with a 3 s timeout. If it fails, the browser keys the background by its border colour, flood-filling from the edges; plain magenta chroma-key ate pink and purple troops in prep.
- **Placeholder:** the tile shows a shadow or blur during the deploy delay. If art is late, the troop fights as a silhouette and swaps when it arrives.
- **Cache:** reuse sprites by normalized description; anchor troops are pre-generated at startup.
- **Code animation:** bob while walking, lunge or squash when attacking, flash when hit, poof on death.

## Architecture and multiplayer

The game runs in the browser on hosted APIs, with SpacetimeDB as the authoritative server; AI only creates troops and never runs during combat.

The locked tile and the troop record go to SpacetimeDB, which runs the combat tick and syncs state to both browsers. Sprites and battle-cry audio arrive separately and attach to the unit when ready.

- **Goal:** two people playing live on two laptops, each with its own webcam and mic. Multiplayer is part of the core, not an add-on.
- **Server-authoritative:** the SpacetimeDB module is written in TypeScript. Combat is a pure `step(state, dt)` function in shared code, and a scheduled reducer runs it at 20 Hz while a match is live and stops when it ends. Clients render unit rows and interpolate between ticks. No deterministic lockstep.
- **Deploys:** clients call `deploy_troop(tile, stats, sprite_url)`; the reducer re-clamps stats and charges elixir server-side. Sprites attach later by updating the unit row.
- **Rooms:** create or join by a short code, plus a fixed demo room that both table laptops join automatically, and one-tap rematch.
- **Opponent's pending deploy:** starting answer is the tile, the spoken troop name and the arrival countdown; settle in playtests.
- **Same sim, three uses:** the shared `step()` also runs bot mode and the headless balancing sim, so the fallback costs nothing extra.
- **Fallback:** if the network or Maincloud fails at the table, switch to local play against the bot on the same sim.
- **Stretch:** move the Claude call into a SpacetimeDB procedure (`ctx.http.fetch`), so troops are designed and priced server-side and the API key never reaches the browser.

## Latency plan

Goal: stats ready inside the 2.5 s deploy delay; art may arrive later. The original 1–2 s estimate is optimistic, so every step below removes waiting.

1. **Stream STT during the pinch.** The transcript is nearly done at release.
2. **Run Claude and image gen in parallel** off the raw transcript. Art never waits for stats.
3. **Fastest Claude model** (Haiku-class) with a tight JSON schema and short output.
4. **Small images:** 384 px on a flat magenta background, cut out by BiRefNet v2 (3 s cap), border-colour key in the browser as the fallback.
5. **Cache** by normalized description; pre-generate anchors.
6. **Warm connections:** open API connections at match start, not on first deploy.
7. **Graceful lateness:** silhouette until art lands; TTS cry plays when ready.

Benchmark each provider with throwaway scripts and pick models by measured p50 and p90, not by reputation.

## Balancing

Balance comes from three layers: hard clamps, a pricing formula anchored to known troops, and a headless sim that flags outliers.

- **Clamps:** JSON schema ranges stop absurd units before pricing.
- **Anchors:** few-shot examples keep Claude's stats consistent between similar descriptions.
- **Headless battle sim:** a script runs generated troops against each anchor with no rendering and reports cost-efficiency (damage dealt and HP traded per elixir). Anything far off the curve means the formula or the prompt needs tuning.
- **Playtests:** real matches tune the elixir rate and K.

The sim reuses the game engine, costs a few dozen lines, and is a strong answer to the Technical Complexity criterion.

Oct 23 playground check: with Haiku 5.5 and the draft formula (K = 95), Isaac found the balance "actually pretty good". Further tuning comes from player feedback and repeated playtests at the event, not more prep.

## Build plan

Prepare ambitiously, build lean. **The cut line is phase 2:** two players in a room, a spoken or typed troop, stats, a cost and a sprite fighting. Nothing past phase 2 starts until that works end to end. Each phase leaves a working, demoable game.

| Phase | Person A: game + multiplayer | Person B: AI + input | Demoable result |
|---|---|---|---|
| 1 | SpacetimeDB rooms; arena, river and bridges, towers, elixir, hardcoded troops fighting in a shared `step()` | Troop designer: text in, JSON stats out; cost formula; anchors | Two browsers in one room, fixed troops |
| 2 | Hook designer up via a text box | Cartesia STT with push-to-talk | Playable with typed or spoken troops |
| 3 | Code animations, silhouette placeholder, headless sim | Hand tracking, lock, drag-off cancel, voice click | Full input loop |
| 4 | Move `step()` into the 20 Hz server tick; interpolation, rematch, demo room | Sprite gen, chroma-key, cache, anchor art, Cartesia TTS cries | Two-browser match with art and voices |
| 5 | Polish, tutorial overlay, sound | Polish, Devpost writeup, backup video | Submission |

- Commit to git constantly; one person owns merges near the deadline.
- Feature freeze about 3 hours before submission.
- Sleep a few hours on Saturday night.

## Demo and pitch

The judge plays against us; that beats any slide.

1. **Hook (10 s):** "An arena battler with no deck. You point and say what you want."
2. **Hand over the controls:** the judge points, pinches and says anything. The troop arrives and shouts its battle cry.
3. **Architecture in one line while it generates:** "Claude designs the stats, a formula prices it, Cartesia gives it a voice, and SpacetimeDB runs the match, so combat never waits on AI."
4. Let the 90-second match finish.
5. **Q&A prep:** latency numbers, how pricing stays fair (clamps, anchors, sim), what happens with weird inputs.

For sponsor judges, open with their tech. Have the game loaded and in a room before the judge arrives. Keep a recorded backup video for Devpost and for when wifi dies. Rehearse with strangers, since first-timers fumble the gestures.

## Prep checklist

Prep is learning, testing and design only; project code is written at the event.

- [ ] Prototype hand tracking and pinch tile lock
- [ ] Buy one Samson Q2U (white, handheld dynamic, store pickup since delivery lands after the event); the guest always gets it, we use earbuds
- [ ] Get API keys: Anthropic, Cartesia, image model; install SpacetimeDB CLI
- [ ] Do the SpacetimeDB quickstart (throwaway) plus a throwaway rooms spike (create and join by code, presence, published to Maincloud, tested from two machines); it is not carried into the project, and phase 1 rebuilds it
- [ ] Benchmark latency: Cartesia STT, Haiku troop JSON, Cartesia TTS, 2–3 image models
- [ ] Find a shared art style prompt where 5 random troops look like one game
- [ ] On paper: 10 anchor troops and the cost formula
- [ ] Pick a game name
- [ ] Pack: external webcams, small desk lamp or ring light, power strip, phone hotspot, headphones splitter or speaker for cries
- [ ] At the event: attend the SpacetimeDB workshop; visit Supercell, Cartesia and Anthropic booths Friday night; read every track's full criteria
- [ ] Sleep tonight

(The checkbox states didn't come through when the doc was copied. Real status is tracked in [PROGRESS.md](PROGRESS.md).)

## Prep tests

Run before the event with throwaway scripts; carry the numbers and prompt text in, not the scripts. Tests 1–3 use a shared set of about 30 test descriptions, which also seeds the balancing sim.

| # | Test | What to measure | Pass bar |
|---|---|---|---|
| 1 | Latency, end to end | Cartesia STT time to final transcript after release; Claude troop JSON (Haiku-class vs. one step up); 2–3 image models at 256 px; Cartesia TTS time to first audio. About 20 calls each, p50 and p90. | Stats under 2.5 s after release at p90; art may land later |
| 2 | Troop designer consistency | Same description 5 times; "tiny" and "giant" variants | Cost spread ≤ 1 elixir; size words move cost the right way |
| 3 | Troop designer abuse | "God that kills everything", "1000 ants", "7-elixir troop with max health", prompt injection, gibberish, empty, "cancel", Pikachu, offensive input | Clamps hold; never crashes or returns empty; bad input gives a weak unit |
| 4 | Art style | One style prompt across about 8 varied troops, viewed at about 64 px | Look like one game and stay readable small |
| 5 | Chroma-key | Pink fairy, purple slime and a ghost on magenta | Key doesn't eat the troop, or switch colour or remover |
| 6 | STT in noise | Loud crowd-noise playback, Q2U vs. earbuds, words like golem, wyvern, necromancer | Transcripts usable as-is |
| 7 | Troop voices | 5–6 `voice_style` values mapped to Cartesia voices | Cries recognisable by character |

Test 1 decides the most: if p90 is over 2.5 s, lengthen the deploy delay or pick a faster model before anything else.

## Open questions

These are still ours to figure out; each has a starting answer to beat.

| Question | Starting answer | Settled by |
|---|---|---|
| Which image model hits our sprite latency? | Fastest of 2–3 benchmarked | Benchmark |
| Which Claude model and prompt give consistent stats fast enough? | Haiku-class, anchors as few-shot | Benchmark |
| Exact stat clamps, formula weights, K, elixir rate | Drafts in Troop system and Core gameplay | Headless sim + playtests |
| Which 10 anchor troops, with what stats? | Roles listed in Troop system | Paper design |
| Shared art style prompt | Undecided | Playground tests |
| SpacetimeDB server language and tick rate | TypeScript module, 20 Hz scheduled reducer | Rooms spike before hacking |
| Does the game run fully on SpacetimeDB, or just rooms and state sync? | Full server-side combat tick | Decided Oct 23: rooms first, tick in phase 4 |
| What do Anthropic, SpacetimeDB and Supercell tracks require? | Unknown until opening | Read criteria at opening |
| Cartesia STT accuracy in the hall | Push-to-talk + close mics | Test on site Friday |
| Battle-cry audio: how many overlap, and when? | One at a time, ≤ 8 words | Playtests |
| Description length cap? | None; time pressure handles rambling | Playtests |
| Game name | Undecided | Before Devpost |
| Who presents? | Undecided | Before Saturday night |

## Stretch goals and future

Only after phase 4 works end to end.

- Aesthetics multiplier (0.8–1.2×) for vivid descriptions
- Announcer voice for match events; death lines for troops
- Spells cast with gestures: swipe for a fireball, push for a shockwave
- Targeting rules: air, ground, buildings only
- Elements and a damage-multiplier table
- Buildings, e.g. an elixir farm
- Real animation frames generated in the background
- Spectator view for the expo table
