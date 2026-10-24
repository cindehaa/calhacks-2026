# Progress

Running log of where we stand against [SPEC.md](SPEC.md). Newest status at the top, decisions dated at the bottom. Update it whenever something lands, changes or gets cut.

**Last updated:** 2026-10-24 (about 3 AM) · **Submission:** Devpost, 9:00 AM PT Sun Oct 25 (aim for 7:00 AM) · **Feature freeze:** about 6:00 AM Sun Oct 25

**Team plan:** soft deadline 12 PM Sat Oct 24 for the build. After that, playtest with people, gather their feedback and iterate on it, and record a montage video of people playing for the submission.

## Where we are

**The core loop is in on `main`, ahead of the noon soft deadline.** Two players (or one against the bot) fight on the Clash Royale-style arena in the 3D view, behind a home hub with a versus intro, pause and forfeit. You point with your hand (or the mouse), pinch to lock and talk while you hold: Cartesia STT turns the words into a description, Claude designs and prices the troop inside the 2.5 s deploy delay, and fal draws its art. Troops carry quirks (attack shapes, on-hit effects, traits, spawners) that run in the shared `step()` and show in the 3D view. Rounds are logged for tuning. Everything has been checked in headless Chrome with real keys, a generated speech clip and a fake camera; not yet with a real webcam and mic, or on two laptops. See [README.md](../README.md) for how to run it, and the Vercel deploy from `main`.

## Build plan status

