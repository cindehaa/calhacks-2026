# Progress

Running log of where we stand against [SPEC.md](SPEC.md). Newest status at the top, decisions dated at the bottom. Update it whenever something lands, changes or gets cut.

**Last updated:** 2026-10-24 (late night) · **Submission:** Devpost, 9:00 AM PT Sat Oct 25 (aim for 7:00 AM) · **Feature freeze:** about 6:00 AM Oct 25

## Where we are

**Phase 1 is scaffolded and running locally.** Two browsers can join a room, start a 90 s match and fight with the 10 anchor troops. Combat runs on the SpacetimeDB server at 20 Hz from the start. Typed descriptions go through Claude and deploy, so part of phase 2 is in too. The Claude call has not been run with a real key yet. Cartesia STT, battle cries and fal sprites are in and were checked with real keys in headless browsers; not yet with a real mic. See [README.md](../README.md) for how to run it.

## Build plan status

| Phase | Person A: game + multiplayer | Person B: AI + input | Status |
|---|---|---|---|
| 1 | SpacetimeDB rooms; arena, lanes, towers, elixir, hardcoded troops fighting in a shared `step()` | Troop designer: text in, JSON stats out; cost formula; anchors | **Done locally**; needs a real-key test and a two-laptop test |
| 2 | Hook designer up via a text box | Cartesia STT with push-to-talk | **Done**; STT checked with a generated clip, not a real mic |
| 3 | Code animations, silhouette placeholder, headless sim | Hand tracking, lock, drag-off cancel, voice click | Not started |
| 4 | Interpolation, rematch, demo room (server tick moved to phase 1) | Sprite gen, background removal, cache, anchor art, TTS cries | Interpolation, rematch, demo room done early; sprites, removal, cache and TTS cries done; anchor art is drawn on first use, not at startup |
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
- [x] Bot mode: **Play vs Bot** (easy / normal / hard) runs the whole match in the browser on the same `step()` and deploy rules (`shared/deploy.ts`, now also used by the server), with no SpacetimeDB at all, so it's the demo fallback when the network fails. `client/src/match.ts` gives `main.ts` one `MatchSource` for online rooms and `LocalMatch`. The bot (`shared/bot.ts`) defends real threats near the threatened tower, otherwise pushes your weakest tower's lane, and sometimes saves for a big troop. Its drops show a lock and countdown like a real opponent's.
- [x] Cartesia STT behind `SpeechSource` (`client/src/input/cartesia_stt.ts`): the mic is resampled to 16 kHz `pcm_s16le` in an AudioWorklet and streamed in 100 ms chunks to an `ink-2` socket while the mic is on. A deploy sends `finalize`, waits for `flush_done` (600 ms cap) and swaps in the spare socket, which is opened ahead of time; quiet after speech does the same, so each utterance starts clean. The browser opens the socket straight to Cartesia with a 60 s token from `POST /api/voice-token`, so the key stays in `api/` and no audio goes through the proxy. No key, no token or two failed connects switches to the browser recogniser. Pinch push-to-talk, voice click and designing on the partial transcript work as before. Checked in headless Chrome with a Cartesia-generated clip as the fake mic: voice lock, words arriving one by one, finalize → `flush_done` → swap, design and deploy; and the fallback with the token route returning 503.
- [x] Battle cries (`client/src/cries.ts`): a troop's `battle_cry` is spoken in its `voice_style`'s voice when it lands, over one TTS socket per match (`sonic-3.6`, raw `pcm_s16le` at 24 kHz, one `context_id` per cry), opened at match start with the STT sockets. Cut to 8 words; a cry that would overlap one still playing is dropped; muted means no cries and no TTS calls. Online you hear only your own troops (the other laptop plays theirs), vs Bot both sides. Measured 0.2–0.3 s from request to the last audio chunk.
- [x] Sprites (`api/sprites.ts`, `client/src/sprites.ts`): FLUX.1 schnell 384 px, 4 steps, description first then the shared style on magenta, then BiRefNet v2 with a 3 s timeout, about 3 s in all. The PNG is cached in `.cache/sprites/` by a hash of the normalised description and served at `/api/sprite/<id>.png` with CORS headers, so `spriteUrl` stays short and the canvas loads it with `crossOrigin = "anonymous"` without tainting. If removal fails the URL ends in `?key` and the browser keys it itself (`client/src/chroma.ts`: median border colour, flood fill from the edges, 4 tests). Art starts with the designer, or on the partial transcript (3 words settled 500 ms), goes in with the deploy if it's ready and through `set_troop_sprite` if not. Bot matches get art for both sides. Checked with two headless tabs: the sprite reached the troop row and both tabs loaded it.
- [x] Core loop feel, matched to the prep playground (2026-10-24 night): with the camera on, the pinch is push to talk. Audio reaches Cartesia only while it's held (plus 300 ms from just before), and letting go finalises at once, with no quiet timer; voice click stays as an option (`⋯` → "Voice click with camera") and is still the default without a camera. With the mic on, holding the mouse button works like a pinch (drag off to cancel); a quick empty click still picks the typing spot. After you let go, the drop shows your words, "designing…" and a pulsing silhouette at the spot until the stats land and the troop appears. `T` (or `?timings`) shows per-drop timings: hold, release → final words, release → stats, release → art. The designer warms at page load. Mic level analyser now feeds a muted sink, so the meter and voice click read in headless Chrome too. 12 new tests (`drops.test.ts`, `ptt.test.ts`, mouse cases in `lock.test.ts`). Checked in headless Chrome with a Cartesia-generated clip and a fake camera, in a bot match and a two-tab room: release → final words about 180 ms, release → stats 1.0–3.4 s (all of the spread is Claude), the troop lands at the pressed spot, the opponent's INCOMING marker sits at the same spot mirrored, and an idle STT socket survived 49 s between holds. Not checked with a real webcam or mic.
- [x] Game feel: emoji-on-disc placeholder tokens (size by sqrt of health), walk bob, melee lunge, ranged and tower projectiles, hit flash and damage numbers, death poofs, landing rings, tower crumble with shake, 3-2-1 / FIGHT and DOUBLE ELIXIR banners, cost pills and non-overlapping name labels, INCOMING marker for the opponent's drop, synthesized sound effects (M or the speaker button mutes), and a first-time how-to-play card (reopen with `?`). Code in `client/src/{fx,tokens,sfx,tutorial}.ts` and `render.ts`.
- [x] Troop quirks and attack motion (2026-10-24 late night): designs now carry `attack` (single, splash, breath, chain), `targets`, `on_hit` (burn, slow, stun), `windup`, `trait` (flying, shield, spawner, death_burst, heal_aura, charge) and a look (`motion`, `element`, `flavor`). All of it runs in the shared `step()` with fixed numbers from the spec, so server and bot matches agree; spawner minions become unit rows under their spawner's troop. Motion layer 1 animates each strike by `motion` and `element`; layer 2 swaps in a generated pose frame (`api/poses.ts`) around each predicted hit. Status visuals: flames, slow tint, shield ring, stun stars, charge dust, heal pulse, spawn puff, death explosion, with new `boom`, `puff` and `stun` sounds. 116 tests and a 90 s headless sim with every trait and on-hit pass. Not yet seen in a browser. Quirk multipliers are untuned: Storm Wizard and Fire Dragon play like cost 8.7 against prices of 6 and 7. The server needs `npm run db:publish` and `db:reset` for the new columns.

