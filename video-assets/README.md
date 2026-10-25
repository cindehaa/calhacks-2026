# Demo video assets

Everything generated for the 3:00 demo video, in one place to cut from. It follows the story beats doc (cold open, duel, title card, montage, URL, end card). The look and sound come from the game itself (`meta/aesthetics.md`): frozen night, firelight gold, Cinzel type, faceted stone slabs, embers and ice.

Footage we film or screen-record ourselves (faces, the duel from both laptops, the drone shot, the result screen) isn't here yet.

## Cue sheet

| Beat | Time | Asset |
|---|---|---|
| 1.1 Cold open, drone shot | 0:00 | `music/cold_open.mp3` under it. Narrator `narrator/open_a.*.wav` ("Are you up for a battle of creativity?"), or `open_b` / `open_c` |
| 1.2–1.3 Team banners | 0:04 | `graphics/out/banner-sun.mp4` (Isaac, red) and `banner-raven.mp4` (Cindy, blue). Alpha versions: `banner-*-alpha.mov`. Swoosh into each face: `sfx/swoosh_1..3.mp3`, `sfx/banner_flap.mp3` |
| 1.4 Countdown | 0:08 | The game's own 3-2-1-FIGHT!, or `narrator/countdown.*.wav` with `graphics/out/callout-start.mov` |
| 2.1 Match starts | 0:10 | `game-audio/music/battle.mp3` under the callouts; `game-audio/announcer/match_start.mp3` |
| 2.2 Aim | 0:14 | `callout-aim.mov` + `narrator/aim.*.wav` + `sfx/callout_stamp_*.mp3` |
| 2.3 Imagine it | 0:20 | `callout-imagine.mov` + `narrator/imagine_a.*.wav` (alternates `imagine_b`, `imagine_c`) + `credit-cartesia.mov` |
| 2.4 Deploy | 0:26 | `callout-deploy.mov` + `narrator/deploy_a.*.wav` (alt `deploy_b`); `game-audio/sfx/deploy_pending.mp3` |
| 2.5 Troop generated | 0:30 | `stats-knight.mov` (sprite, stats and quirks pop in, then "designed by Claude") + `credit-claude.mov` if you want it separate. `sfx/slowmo_boom.mp3` |
| 2.6 Cost | 0:38 | `callout-cost.mov` + `narrator/cost.*.wav` + `sfx/cost_reel.mp3` |
| 2.7 The reply | 0:42 | Optional `callout-live.mov` + `narrator/live.*.wav` + `credit-spacetimedb.mov` |
| 2.8 The turn | 0:52 | `music/turn_drone.mp3`, `sfx/heartbeat.mp3` |
| 2.9 Escalation | 1:00 | `music/escalation_build_1.mp3` or `_2` (46 s, builds to a climax at its end; trim its start so the climax hits 1:42). Captions: `graphics/out/stills/caption-*.png`. B-roll: `broll/taylor-swift.mp4`, `broll/skibidi.mp4` |
| 2.10 The peak | 1:38 | `broll/titan.mp4`, `stats-titan.mov` |
| 2.11 The drop | 1:42 | Hard cut to silence. `sfx/meow_1..4.mp3`, `caption-innocent-whisper.png`, `broll/cat.mp4`, `stats-cat.mov` |
| 2.12–2.13 Towers fall, result | 1:44 | Screen recording; `game-audio/sfx/tower_destroyed.mp3`, `game-audio/sfx/defeat.mp3` |
| 3 Title card | 1:50 | Meow over black, `sfx/riser_1..2.mp3` ramps up, `graphics/out/title.mp4` lands at its peak (t = 0 is the slam) with `sfx/title_slam.mp3`. A beat of silence, then the hype track |
| 4 Montage | 1:55 | `music/hype_track_1.mp3` or `_2` (62 s, opens on the drop). Duck it under people talking |
| 5 URL reveal | 2:40 | `graphics/out/url.mov` over the montage + `sfx/url_shimmer.mp3` |
| 6 End card | 2:50 | `graphics/out/endcard.mp4` (10 s), "Just a hackathon project." lands at 5 s. `game-audio/music/menu.mp3` fits under it |
| Grade | all | `grade/artifice-frost-fire.cube` on the gameplay and the face footage |

