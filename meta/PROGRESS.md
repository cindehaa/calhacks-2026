# Progress

Running log of where we stand against [SPEC.md](SPEC.md). Newest status at the top, decisions dated at the bottom. Update it whenever something lands, changes or gets cut.

**Last updated:** 2026-10-24 · **Submission:** Devpost, 9:00 AM PT Sat Oct 25 (aim for 7:00 AM) · **Feature freeze:** about 6:00 AM Oct 25

## Where we are

**Phase 1 is scaffolded and running locally.** Two browsers can join a room, start a 90 s match and fight with the 10 anchor troops. Combat runs on the SpacetimeDB server at 20 Hz from the start. Typed descriptions go through Claude and deploy, so part of phase 2 is in too. The Claude call has not been run with a real key yet. See [README.md](../README.md) for how to run it.

## Build plan status

| Phase | Person A: game + multiplayer | Person B: AI + input | Status |
|---|---|---|---|
| 1 | SpacetimeDB rooms; arena, lanes, towers, elixir, hardcoded troops fighting in a shared `step()` | Troop designer: text in, JSON stats out; cost formula; anchors | **Done locally**; needs a real-key test and a two-laptop test |
| 2 | Hook designer up via a text box | Cartesia STT with push-to-talk | Text box done; STT **next** (cut line) |
| 3 | Code animations, silhouette placeholder, headless sim | Hand tracking, lock, drag-off cancel, voice click | Not started |
| 4 | Interpolation, rematch, demo room (server tick moved to phase 1) | Sprite gen, background removal, cache, anchor art, TTS cries | Interpolation, rematch, demo room done early |
| 5 | Polish, tutorial overlay, sound | Polish, Devpost writeup, backup video | Not started |

## Done so far

- [x] Repo scaffold: `shared/`, `server/`, `client/`, `api/` (layout in [README.md](../README.md)).
- [x] SpacetimeDB module imports `shared/` directly; `spacetime build` bundles it, no copy step needed.
- [x] Tables `player`, `room`, `troop`, `unit`, `tower`, `pending`, `match_timer`. Reducers `create_room`, `join_room` (`DEMO` creates itself), `leave_room`, `start_match` (also rematch), `begin_deploy`, `deploy_troop`, `cancel_deploy`, `set_troop_sprite`, and the 20 Hz `tick`.
- [x] `shared/sim.ts` `step()`: deploy delay, nearest-enemy targeting, attacks on a cooldown, towers shooting back, separation, elixir regen (doubled in the last 30 s), win by towers then tower health. 8 tests in `shared/sim.test.ts`.
- [x] Deploys lock first (`begin_deploy`), so the 2.5 s delay overlaps troop generation. The opponent sees the locked spot and a countdown.
- [x] Server re-clamps and re-prices every deploy, rejects cost over 10 or over current elixir, and the client shows what it would have cost.
- [x] Canvas client: lobby, room codes, board rotated so your side is at the bottom, towers, units, pending drops, elixir bar, clock, result screen, rematch, 20 Hz interpolation.
- [x] Troop designer in `api/`: Claude Haiku 5.5, structured JSON, prompt built from the anchors and clamps in `shared/`.
- [x] Checked end to end with two headless browsers on a local server: rooms, deploys, elixir rejection, the designer's error path, a full match and rematch.
- [x] Offline designer (`shared/offline_designer.ts`, `designOffline(description)`): keyword archetype to anchor stats, deterministic; hash varies only the name epithet and cry. Group size comes from the creature (small swarmers 8, medium groups 3-5, big 2-3), numbers are ignored, junk or profanity gives the weak 150 hp troop. `/api/troop` returns `{ design, cost, ms, source }` and uses it with no key or when Claude fails or takes over 4.5 s; the browser falls back to it after 7 s or an api error. `SHOW=1 npm test` prints a table of 45 sample descriptions.
- [x] Input: camera hand tracking (MediaPipe, index-knuckle cursor, One Euro smoothing, 4-point calibration, thumb + middle pinch with optional pinch calibration), pinch to lock, release to deploy, drag off the 150 px ring or lose the hand to cancel. Mic: loudness starts a voice lock, 700 ms quiet deploys, saying "cancel" cancels; the browser's speech recognition stands in for Cartesia behind a swappable interface. Camera and mic are opt-in from a top-left panel; mouse, keys and the text box still work. 34 tests on the pure parts; smoke-tested with a fake camera and mic, not yet with a real webcam.
- [x] Balance sim: `npm run balance` runs every troop against the anchors on the real `step()` (elixir-matched duels plus solo tower runs) and flags cost outliers. Knobs for K, pricing factors and tower stats; `--troops file.json` takes generated designs. Findings in [sim/README.md](../sim/README.md): range is underpriced and speed overpriced; tweaks suggested, none applied.