| Phase | Person A: game + multiplayer | Person B: AI + input | Status |
|---|---|---|---|
| 1 | SpacetimeDB rooms; arena, river and bridges, towers, elixir, hardcoded troops fighting in a shared `step()` | Troop designer: text in, JSON stats out; cost formula; anchors | **Done locally**; needs a real-key test and a two-laptop test |
| 2 | Hook designer up via a text box | Cartesia STT with push-to-talk | **Done**: STT via Cartesia `ink-2` with pinch push-to-talk; checked with a generated clip, not a real mic |
| 3 | Code animations, silhouette placeholder, headless sim | Hand tracking, lock, drag-off cancel, voice click | **Done**: attack motion, drop silhouette and balance sim; hand tracking with switchable schemes, lock, drag-off cancel, voice click |
| 4 | Interpolation, rematch, demo room (server tick moved to phase 1) | Sprite gen, background removal, cache, anchor art, TTS cries | **Done**: sprites (FLUX.1 schnell + BiRefNet, Isaac's pipeline), cache, anchor art drawn at api start, troop quirks and pose frames. TTS cries dropped 2026-10-24 |
| 5 | Polish, tutorial overlay, sound | Polish, Devpost writeup, backup video | In progress: home hub, tutorial card, sound pack and music, match logging done; playtesting, montage video and writeup to come |

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
- [x] Input: camera hand tracking (MediaPipe, index-knuckle cursor, One Euro smoothing, fixed touchpad mapping, thumb + middle pinch), pinch to lock, release to deploy, drag off the 150 px ring or lose the hand to cancel. Mic: loudness starts a voice lock, 700 ms quiet deploys, saying "cancel" cancels; the browser's speech recognition stands in for Cartesia behind a swappable interface. Camera and mic are opt-in from a top-left panel; mouse, keys and the text box still work. 34 tests on the pure parts; smoke-tested with a fake camera and mic, not yet with a real webcam.
- [x] Balance sim: `npm run balance` runs every troop against the anchors on the real `step()` (elixir-matched duels plus solo tower runs) and flags cost outliers. Knobs for K, pricing factors and tower stats; `--troops file.json` takes generated designs. Findings in [sim/README.md](../sim/README.md): range was underpriced and speed overpriced; the suggested tweaks have all been applied (see decisions).
- [x] Bot mode: **Play vs Bot** (easy / normal / hard) runs the whole match in the browser on the same `step()` and deploy rules (`shared/deploy.ts`, now also used by the server), with no SpacetimeDB at all, so it's the demo fallback when the network fails. `client/src/match.ts` gives `main.ts` one `MatchSource` for online rooms and `LocalMatch`. The bot (`shared/bot.ts`) defends real threats near the threatened tower, otherwise pushes over the bridge in front of your weakest princess tower, and sometimes saves for a big troop. Its drops show a lock and countdown like a real opponent's.
- [x] Cartesia STT behind `SpeechSource` (`client/src/input/cartesia_stt.ts`): the mic is resampled to 16 kHz `pcm_s16le` in an AudioWorklet and streamed in 50 ms chunks to an `ink-2` socket while the mic is on. A deploy sends `finalize`, waits for `flush_done` (600 ms cap) and swaps in the spare socket, which is opened ahead of time; quiet after speech does the same, so each utterance starts clean. The browser opens the socket straight to Cartesia with a 60 s token from `POST /api/voice-token`, so the key stays in `api/` and no audio goes through the proxy. No key, no token or two failed connects switches to the browser recogniser. Pinch push-to-talk, voice click and designing on the partial transcript work as before. Checked in headless Chrome with a Cartesia-generated clip as the fake mic: voice lock, words arriving one by one, finalize → `flush_done` → swap, design and deploy; and the fallback with the token route returning 503.
- [x] ~~Battle cries~~ removed 2026-10-24 (too much noise; see decisions). Was (`client/src/cries.ts`): a troop's `battle_cry` is spoken in its `voice_style`'s voice when it lands, over one TTS socket per match (`sonic-3.6`, raw `pcm_s16le` at 24 kHz, one `context_id` per cry), opened at match start with the STT sockets. Cut to 8 words; a cry that would overlap one still playing is dropped; muted means no cries and no TTS calls. Online you hear only your own troops (the other laptop plays theirs), vs Bot both sides. Measured 0.2–0.3 s from request to the last audio chunk.
- [x] Sprites (`api/sprites.ts`, `client/src/sprites.ts`): FLUX.1 schnell 384 px, 4 steps, description first then the shared style on magenta, then BiRefNet v2 with a 3 s timeout, about 3 s in all. The PNG is cached in `.cache/sprites/` by a hash of the normalised description and served at `/api/sprite/<id>.png` with CORS headers, so `spriteUrl` stays short and the canvas loads it with `crossOrigin = "anonymous"` without tainting. If removal fails the URL ends in `?key` and the browser keys it itself (`client/src/chroma.ts`: median border colour, flood fill from the edges, 4 tests). Art starts with the designer, or on the partial transcript (3 words settled 500 ms), goes in with the deploy if it's ready and through `set_troop_sprite` if not. Bot matches get art for both sides. Checked with two headless tabs: the sprite reached the troop row and both tabs loaded it.
- [x] Core loop feel, matched to the prep playground (2026-10-24 night): with the camera on, the pinch is push to talk. Audio reaches Cartesia only while it's held (plus 300 ms from just before), and letting go finalises at once, with no quiet timer; voice click stays as an option (`⋯` → "Voice click with camera") and is still the default without a camera. With the mic on, holding the mouse button works like a pinch (drag off to cancel); a quick empty click still picks the typing spot. After you let go, the drop shows your words, "designing…" and a pulsing silhouette at the spot until the stats land and the troop appears. `T` (or `?timings`) shows per-drop timings: hold, release → final words, release → stats, release → art. The designer warms at page load. Mic level analyser now feeds a muted sink, so the meter and voice click read in headless Chrome too. 12 new tests (`drops.test.ts`, `ptt.test.ts`, mouse cases in `lock.test.ts`). Checked in headless Chrome with a Cartesia-generated clip and a fake camera, in a bot match and a two-tab room: release → final words about 180 ms, release → stats 1.0–3.4 s (all of the spread is Claude), the troop lands at the pressed spot, the opponent's INCOMING marker sits at the same spot mirrored, and an idle STT socket survived 49 s between holds. Not checked with a real webcam or mic.
- [x] Game feel: emoji-on-disc placeholder tokens (size by sqrt of health), walk bob, melee lunge, ranged and tower projectiles, hit flash and damage numbers, death poofs, landing rings, tower crumble with shake, 3-2-1 / FIGHT and DOUBLE ELIXIR banners, cost pills and non-overlapping name labels, INCOMING marker for the opponent's drop, synthesized sound effects (M or the speaker button mutes), and a first-time how-to-play card (reopen with `?`). Code in `client/src/{fx,tokens,sfx,tutorial}.ts` and `render.ts`.
- [x] Troop quirks and attack motion (2026-10-24 late night): designs now carry `attack` (single, splash, breath, chain), `targets`, `on_hit` (burn, slow, stun), `windup`, `trait` (flying, shield, spawner, death_burst, heal_aura, charge) and a look (`motion`, `element`, `flavor`). All of it runs in the shared `step()` with fixed numbers from the spec, so server and bot matches agree; spawner minions become unit rows under their spawner's troop. Motion layer 1 animates each strike by `motion` and `element`; layer 2 swaps in a generated pose frame (`api/poses.ts`) around each predicted hit. Status visuals: flames, slow tint, shield ring, stun stars, charge dust, heal pulse, spawn puff, death explosion, with new `boom`, `puff` and `stun` sounds. 116 tests and a 90 s headless sim with every trait and on-hit pass. Not yet seen in a browser. Quirk multipliers are untuned: Storm Wizard and Fire Dragon play like cost 8.7 against prices of 6 and 7. The new columns have defaults, so `npm run db:publish` adds them without `db:reset`.
- [x] Isaac's voice, sprites and troop quirks merged into `main` by Cindy (2026-10-24, about 2:35 AM): Cartesia STT with push to talk beside her hand schemes, Isaac's sprite pipeline (her border-colour keyer as the fallback), quirks and pose frames in the 3D view (the only view, starting on top of your king tower), and `step()` reporting hits for her troop logs.
- [x] Follow-ups to that merge (2026-10-24, about 3 AM): the quirk columns on `troop` and `unit` have defaults, so publishing over a database from before quirks (Maincloud, if it was published earlier) no longer needs `--delete-data` and keeps the play logs; checked on the local server, where the same module without defaults was refused. The setup screen's "say hello" check streams without a pinch, since push to talk otherwise held it back with the camera on. A quick click that only picks a typing spot is no longer logged as a cancelled deploy.
- [x] POV troops and voice fix (2026-10-24): the 3D view (`client/src/pov.ts`) now draws sprites with attack poses, the shared attack motion from `fx.ts`, quirk status effects, labels, HP bars and pending drops; the view button is labelled and the how-to card mentions V. Voice: Space no longer types into an empty description box during a match, setup continues with mic only, and a hint under the box says how to talk a troop in. Checked headless with Space, mouse hold, no camera and camera push-to-talk. 114 tests pass.
- [x] Overnight cleanup (2026-10-24, branch `cleanup/overnight`): removed the 2D board's leftover drawing code and other dead code; one shared `normalise()`, sprite keyer and api art cache; the 3D board no longer renders behind the opaque title, home and result screens; `OnlineMatch` stops rescanning the player table (the SpacetimeDB client's `find()` is a full scan) dozens of times a frame; Claude no longer writes battle cries (about 0.1 s off every design); the balance sim rates buildings-only troops by tower runs only. Checked with tests, typecheck, a bot match and a two-tab online room on a local server.
- [x] Warmth-and-frost sound pass (2026-10-24): menu, battle and overtime music regenerated with a crackling fireplace under wintry instruments, and the 11 match sounds and arena ambience redone with snow, ice, wind, embers and braziers (`tools/audio/prompts.mjs`). Troop sound sets unchanged. The vision lives in [aesthetics.md](aesthetics.md). Not yet listened to in game.

