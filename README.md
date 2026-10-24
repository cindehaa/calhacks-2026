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
| `client/` | Vite + TypeScript browser game: lobby, canvas arena, keyboard / mouse / text input. |
| `api/` | Small Node proxy that holds the API keys. `POST /api/troop` turns a description into a priced troop with Claude. |
| `meta/` | Spec and progress log. |

## Run it locally

Needs Node 22+ and the [SpacetimeDB CLI](https://spacetimedb.com/install).

`npm start` (or `./run.sh`) does all of the below in one terminal: installs dependencies if missing, creates `.env` if missing, starts and publishes SpacetimeDB (skipped if the CLI isn't installed, leaving only Play vs Bot), then runs the API and the game. Ctrl-C stops everything. To run the pieces separately:

```sh
npm install && (cd server && npm install)
cp .env.example .env          # add ANTHROPIC_API_KEY (optional: without it the offline designer is used)

npm run db:start              # terminal 1: local SpacetimeDB on :3000
npm run db:publish            # once, and after every server/ change
npm run api                   # terminal 2: key proxy on :8787
npm run dev                   # terminal 3: game on http://localhost:5173
```

Open http://localhost:5173 in two tabs (each tab is its own player), create a room in one and join it from the other, or both press **Join DEMO**. From a second laptop on the same network, open `http://<this-laptop-ip>:5173`.

After changing tables or reducers in `server/`, run `npm run db:publish` then `npm run db:generate` to refresh `client/src/module_bindings`. If a schema change is refused, `npm run db:reset` republishes and wipes the data.

To use Maincloud instead of a local server: `spacetime login`, `spacetime publish --module-path server --server maincloud <db-name> -y`, then open `http://localhost:5173/?host=https://maincloud.spacetimedb.com&db=<db-name>`.

## Controls

- **Mouse and keys:** aim over your half, click to lock a spot. `1`–`0` (or the buttons) drop the 10 starter troops. Type a description and press Enter to drop it at the locked spot.
- **First visit** opens a setup screen: turn on camera and mic, say hello. After that the camera and mic come back on by themselves each visit (the ⋯ menu has **Run setup again**).
- **Camera** (top-left panel, opt-in): aim with your index knuckle, pinch thumb + middle finger to lock, say or type the troop, release to deploy, drag outside the ring before releasing to cancel. Space and Esc always stand in for the hand: hold Space to lock at the cursor (hand or mouse), let go to deploy, Esc to cancel.
- **Mouse and keyboard** (⋯ menu, on by default): the mouse aims and clicks to lock, `1`–`0` drop starter troops. Works alongside the hand; turn it off to play with the camera and mic only. The middle of the camera frame maps to the whole screen, like a touchpad; there's no calibration step.
- **Mic** (opt-in): start talking to lock at the cursor, describe the troop, go quiet to deploy, say "cancel" to cancel. The browser's speech recognition stands in for Cartesia for now.
- The 2.5 s deploy delay starts at the lock, so designing overlaps the wait. Cost shows once the troop lands; anything over 10, or over your elixir, is refused with what it would have cost.
- **Play vs Bot** (easy / normal / hard) runs the whole match in the browser, no server needed. `?` reopens the how-to card, `M` mutes.

## Designer benchmark

`npm run bench` compares troop-designer backends on the same descriptions: cold start, p50/p90 latency, valid-JSON rate and 9 judgement checks from the prompt's rules (size words, abuse, consistency). It runs every provider that has a key in `.env` (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `GROQ_API_KEY`). With Claude plus another provider, it also reports cost agreement with Claude and what racing the two would give. Options: `--n 40`, `--providers claude,cerebras`, `--dry` (offline designer only). Set `DESIGNER=gemini|cerebras|groq` in `.env` to play with another backend; the default is Claude.

## Checks

```sh
npm test          # shared sim and pricing tests
npm run typecheck # client, api and server
```