## Next up

**To finish phase 1**
- [ ] Put a real `ANTHROPIC_API_KEY` in `.env` and run the 30 test descriptions through `/api/troop`. Check the prompt fixes: "god" gets ordinary stats, "1000 ants" isn't max count, Pikachu's cry doesn't say "Pika", blob names vary.
- [ ] Two laptops on one network, or Maincloud: one match end to end.

**Phase 2 (the cut line)**
- [ ] Cartesia STT push-to-talk: stream mic audio through `api/` while a key or mouse button is held, show the transcript live, deploy on release.
- [ ] Tune elixir rate, tower damage and K from the first real matches.

**Phase 3 and later** — hand tracking (port the finger-lab settings below into `client/src/hand.ts`), headless balance sim on `shared/sim.ts`, bot mode, code animations (units already carry `attackSeq`), sprites and TTS cries.

## What prep settled

Numbers, settings and lessons to build from. Everything here was learned before the event; no prep code is carried over.

### Latency (measured Oct 23, 20 calls each)

| Step | p50 | p90 |
|---|---|---|
| Cartesia STT `ink-2`, end of speech → final transcript | 0.09 s | 0.10 s |
| Claude Haiku 5.5, troop JSON | 1.58 s | 2.11 s |
| Claude Sonnet 5.5, troop JSON | 1.83 s | 2.35 s |
| Cartesia TTS `sonic-3.6`, time to first audio (warm) | 0.08 s | 0.09 s |
| fal FLUX.1 schnell, 384 px | about 1.4–3.0 s | |
| fal BiRefNet v2 background removal | 0.4 s | up to 2.4 s |

Release → stats ready is **2.21 s at p90 with Haiku**, inside the 2.5 s deploy delay with about 0.3 s spare. Cold costs to avoid by warming at match start: the first Claude call takes 2–3 s, and opening a Cartesia socket takes about 0.5 s.

### Troop designer

- Model `claude-haiku-5-5`: faster, about 20× cheaper than Sonnet, and just as consistent. Settings: effort `low`, thinking disabled, structured output via `output_config.format` with the JSON schema, `max_tokens` 400, description wrapped in `<description>` tags.
- Consistency passed: every description gave a cost spread of 1 elixir or less over 5 runs. "Tiny" is always cheaper. "Giant" is pricier for the wizard, but equal for the golem (the prompt caps giants at big-tank strength).
- Abuse passed with caveats: no crashes or invalid JSON, nothing over 10 elixir, and injection, gibberish, empty input and "cancel" all give a weak "Confused Blob".
- `voice_style` values: `gruff_warrior`, `squeaky_critter`, `mystic_whisper`, `booming_giant`, `robotic`, `cheerful_hero`.

### Pricing and anchors