## Next up

**Waiting on keys**
- [ ] Run `npm run bench` with Anthropic + Gemini + Cerebras keys (Groq optional) and pick the designer: stay on Claude unless another backend is clearly faster at similar judgement. Then set `DESIGNER` or add a race.
- [ ] Fix the two prompt rules Claude still misses (checked 2026-10-24 night with `npm run bench` and three calls each): "a god that kills everything instantly" comes back golem-strength (cost 8–15, the rule says mini-tank or caster), and "an army of 50 giants" is always three giants at cost 13–15, which the game refuses. "1000 ants" (an 8-ant swarm, cost 3), Pikachu and injection pass.

**Can do now**
- [ ] Deploy: publish the module to Maincloud (`spacetime publish --module-path server --server maincloud calhacks-arena -y`; no `--delete-data` needed now), make sure `CARTESIA_API_KEY` and `FAL_KEY` are set in Vercel, and check the production site plays with voice and art from two machines.
- [ ] Real-webcam and real-mic test on two laptops on one network or Maincloud: hand tracking (no calibration step now), Cartesia STT in hall noise (prep test 6), push to talk.
- [ ] Playtest with people from 12 PM: gather feedback, iterate, and record the montage video.
- [ ] Manual testing of troop quirks, status visuals and the pose-frame swap in a bot match and a two-tab room.
- [ ] Balance tuning of quirk multipliers (`npm run balance`): the Sniper, Storm Wizard, Fire Wizard and Fire Dragon play like cost 8–9 (see [sim/README.md](../sim/README.md)).
- [ ] Re-run `npm run bench` with other providers' keys; Claude alone (2026-10-24 night): cold 2.4 s, p50 1.41 s, p90 1.69 s, max 3.1 s, 7 of 9 checks.
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

