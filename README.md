# Untitled Arena Game

A real-time, two-player arena battler where your deck is whatever you can describe. Point at the arena, say what the troop is, and AI turns your words into a fighting unit with stats, a price, artwork and its own voice.

Built at Cal Hacks 13.0 (Oct 23–25, 2026) with Claude, Cartesia and SpacetimeDB.

## Project notes

- [meta/SPEC.md](meta/SPEC.md): the game spec (v2)
- [meta/PROGRESS.md](meta/PROGRESS.md): what's done, what's next, and the decisions log
- [meta/aesthetics.md](meta/aesthetics.md): the aesthetic vision (warmth and frost): palette, music, sound, art

## Layout

| Path | What |
|---|---|
| `shared/` | Plain TypeScript used everywhere: `sim.ts` (the combat `step()`), `troop.ts` (stat schema, clamps, `price()`), `anchors.ts` (the 10 reference troops), `arena.ts` (board and match constants), `prompt.ts` (the troop-designer prompt). |
| `server/` | SpacetimeDB module: rooms, deploys, and the 20 Hz tick that runs `step()`. |
| `client/` | Vite + TypeScript browser game: lobby, canvas arena, keyboard / mouse / text input, Cartesia STT. |
| `api/` | Key proxy: one Vercel function per route, with the shared code in `api/_lib/` and a local server in `api/_dev.ts`. `POST /api/troop` turns a description into a priced troop with Claude, `POST /api/voice-token` mints a 60 s Cartesia token for the browser's sockets, `POST /api/sprite` draws a troop with fal and serves it at `/api/sprite/<id>.png` (cached in `.cache/sprites/`, or the function's temp dir on Vercel). |
| `meta/` | Spec, progress log and aesthetic vision. |

## Run it locally

