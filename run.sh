#!/usr/bin/env bash
# Starts everything for local play: SpacetimeDB (if the CLI is installed), the key proxy and the game.
# Ctrl-C stops it all.
set -euo pipefail
cd "$(dirname "$0")"

[ -d node_modules ] || npm install
[ -d server/node_modules ] || (cd server && npm install)
[ -f .env ] || { cp .env.example .env; echo "Created .env from .env.example; add ANTHROPIC_API_KEY to use Claude."; }

# Each background job gets its own process group, so cleanup can kill npm and everything it spawned.
set -m
pids=()
cleanup() { for p in "${pids[@]}"; do kill -- "-$p" 2>/dev/null || true; done; }
trap cleanup EXIT
trap 'exit 130' INT TERM

if command -v spacetime >/dev/null; then
  npm run db:start >/dev/null 2>&1 &
  pids+=($!)
  echo "Waiting for SpacetimeDB on :3000..."
  until curl -s -o /dev/null http://localhost:3000; do sleep 0.5; done
  npm run db:publish
else
  echo "SpacetimeDB CLI not found: only Play vs Bot will work. Install from https://spacetimedb.com/install"
fi

npm run api &
pids+=($!)
npm run dev &
pids+=($!)

echo "Game: http://localhost:5173"
wait