Formula and K = 95 are in [SPEC.md](SPEC.md#pricing). The 10 anchors now live in `shared/anchors.ts` (the original 7, with the swarm fixed, plus a cheap skirmisher, a ranged pair and a fast tank). `npm test` fails if a stat change moves an anchor's cost.

| Anchor | health | damage | atk/s | move | range | count | Cost |
|---|---|---|---|---|---|---|---|
| Goblin Scrapper | 300 | 90 | 1.1 | 1.5 | 1 | 1 | 2 |
| Bee Swarm | 50 | 18 | 1.2 | 1.6 | 1 | 8 | 3 |
| Shield Knight | 900 | 110 | 0.8 | 0.8 | 1 | 1 | 3 |
| Twin Archers | 200 | 70 | 1.0 | 1.0 | 5 | 2 | 3 |
| Fire Wizard | 380 | 260 | 0.8 | 0.9 | 5 | 1 | 4 |
| Shadow Ninja | 360 | 230 | 1.3 | 1.9 | 1 | 1 | 4 |
| Bomb Lobber | 650 | 300 | 0.7 | 0.8 | 4 | 1 | 5 |
| Iron Charger | 1100 | 180 | 0.8 | 1.6 | 1 | 1 | 5 |
| Rooftop Sniper | 220 | 600 | 1.6 | 1.0 | 5 | 1 | 6 |
| Stone Golem | 3000 | 300 | 0.6 | 0.5 | 1 | 1 | 7 |

Towers (first pass): 2400 health, 60 damage per second, range 6, so no troop outranges them. A lone golem can take a side tower but not the middle one, which all three towers cover. Lone small troops die without much tower damage.

Clamps don't bound cost: all-max stats price at about 477 elixir and all-min at 0, hence the floor of 1.

### Voice (Cartesia)

- STT: websocket, model `ink-2`, 16 kHz `pcm_s16le`. On release send `finalize` and wait for `flush_done`. Keep one spare socket pre-opened and swap in a fresh one after each use.
- TTS: one warm websocket for the whole match, model `sonic-3.6`, raw `pcm_s16le` at 24 kHz, many cries multiplexed by `context_id`.
- API version header `2026-08-14`.
- Voice per style: gruff_warrior → Darius `23112795-d54e-4560-9568-791a87c30201`, squeaky_critter → Lulu `e13cae5c-ec59-4f71-b0a6-266df3c9bb8e`, mystic_whisper → Alaric `87748186-23bb-4158-a1eb-332911b0b708`, booming_giant → Damon `dbfa416f-d5c3-4006-854b-235ef6bdf4fd`, robotic → Daniel `47c38ca4-5f35-497b-b1a3-415245fb35e1`, cheerful_hero → Zander `afb19d1b-4044-4f34-a962-f4aef640a002`.

### Art

- fal FLUX.1 schnell at 384 px, 4 steps, on a flat magenta `#FF00FF` background. Put the troop description first in the prompt, then the shared style.
- Style prompt so far: "Single game unit, full body, centered, chunky stylised 3D mobile-game art, bold silhouette, bright saturated colours, soft studio lighting, no text, no signature, no watermark, no border".
- Background removal: fal BiRefNet v2 with a 3 s timeout. If it fails, key the background in the browser by sampling the border colour and flood-filling from the edges. Plain magenta chroma-key ate pink and purple troops in testing.
- Fetch generated images server-side and pass them on as data URIs, so the canvas isn't tainted by a cross-origin image.
- This differs from the spec (256 px, magenta chroma-key in the browser). Spec to be updated.

### Hand tracking and input

- MediaPipe Tasks Vision 0.10.14 in VIDEO mode, one hand, GPU delegate with CPU fallback. Now that the fist gesture is dropped, the plain `HandLandmarker` is enough.
- Pointer: index knuckle (landmark 5), mirrored. Smoothed with a One Euro filter (min cutoff 1.0, beta 0.007).
- Camera → screen mapping: a 4-point calibration fit as a homography. Uncalibrated, the middle of the camera frame acts as a touchpad.
- Pinch: distance from thumb tip (4) to the middle finger's last segment (11–12), divided by hand size (the larger of wrist → middle knuckle, and palm width ÷ 0.8). Hysteresis: on below 0.45, off above 0.65. A 7-second calibration picks the 2D or 3D measure and sets both thresholds.
- Judge the lock and the release position from the cursor about 100 ms earlier, so the release flick doesn't count as a drag.
- Drag-off cancel radius 150 px; losing the hand for over 250 ms cancels.
- Voice click: mic level above −45 dB for 60 ms starts speech and locks at the cursor from when the sound began. 500 ms of quiet ends it.

### SpacetimeDB (2.13, TypeScript module)

- Observed a steady 20.0 Hz tick and 7–9 ms deploy round trip on a local server.
- Interval timer rows are not deleted automatically: the tick must delete its own row when the match ends.
- Scheduled reducers can be called by clients too. Guard the tick with `ctx.sender.equals(ctx.databaseIdentity)`.
- Two tabs in the same browser share a localStorage token (same identity). Store the token in sessionStorage to get two players.
- Inside reducers, `ctx.random` and `ctx.timestamp` are the only randomness and clock.
- The local server listens on all interfaces, so a laptop on the venue LAN can be the fallback server if Maincloud is unreachable.

## Prep checklist status

| Item | Status |
|---|---|
| Hand tracking and pinch lock prototype | Done |
| Samson Q2U mic | ? Confirm |
| API keys: Anthropic, Cartesia, fal; SpacetimeDB CLI | Done |
| SpacetimeDB quickstart + rooms spike | Done locally; Maincloud and two-machine test ? Confirm |
| Latency benchmarks | Done (STT, Claude, TTS, FLUX schnell); other image models not compared |
| Shared art style prompt | Draft exists; "5 troops look like one game" not confirmed |
| 10 anchor troops + cost formula | 7 of 10 anchors; formula done |
| Game name | Open |
| Packing list | ? Confirm |
| SpacetimeDB workshop, sponsor booths, track criteria | ? Confirm |

| Prep test | Result |
|---|---|
| 1 Latency | Pass with Haiku (2.21 s p90) |
| 2 Consistency | Pass |
| 3 Abuse | Pass with caveats (see Known issues) |
| 4 Art style | Not confirmed |
| 5 Background removal | Done: BiRefNet v2, border-sample key as fallback |
| 6 STT in hall noise | On site |
| 7 Troop voices | Voices mapped; check they're distinct on site |

## Known issues to fix while building

- Prompt changes for "god" (capped at mini-tank or caster strength), "1000 ants" (same count as the bee swarm), Pikachu (no character name or catchphrase in the cry) and varied blob names are written but not yet tested against the API.
- Battle cries are trimmed to 8 words in code (`sanitizeDesign`).
- There's no splash stat yet, so the bomber is now "Bomb Lobber", a plain heavy ranged unit. Add a `splash` field if we want area damage.
- Swarms deployed next to your own tower overlap it visually; harmless.
- Voice "cancel" can lose the race with the 500 ms quiet timer; try 700 ms.

## Decisions log

| Date | Decision |
|---|---|
| 2026-10-22 | Spec v2. "Clash Royell" retired as the working title. |
| 2026-10-23 | Troop designer: Claude Haiku 5.5 with structured JSON output. |
| 2026-10-23 | Speech: Cartesia STT `ink-2`, TTS `sonic-3.6`, six voice styles. |
| 2026-10-23 | Art: fal FLUX.1 schnell 384 px + BiRefNet v2, border-sample key fallback. |
| 2026-10-23 | Combat runs fully on SpacetimeDB (TypeScript, 20 Hz). Rooms are built first. |
| 2026-10-23 | Controls: knuckle aim, thumb + middle pinch or speech to lock, drag-off cancel. Fist gesture dropped. |
| 2026-10-23 | Pricing draft K = 95 kept; tune from playtests at the event. |
| 2026-10-24 | Build repo set up, with `meta/` for the spec and this log. |
| 2026-10-24 | Combat runs in the server tick from phase 1, not phase 4. |
| 2026-10-24 | Deploys are two calls: `begin_deploy` locks the spot and starts the 2.5 s clock, `deploy_troop` sends the stats. |
| 2026-10-24 | Three towers a side, one per lane; units walk straight at the nearest enemy tower unless an enemy unit is within 5.5 tiles. |
| 2026-10-24 | Anchors expanded to 10; tower damage 60/s, range 6 (first pass). |

## Open questions

The full list is in [SPEC.md](SPEC.md#open-questions). Still open now:

- Over-10 troops: reject and show the cost (the spec), or scale health and damage down by 10/cost so it fits, which adds no latency.
- What the opponent sees of a pending deploy.
- Anthropic, SpacetimeDB and Supercell track criteria.
- Game name, and who presents.