## What's in each folder

- **`narrator/`**: Cartesia sonic-3.6, every line in two voices: `sterling` (deep, commanding) and `damon` (deep, documentary gravitas). `narrator/audition/` has the opening line in four more voices (darius, mark, clint, harlan). WAV, normalised to -16 LUFS.
- **`music/`**: ElevenLabs music via fal. `cold_open` (14 s), `turn_drone` (12 s), `escalation_build_1/2` (46 s), `hype_track_1/2` (62 s). Two takes of the long ones; pick by ear.
- **`sfx/`**: ElevenLabs sound effects via fal: swooshes, banner flap, callout stamps, risers, title slam, slow-mo boom, heartbeat, cost reel, URL shimmer and four meows.
- **`game-audio/`**: copied untouched from `client/public/audio`: the menu, battle and overtime music, match sounds and announcer lines.
- **`troops/`**: every troop in the duel script, designed and drawn by the live game's own API (`/api/troop`, `/api/sprite`): the design JSON (stats, quirks, cost, model) and the sprite PNG. The sprite API caches by the words said, so saying the same line in the game shows the same art.
- **`broll/`**: 5 s clips of Taylor Swift, Skibidi Toilet, the titan and the cat charging the tower; cut 1–2 s from each. Each started from the troop's real sprite, placed into a frame of the live arena (`broll/plates/`) by nano-banana, then animated by Kling 2.5. `*.still.png` is the first frame. `plates/arena-home.png` is a clean, HUD-free still of the home camera.
- **`graphics/out/`**: callouts, credits, stats cards, banners, title, URL (ProRes 4444 `.mov` with alpha) and the full-frame title and end card (`.mp4`). `stills/` has a PNG of every graphic, plus the duel captions. The `.mov` files aren't in git (they're large); run `npm run graphics` to make them.
- **`grade/`**: the colour grade LUT.

## Making more

From `video-assets/` (run `npm install` once). Keys come from the repo's `.env`.

```bash
npm run audio            # narrator, music, sfx; skips files that exist
npm run audio -- --only narrator/open --force   # re-roll some
npm run troops           # design + draw the duel troops through the live API
npm run broll -- --only cat --force
npm run graphics         # every graphic; --only callout,stats  --stills for PNGs only
```

- Edit narrator lines, music and SFX prompts at the top of `scripts/audio.mjs`.
- Edit the duel lines in `scripts/troops.mjs`, the B-roll actions in `scripts/broll.mjs`.
- Graphics are HTML pages in `graphics/src/` that draw themselves as a function of time; the job list (text, which troop, names on the banners) is at the top of `scripts/render.mjs`. Open a page in a browser to preview it at its start; add `?text=...` and so on.
- After the real duel is recorded, replace `troops/*.json` with the logged designs (`npm run logs -- --jsonl` in the repo root), so the stats cards match what was on screen, then `npm run graphics -- --only stats`.

## Before filming

- **The titan costs 17 embers.** The game refuses anything over 15 (`MAX_COST`, `shared/troop.ts`), so as written the climax gets refused. Options: test the line in the game until it prices at 15 or below, shorten it, or lean into it (it's refused, and the cat wins).
- **The primary `FAL_KEY` is out of balance.** Everything here ran on `FAL_KEY_FALLBACK`; the live game falls back the same way, a little slower. Top up the first account before filming.
- Team names on the banners are just "Cindy" and "Isaac" with Blue side / Red side, since the brainstorm's team names are still open. Change them in `scripts/render.mjs`.