Needs Node 22+ and the [SpacetimeDB CLI](https://spacetimedb.com/install).

`npm start` (or `./run.sh`) does all of the below in one terminal: installs dependencies if missing, creates `.env` if missing, starts and publishes SpacetimeDB (skipped if the CLI isn't installed, leaving only Play vs Bot), then runs the API and the game. Ctrl-C stops everything. To run the pieces separately:

```sh
npm install && (cd server && npm install)
cp .env.example .env          # add ANTHROPIC_API_KEY, CARTESIA_API_KEY, FAL_KEY (all optional, see below)

npm run db:start              # terminal 1: local SpacetimeDB on :3000
npm run db:publish            # once, and after every server/ change
npm run api                   # terminal 2: key proxy on :8787
npm run dev                   # terminal 3: game on http://localhost:5173
```

Every key is optional and the game still runs without it: no `ANTHROPIC_API_KEY` uses the offline designer, no `CARTESIA_API_KEY` falls back to the browser's speech recognition, no `FAL_KEY` keeps the emoji placeholder tokens. `npm run api` prints which of them it found.

Open http://localhost:5173 in two tabs (each tab is its own player), create a room in one and join it from the other, or both press **Join DEMO**. From a second laptop on the same network, open `http://<this-laptop-ip>:5173`.

After changing tables or reducers in `server/`, run `npm run db:publish` then `npm run db:generate` to refresh `client/src/module_bindings`. If a schema change is refused, `npm run db:reset` republishes and wipes the data.

To use Maincloud instead of a local server: `spacetime login`, `spacetime publish --module-path server --server maincloud <db-name> -y`, then open `http://localhost:5173/?host=https://maincloud.spacetimedb.com&db=<db-name>`.

## Deploy

The repo is linked to the Vercel project `calhacks-2026`: every push to `main` deploys to production, other branches get preview URLs. Vercel builds `client/` (`npm run build`) and serves `api/*.ts` as functions; their API keys (`ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `FAL_KEY`) are Vercel environment variables, not `.env`. The deployed site plays online against the Maincloud database `calhacks-arena`, so after changing `server/` run `spacetime publish --module-path server --server maincloud calhacks-arena -y`. The deployed site is behind a password gate (`middleware.ts`); the password is the `SITE_PASSWORD` environment variable on Vercel, and changing it signs everyone out. New columns get defaults so that publish keeps the play logs; one without a default makes it ask for `--delete-data`, which wipes them.

## Controls

- **Talking a troop in:** start with `npm start` (or `npm run api` next to `npm run dev`); the api should print `voice: Cartesia`. Turn the mic on (setup screen, or **Mic** top left; no camera needed), start a match, point the mouse at your half, **hold Space or the mouse button**, say the troop ("a fire dragon"), let go. Your words show at the spot as you talk and the troop deploys there. A hint under the text box says the same during a match. Without the api or a Cartesia key the browser's recogniser is used instead, which Chrome has and Brave doesn't.
- **Mouse and keys:** aim over your half, click to lock a spot. `1`–`0` (or the buttons) drop the 10 starter troops. Type a description and press Enter to drop it at the locked spot. With the mic on, hold the mouse button, say the troop and let go to deploy it there; drag off the ring before letting go to cancel.
- **First visit** opens a setup screen: turn on camera and mic, say hello. After that the camera and mic come back on by themselves each visit (the ⋯ menu has **Run setup again**).
- **Camera** (top-left panel, opt-in): aim with your index knuckle, pinch thumb + middle finger to lock, say or type the troop while you hold, release to deploy, drag outside the ring before releasing to cancel. With the mic on, the pinch is push to talk: speech goes to Cartesia only while you hold it, and letting go deploys at once. The middle of the camera frame maps to the whole screen, like a touchpad; there's no calibration step. Space and Esc always stand in for the hand: hold Space to lock at the cursor (hand or mouse) and talk, let go to deploy, Esc to cancel.
- **Mouse and keyboard** (⋯ menu, on by default): the mouse aims, clicks or holds to lock, `1`–`0` drop starter troops. Works alongside the hand; turn it off to play with the camera and mic only.
- **Mic** (opt-in): without the camera, start talking to lock at the cursor, describe the troop, go quiet to deploy, say "cancel" to cancel (voice click). With the camera on, voice click is off unless you tick it under `⋯`. Speech goes to Cartesia `ink-2` (the panel says "listening (Cartesia)"); without a Cartesia key, or if it can't connect, the browser's speech recognition takes over.
- After you let go, your words, "designing…" and a silhouette show at the spot until the troop appears. `T` (or `?timings` in the URL) shows how long each step took; release → stats is the one that must beat the 2.5 s delay.
- The view is 3D only: you start on top of your king tower, looking down the arena.
- The 2.5 s deploy delay starts at the lock, so designing overlaps the wait. Cost shows once the troop lands; anything over 10, or over your elixir, is refused with what it would have cost.
- Art is drawn while you talk and lands on the troop a second or two after it does; until then it fights as its placeholder token.
- **Play vs Bot** (easy / normal / hard) runs the whole match in the browser, no server needed. `?` reopens the how-to card, `M` mutes sound effects.

## Designer benchmark

`npm run bench` compares troop-designer backends on the same descriptions: cold start, p50/p90 latency, valid-JSON rate and 9 judgement checks from the prompt's rules (size words, abuse, consistency). It runs every provider that has a key in `.env` (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `GROQ_API_KEY`). With Claude plus another provider, it also reports cost agreement with Claude and what racing the two would give. Options: `--n 40`, `--providers claude,cerebras`, `--dry` (offline designer only). Set `DESIGNER=gemini|cerebras|groq` in `.env` to play with another backend; the default is Claude.

## Play logs

Every round is logged to private SpacetimeDB tables that only the database owner can read: `match_log` (one row per round, online or vs Bot), `generation` (one per deploy attempt: transcript, description, design before and after clamping, designer source and timings, when the art arrived, outcome), `utterance` (every finished speech segment, including words said between deploys), `troop_log` (what each troop did in the fight) and `event` (setup, camera and mic, speech errors, mismatch flags). Players flag a troop that isn't what they asked for by saying "that's wrong" or pressing <kbd>X</kbd>.

`npm run logs` prints the last rounds as timelines (each deploy next to what the player said after it) plus a summary: input mix, outcomes and cancel reasons, design wait p50/p90, art on time, mismatch rate, damage per elixir. `npm run logs -- --jsonl > attempts.jsonl` writes one joined line per attempt for tuning the prompt and the art. Options: `--last 20`, `--server maincloud --db <name>`.

## Checks

```sh
npm test          # shared sim and pricing tests
npm run typecheck # client, api and server
```