## Next up

**Waiting on keys**
- [ ] Run `npm run bench` with Anthropic + Gemini + Cerebras keys (Groq optional) and pick the designer: stay on Claude unless another backend is clearly faster at similar judgement. Then set `DESIGNER` or add a race.
- [ ] `ANTHROPIC_API_KEY` in `.env`: run the 30 test descriptions through `/api/troop` and check the prompt fixes ("god", "1000 ants", Pikachu, blob names). Without a key the offline designer is used.

**Can do now**
- [ ] Manual testing of troop quirks, status visuals and the pose-frame swap in a bot match and a two-tab room.
- [ ] Balance tuning of quirk multipliers (`npm run balance`); Storm Wizard and Fire Dragon are underpriced.
- [ ] Re-run `npm run bench`: the designer JSON is larger now with the quirk and look fields.
- [ ] Real-webcam test of hand tracking and calibration; two laptops on one network or Maincloud.
- [ ] Real-mic test of Cartesia STT (prep test 6, hall noise) and listen to the six cry voices on speakers (prep test 7).
- [ ] Pre-draw the 10 anchors' art (`curl` each description to `/api/sprite` once, or at api start) so the first bot match isn't bare. About $0.03.
- [ ] Optional `?bot` URL to jump straight into a bot match at the judging table.

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
- With voice click on (no camera, or ticked in `⋯`), Cartesia STT streams the whole time the mic is on, so turn the mic off between matches to save minutes. With the camera on, it only streams while a pinch or mouse press is held.
- Release → stats can pass 2.5 s when Claude is slow (3.4 s seen once in four runs). The early design only helps when the final words match a partial, and Cartesia often sends the last words only on `finalize`, so most voice drops pay a full designer call after release.
- Sprites are served by the api that drew them. Two laptops on one Vite server share it; with each laptop running its own api (Maincloud), you see your opponent's placeholder instead of their art.
- How long Cartesia keeps an idle spare STT socket open isn't documented. A closed one is replaced the next time it's needed, which costs one ~0.5 s connect.

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
| 2026-10-24 | 3 s pre-match countdown on the server and in bot matches: no deploys or elixir until "Fight!". |
| 2026-10-24 | Sound on by default (M mutes). Voice listening is always on while the mic is on; pinching mid-sentence makes it push-to-talk. |
| 2026-10-24 | Players never pick swarm size: the designer sets count from the creature (small swarmers 8, medium 3–5, big 2–3). Dragon = heavy ranged. |
| 2026-10-24 | Claude call: 4.5 s timeout, no retries, offline designer as fallback. Bot opponent is local only (browser), never on the server. |
| 2026-10-24 | Balance fixes from the sim: range charged per tile (+0.2 per tile above 1), no speed charge; Sniper, Goblin and Knight retuned. Starter costs: Goblin 2, Bees 3, Knight 3, Ninja 3, Charger 4, Archers 5, Wizard 6, Sniper 6, Lobber 7, Golem 8. |
| 2026-10-24 | Designs start on the partial transcript (reused if the final words match); the Claude prompt is cached. Designer backend is switchable (`DESIGNER`), pending `npm run bench` with real keys. |
| 2026-10-24 | Cartesia keys stay in `api/`, which mints 60 s access tokens; the browser opens the STT and TTS sockets to Cartesia itself. Simpler than proxying audio through `api/`. |
| 2026-10-24 | Sprites are cached as PNG files by `api/` and served at a short URL instead of a data URI, which doesn't fit the 2048-char `spriteUrl`. The browser keys the background only when BiRefNet times out. |
| 2026-10-24 | Online, you hear only your own troops' battle cries; vs Bot, both sides. Muted means no TTS calls. |
| 2026-10-24 | With the camera on, the pinch (or a mouse hold) is push to talk and talking alone doesn't lock; voice click is opt-in there. Open mic locked on anything said near the laptop. Cost still shows only on landing, and cries still play on landing, unlike the playground. |

## Open questions

The full list is in [SPEC.md](SPEC.md#open-questions). Still open now:

- Over-10 troops: reject and show the cost (the spec), or scale health and damage down by 10/cost so it fits, which adds no latency.
- What the opponent sees of a pending deploy.
- Anthropic, SpacetimeDB and Supercell track criteria.
- Game name, and who presents.
