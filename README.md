# Untitled Arena Game

A real-time, two-player arena battler where your deck is whatever you can describe. Point at the arena, say what the troop is, and AI turns your words into a fighting unit with stats, a price, artwork and its own voice.

Built at Cal Hacks 13.0 (Oct 23–25, 2026) with Claude, Cartesia and SpacetimeDB.

## Project notes

- [meta/SPEC.md](meta/SPEC.md): the game spec (v2)
- [meta/PROGRESS.md](meta/PROGRESS.md): what's done, what's next, and the decisions log

## Layout

| Path | What |
|---|---|
| `shared/` | Plain TypeScript used everywhere: `sim.ts` (the combat `step()`), `troop.ts` (stat schema, clamps, `price()`), `anchors.ts` (the 10 reference troops), `arena.ts` (board and match constants), `prompt.ts` (the troop-designer prompt). |
| `server/` | SpacetimeDB module: rooms, deploys, and the 20 Hz tick that runs `step()`. |
| `client/` | Vite + TypeScript browser game: lobby, canvas arena, keyboard / mouse / text input, Cartesia STT and battle cries. |
| `api/` | Small Node proxy that holds the API keys. `POST /api/troop` turns a description into a priced troop with Claude, `POST /api/voice-token` mints a 60 s Cartesia token for the browser's sockets, `POST /api/sprite` draws a troop with fal and serves it at `/api/sprite/<id>.png` (cached in `.cache/sprites/`). |
| `meta/` | Spec and progress log. |

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

Every key is optional and the game still runs without it: no `ANTHROPIC_API_KEY` uses the offline designer, no `CARTESIA_API_KEY` falls back to the browser's speech recognition and plays no battle cries, no `FAL_KEY` keeps the emoji placeholder tokens. `npm run api` prints which of them it found.

Open http://localhost:5173 in two tabs (each tab is its own player), create a room in one and join it from the other, or both press **Join DEMO**. From a second laptop on the same network, open `http://<this-laptop-ip>:5173`.

After changing tables or reducers in `server/`, run `npm run db:publish` then `npm run db:generate` to refresh `client/src/module_bindings`. If a schema change is refused, `npm run db:reset` republishes and wipes the data.

To use Maincloud instead of a local server: `spacetime login`, `spacetime publish --module-path server --server maincloud <db-name> -y`, then open `http://localhost:5173/?host=https://maincloud.spacetimedb.com&db=<db-name>`.

## Controls

- **Mouse and keys:** aim over your half, click to lock a spot. `1`–`0` (or the buttons) drop the 10 starter troops. Type a description and press Enter to drop it at the locked spot. With the mic on, hold the mouse button, say the troop and let go to deploy it there; drag off the ring before letting go to cancel.
- **First visit** opens a setup screen: turn on camera and mic, say hello. After that the camera and mic come back on by themselves each visit (the ⋯ menu has **Run setup again**).
- **Camera** (top-left panel, opt-in): aim with your index knuckle, pinch thumb + middle finger to lock, say or type the troop while you hold, release to deploy, drag outside the ring before releasing to cancel. With the mic on, the pinch is push to talk: speech goes to Cartesia only while you hold it, and letting go deploys at once. The middle of the camera frame maps to the whole screen, like a touchpad; there's no calibration step. Space and Esc always stand in for the hand: hold Space to lock at the cursor (hand or mouse) and talk, let go to deploy, Esc to cancel.
- **Mouse and keyboard** (⋯ menu, on by default): the mouse aims, clicks or holds to lock, `1`–`0` drop starter troops. Works alongside the hand; turn it off to play with the camera and mic only.
- **Mic** (opt-in): without the camera, start talking to lock at the cursor, describe the troop, go quiet to deploy, say "cancel" to cancel (voice click). With the camera on, voice click is off unless you tick it under `⋯`. Speech goes to Cartesia `ink-2` (the panel says "listening (Cartesia)"); without a Cartesia key, or if it can't connect, the browser's speech recognition takes over.
- After you let go, your words, "designing…" and a silhouette show at the spot until the troop appears. `T` (or `?timings` in the URL) shows how long each step took; release → stats is the one that must beat the 2.5 s delay.
- `V` (or the 3D button) cycles the top-down board and the POV views.
- The 2.5 s deploy delay starts at the lock, so designing overlaps the wait. Cost shows once the troop lands; anything over 10, or over your elixir, is refused with what it would have cost.
- Art is drawn while you talk and lands on the troop a second or two after it does; until then it fights as its placeholder token. Each troop shouts its battle cry as it lands, in its own voice. Online you hear only your own troops' cries (the other laptop plays theirs); vs Bot you hear both. A cry that would overlap another is skipped.
- **Play vs Bot** (easy / normal / hard) runs the whole match in the browser, no server needed. `?` reopens the how-to card, `M` mutes sound effects and battle cries.

## Designer benchmark

`npm run bench` compares troop-designer backends on the same descriptions: cold start, p50/p90 latency, valid-JSON rate and 9 judgement checks from the prompt's rules (size words, abuse, consistency). It runs every provider that has a key in `.env` (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `GROQ_API_KEY`). With Claude plus another provider, it also reports cost agreement with Claude and what racing the two would give. Options: `--n 40`, `--providers claude,cerebras`, `--dry` (offline designer only). Set `DESIGNER=gemini|cerebras|groq` in `.env` to play with another backend; the default is Claude.

## Checks

```sh
npm test          # shared sim and pricing tests
npm run typecheck # client, api and server
```
