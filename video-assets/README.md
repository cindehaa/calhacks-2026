# Demo video assets

Everything generated for the 3:00 demo video, in one place to cut from. It follows the story beats doc (cold open, duel, title card, montage, URL, end card). The look and sound come from the game itself (`meta/aesthetics.md`): frozen night, firelight gold, Cinzel type, faceted stone slabs, embers and ice.

The gameplay doesn't need screen-recording: the whole duel is rendered from the real game (film mode, below), from both players' screens, and cut into one clip per beat. What's left to film is people: see [FILMING.md](FILMING.md).

## Cue sheet

| Beat | Time | Asset |
|---|---|---|
| 1 Cold open, stitched | 0:00 | `film/out/cold-open.mp4` (13 s): drone, banners, face slates, countdown, with the line, its subtitle, the game's battle music and swooshes. `node scripts/coldopen.mjs --isaac <clip> --cindy <clip>` swaps the slates for the filmed intros |
| 1.1 Drone shot | 0:00 | `film/out/drone.mp4` (7 s). Narrator `narrator/1 cold open.m4a` + `graphics/out/subtitle-1-cold-open.mov` |
| 1.2–1.3 Team banners | 0:04 | `graphics/out/banner-sun.mp4` (Isaac, red) and `banner-raven.mp4` (Cindy, blue). Alpha versions: `banner-*-alpha.mov`. Swoosh into each face: `sfx/swoosh_1..3.mp3`, `sfx/banner_flap.mp3` |
| 1.4 Countdown | 0:08 | `film/out/clips/<view>/01-countdown.mp4`, the game's own 3-2-1-FIGHT! |
| 2.x The duel | 0:10 | `film/out/clips/cindy/` and `clips/isaac/`: one clip per beat, 02-match-start to 20-result, each with the game's sound. Full renders: `film/out/duel-<view>.mp4` + `.wav` |
| 2.1 Match starts | 0:10 | `game-audio/music/battle.mp3` under the callouts; `game-audio/announcer/match_start.mp3` |
| 2.2 Aim | 0:14 | `callout-aim.mov` + `narrator/2 aim.m4a` + `subtitle-2-aim.mov` + `sfx/callout_stamp_*.mp3` |
| 2.3 Imagine it | 0:20 | `callout-imagine.mov` + `narrator/3 imagine it.m4a` + `subtitle-3-imagine-it.mov` + `credit-cartesia.mov` |
| 2.4 Deploy | 0:26 | `callout-deploy.mov` + `narrator/4 deploy.m4a` + `subtitle-4-deploy.mov`; `game-audio/sfx/deploy_pending.mp3` |
| 2.5 Troop generated | 0:30 | `callout-stats.mov` + `narrator/5 troop generated.m4a` + `subtitle-5-troop-generated.mov`; `stats-knight.mov` (sprite, stats and quirks pop in, then "designed by Claude") + `credit-claude.mov` if you want it separate. `sfx/slowmo_boom.mp3` |
| 2.6 Cost | 0:38 | `callout-cost.mov` + `narrator/6 cost.m4a` + `subtitle-6-cost.mov` + `sfx/cost_reel.mp3` |
| 2.7 The reply | 0:42 | Optional `callout-live.mov` + `narrator/7 play live.m4a` + `subtitle-7-play-live.mov` + `credit-spacetimedb.mov` |
| 2.8 The turn | 0:52 | Drop the battle music out; `sfx/heartbeat.mp3` |
| 2.9 Escalation | 1:00 | `game-audio/music/battle.mp3` back in, then `game-audio/music/overtime.mp3` (the same theme at its climax) up to the cut to silence at 1:42. Captions: `graphics/out/stills/caption-*.png`. B-roll: `broll/taylor-swift.mp4`, `broll/skibidi.mp4` |
| 2.10 The peak | 1:38 | `broll/titan.mp4`, `stats-titan.mov` |
| 2.11 The drop | 1:42 | Hard cut to silence. `sfx/meow_1..4.mp3`, `caption-innocent-whisper.png`, `broll/cat.mp4`, `stats-cat.mov` |
| 2.12–2.13 Towers fall, result | 1:44 | Screen recording; `game-audio/sfx/tower_destroyed.mp3`, `game-audio/sfx/defeat.mp3` |
| 3 Title card | 1:50 | `film/out/title-sequence.mp4` (8.4 s, `scripts/titleseq.mjs`): black, `sfx/riser_1` climbs, `graphics/out/title.mp4` slams in at its peak on `sfx/title_hit_1.mp3`, a beat of silence, then the battle music at full strength (from 24 s into the track) |
| 4 Montage | 1:55 | `game-audio/music/battle.mp3` carrying on from the title sequence. Duck it under people talking |
| 5 URL reveal | 2:40 | `graphics/out/url.mov` over the montage + `sfx/url_shimmer.mp3` |
| 6 End card | 2:50 | `graphics/out/endcard.mp4` (10 s): black and minimal, built for Cal Hacks 13.0 by Isaac Ng and Cindy Li, powered by the Claude, Cartesia and SpacetimeDB logos |
| Grade | all | `grade/artifice-frost-fire.cube` on the gameplay and the face footage |