Formula and K = 95 are in [SPEC.md](SPEC.md#pricing). The table below is the prep version: the anchors have since been retuned and five quirked ones added (15 in all, `shared/anchors.ts`), range is now charged per tile and speed is free. Current costs and balance are in [sim/README.md](../sim/README.md). `npm test` fails if a stat change moves an anchor's cost.

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
- TTS (unused since the battle cries were dropped on 2026-10-24): one warm websocket for the whole match, model `sonic-3.6`, raw `pcm_s16le` at 24 kHz, many cries multiplexed by `context_id`.
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
- Camera → screen mapping: fixed; the middle of the camera frame acts as a touchpad. Manual calibration (follow-the-dot and pinch) was removed on Oct 23.
- Pinch: distance from thumb tip (4) to the middle finger's last segment (11–12), divided by hand size (the larger of wrist → middle knuckle, and palm width ÷ 0.8). Hysteresis: on below 0.45, off above 0.65, image-space (2D) measure.
- Judge the lock and the release position from the cursor about 100 ms earlier, so the release flick doesn't count as a drag.
- Drag-off cancel radius 150 px; losing the hand for over 250 ms cancels.
- Voice click: mic level above −45 dB for 60 ms starts speech and locks at the cursor from when the sound began. 700 ms of quiet ends it (500 ms in prep).

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
| 7 Troop voices | Dropped with the battle cries (2026-10-24) |

## Known issues to fix while building

- The "god" and "army of giants" prompt rules don't hold yet (see Next up). Blob-name variety isn't checked by the bench.
- Swarms deployed next to your own tower overlap it visually; harmless.
- Voice "cancel" can lose the race with the 500 ms quiet timer; try 700 ms.
- Cartesia STT streams the whole time the mic is on, so turn the mic off between matches to save minutes.
- The flick and fist thresholds (`FLICK_DEFAULTS` in `flick.ts`, `FIST_DEFAULTS` in `pose.ts`) are guesses from synthetic tests; tune them on a real webcam. The panel shows the finger extension and each flick's slip.
- Release → stats can pass 2.5 s when Claude is slow (3.4 s seen once in four runs). The early design only helps when the final words match a partial, and Cartesia often sends the last words only on `finalize`, so most voice drops pay a full designer call after release.
- Sprites are served by the api that drew them. Two laptops on one Vite server share it; with each laptop running its own api (Maincloud), you see your opponent's placeholder instead of their art. On Vercel the PNGs live in each function instance's `/tmp`, so a request that lands on a different instance from the one that drew the art may 404 and show the placeholder; fal's own CDN URLs would avoid that if it shows up in testing.
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
| 2026-10-24 | Controls cut to aim and fire: index fingertip aims, a wrist flick fires whatever was said since the last fire, a fist clears it. The mic always listens; Space or a click with words waiting fire without a camera. Replaces pinch-to-lock, drag-off cancel, push to talk and voice click. |
| 2026-10-24 | With the camera on, the pinch (or a mouse hold) is push to talk and talking alone doesn't lock; voice click is opt-in there. Open mic locked on anything said near the laptop. Cost still shows only on landing, and cries still play on landing, unlike the playground. |
| 2026-10-23 | Arena follows the Clash Royale layout instead of three lanes: a river with two bridges, a king tower (1.5× health, asleep until hit or a princess tower falls) behind two princess towers. Troops cross only on bridges. Drops go anywhere on your half; taking a princess tower opens that side of their half (the pocket). Killing the king wins outright. The `tower.lane` column now means 0/2 princess, 1 king, so no schema change. |
| 2026-10-23 | Merged the Clash Royale layout with troop quirks. Ground units path over the bridges; `trait: flying` units fly straight over the river and are never shoved back to a bank. Death bursts use each tower's own radius, so the bigger king counts. Manual calibration is gone (Cindy's newer touchpad mapping wins); push to talk, mouse hold and Cartesia STT sit beside Space/Esc and the setup screen. The mouse-hold lock follows the mouse-and-keyboard toggle. The `hit` sound stays removed. |
| 2026-10-24 | Battle cries cut: spoken lines on every landing added too much noise. Cartesia stays for speech-to-text only; `battle_cry` and `voice_style` are still in the design JSON but unused. TTS, `cries.ts` and the voice IDs are gone from the code. |
| 2026-10-24 | Isaac's sprite pipeline (FLUX.1 schnell, BiRefNet v2 with a 3 s timeout, border-colour key as the fallback, cached and served by `api/`) chosen over the `flux-2/klein` + browser chroma-key one, because the troop quirks and pose frames build on it. |
| 2026-10-24 | Aesthetic theme is warmth and frost, kept in `meta/aesthetics.md`. Music and match sounds follow it; troop sound sets stay literal to what the player describes. |
| 2026-10-24 | Claude no longer writes `battle_cry` or `voice_style` (unused since the cries were cut): `sanitizeDesign` fills them in, so tables and reducers are unchanged. Measured with `npm run bench` (Haiku, 40 rounds): p50 1.50 → 1.41 s, p90 2.12 → 1.69 s, judgement checks unchanged. |

## Open questions

The full list is in [SPEC.md](SPEC.md#open-questions). Still open now:

- Over-10 troops: reject and show the cost (the spec), or scale health and damage down by 10/cost so it fits, which adds no latency.
- What the opponent sees of a pending deploy.
- Anthropic, SpacetimeDB and Supercell track criteria.
- Game name, and who presents.
