# Aesthetics

The design vision for the game: how it should look, sound and feel. Update it whenever a design choice is made or changes, so new art, sound and UI work starts from the same place. Dated decisions go at the bottom.

**Last updated:** 2026-10-24

## Theme: warmth and frost

A fight on a frozen night, fought from beside a fire. The world is cold, dark and wintry; warmth is what the player brings to it: firelight, embers, a hearth to come back to between rounds.

- **Frost** is the setting: the arena, the night sky, the fog, the stone. Cool, quiet, a little hostile.
- **Warmth** is comfort and energy: the menu, the player's own glow, gold accents, the crackle of a fire. It should feel cosy, not aggressive.
- The two sit side by side rather than one beating the other. Most moments should have a bit of both: a cold scene with a warm light in it, or a warm room with frost on the window.

## Palette

What the client uses today (`client/src/style.css`, `client/src/pov.ts`). Deep night navy for the world, with warm gold as the accent.

| Role | Colour | Notes |
|---|---|---|
| Background | `#0d1020` / `#0a0c1a` (3D) | Frozen night; also the fog colour |
| Panels, lines | `#171b2e`, `#2a3050` | Cold slate |
| Text, muted text | `#e8ebf5`, `#8e96b3` | Frost white, cold grey |
| Your side | `#4aa3ff` | Ice blue |
| Their side | `#ff5d6c` | Warm red |
| Elixir | `#c56cf0` | Violet, the magic in between |
| Gold accents | `#ffd27a`, `#ff9f5a` | Firelight and embers; titles, highlights |

## Sound

### Music

Every music track carries a **crackling fireplace texture** underneath the instruments, so the whole soundtrack sounds like it's played by a fire. Frost comes through the instruments: celesta, glockenspiel, music box, shimmering high strings, sleigh-bell-like percussion.

| Track | Feel |
|---|---|
| Menu | Cosy winter fireside. Warm plucked strings, celesta and soft bells, a crackling hearth up front. Relaxed, 100 BPM. |
| Battle | Fire against the cold. Driving war drums and warm brass over icy strings and glockenspiel, fire crackle underneath. 120 BPM. |
| Overtime | The same battle theme at its climax: faster drums, urgent strings, the fire roaring. 140 BPM. |

The prompts live in `tools/audio/prompts.mjs` (`MUSIC`); keep them in line with this table.

### Sound effects

Stylised and punchy, close and dry, so they read clearly over the music (`SFX_STYLE` in `tools/audio/prompts.mjs`). The troop sets (blade, ranged, magic, swarm, heavy, mech, beast) aren't themed yet; candidates for a warmth-and-frost pass are the match sounds: arena ambience (wind over snow), match start, double elixir and victory and defeat jingles.

## Art

Undecided: troop sprites still use placeholder discs and emoji. Whatever style is picked should fit a wintry night with warm light sources, and stay readable at about 64 px.

## Open questions

- Should frost and warmth map to the two teams (blue vs red), or stay a mood both sides share?
- Snow, breath fog or ember particles in the 3D arena?
- Theme the match sound effects and arena ambience to match the music.

## Decisions

- **2026-10-24:** Theme is warmth and frost. Music gets a fireplace crackle under every track; menu, battle and overtime redone to match.