## What's in each folder

- **`narrator/`**: our own recorded lines, 1 to 7: "Welcome to the battle of creativity.", "Aim with your finger.", "If you can imagine it, you can summon it.", "Open your hand and watch it come to life.", "Every troop gets fair stats.", "The more powerful the troop, the more embers it costs.", "Play your friends live." Each has a matching word-by-word subtitle in `graphics/out/subtitle-*.mov`.
- **Music** is the game's own battle theme (`game-audio/music/battle.mp3`, and `overtime.mp3` for its climax). The generated tracks in `music/` and `music/candidates/` aren't used.
- **`sfx/`**: ElevenLabs sound effects via fal: swooshes, banner flap, callout stamps, risers, title slam, slow-mo boom, heartbeat, cost reel, URL shimmer and four meows.
- **`game-audio/`**: copied untouched from `client/public/audio`: the menu, battle and overtime music, match sounds and announcer lines.
- **`troops/`**: every troop in the duel script, designed and drawn by the live game's own API (`/api/troop`, `/api/sprite`): the design JSON (stats, quirks, cost, model) and the sprite PNG. The sprite API caches by the words said, so saying the same line in the game shows the same art.
- **`broll/`**: 5 s clips of Taylor Swift, Skibidi Toilet, the titan and the cat charging straight at the camera, as seen by someone standing in the arena; cut 1–2 s from each. Each started from the troop's real sprite, placed into a ground-level frame of the real arena (`broll/plates/ground-*.png`, from `scripts/plates.mjs`) by nano-banana, then animated by Kling 2.5. `*.still.png` is the first frame.
- **`film/`**: the duel as a script (`duel.mjs`) for the game's film mode, and its renders in `film/out/`: both full matches with their sound, the beat clips, the drone shot, cold open, title sequence, montage and rough cut. `film/faces/` has the face photos for the cold open.
- **`graphics/out/`**: callouts, credits, stats cards, banners, subtitles and URL as `.mov` with alpha (PNG frames inside: lossless, and read by Premiere, Resolve and Final Cut), the transparent title as a PNG sequence (`title-alpha/`), and the full-frame title and end card as `.mp4`. `stills/` has a PNG of every graphic, plus the duel captions.
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

## The rendered duel (film mode)

`client/src/film.ts` (dev only, `?film`) plays a scripted match in the real client: both players' lines, timed from FIGHT!, go through the game's own paths (the hand cursor, words at the cursor, the orb, the summoning circle, the cost reel, the opponent's bubbles), the match clock runs at 0.6× so the duel ends before overtime, towers are guarded until the scripted ending, and Isaac's side freezes when the cat lands. The titan is trimmed to 15 embers so the game accepts it.

With the client's dev server running (`npx vite --config client/vite.config.ts --port 5178` in the repo root), from `video-assets/`:

```bash
../node_modules/.bin/tsx scripts/film.mjs --view cindy   # or isaac; ~18 min, frame by frame at 1080p30
node scripts/film-audio.mjs                               # the game's sound for both renders
node scripts/cuts.mjs                                     # one clip per beat, with sound
node scripts/drone.mjs                                    # the cold open's drone shot
node scripts/coldopen.mjs                                 # stitch the cold open
```

Change lines, spots, timing or slow motion in `film/duel.mjs` and render again; every render of the script is the same match. Don't edit client code while a render runs: the dev server reloads the page.

## Before filming

- **The titan costs 17–18 embers live**, whatever the wording (tried four phrasings, four times each). The game refuses anything over 15, so the film render trims it to 15; in a live game the line would be refused.
- **The primary `FAL_KEY` is out of balance.** Everything here ran on `FAL_KEY_FALLBACK`; the live game falls back the same way, a little slower. Top up the first account before filming.
- Team names on the banners are just "Cindy" and "Isaac" with Blue side / Red side, since the brainstorm's team names are still open. Change them in `scripts/render.mjs`.
