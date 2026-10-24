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
| Gold accents | `#ffd27a`, `#ffb02e` | Firelight; the wordmark and the one main action |

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

Stylised and punchy, close and dry, so they read clearly over the music (`SFX_STYLE` in `tools/audio/prompts.mjs`).

**Match sounds** (`GAME_SFX`) are themed: the world sounds frozen, and the big moments flare with fire.

| Sound | Frost | Warmth |
|---|---|---|
| Arena ambience | Winter wind over a snowy arena | Faint crackling braziers, distant crowd |
| Deploy charge-up | Swirling frost | Crackling embers |
| Deploy landing | Packed snow, powder puff, icy crunch | |
| Tower hit / destroyed | Frosted stone, ice chips, ice shattering | |
| Match start | War horn across a frozen valley | |
| Double elixir | Shimmer of ice crystals | Whoosh of flame |
| Match end | | Gong, a fire flaring then settling |
| Victory | Sleigh bells, celesta | Warm, festive brass |
| Defeat | Cold wind gust | A fire dying to embers |

**Troop sets** (blade, ranged, magic, swarm, heavy, mech, beast) stay unthemed: they describe what the troop is, and a player's "fire dragon" or "robot" shouldn't sound snowy.

## Art

Troop sprites are generated per description by fal (FLUX.1 schnell, background cut by BiRefNet; `STYLE` in `api/sprites.ts`): a single unit, full body, chunky stylised 3D mobile-game art, bold silhouette, bright saturated colours, soft studio lighting. Each stands on a team-coloured ring in the 3D view; the team disc with the troop's glyph shows until the art lands. Attack-pose frames (`api/poses.ts`) redraw the same sprite mid-strike from the troop's flavor. The style isn't tuned to warmth and frost yet; it should fit a wintry night with warm light sources, and stay readable at about 64 px.

Troop quirks show on the unit: a blue tint when slowed, a white flash on a hit, a charge glow during windups, dash smears, and element-coloured particles.

## Menus and screens (G · faceted heraldry)

Designed in Paper ("Arena — UI design systems", row G) and built into the client. The low-poly arena sets the shape language; Game of Thrones-style heraldry inspires the look.

- **Words are plain.** Heraldry and fantasy are visual inspiration only. Game text says what things are: Practice, Play online, Join a room, Blue side and Red side, points, ranks Bronze to Diamond, Forfeit this match?, Rematch. No "houses", "embers", "ravens" or "foes" in the text.
- **Sides:** you are always the blue side, the opponent the red side. The banners and shields keep a raven and a sun sigil as pictures.
- **Shapes:** chamfered slabs split into a lit and a shadow facet, each sitting on a solid darker side face so it pops, with a 1 px lit top edge. No gradients beyond the facet split; no gilding, parchment or ornament.
- **Type:** Cinzel Decorative for the *Arena* wordmark (faceted fill: light gold top half, amber bottom half, with a warm glow), Cinzel for titles and names, Alegreya Sans for everything else, always with lining figures. Alegreya Sans replaced Chakra Petch, whose squared techno shapes fought the heraldry.
- **Colour:** one accent. Amber `#ffb02e` marks the main action (Play online, Start match, Rematch) and the selected option; everything else is stone (`#252b4a` / `#1c2140`) with amber icons. Banner cloth is dyed deep: cobalt `#2c5ea8` / `#21498a` with ice trim, crimson `#a3303e` / `#80222f` with gold trim. Tower caps on the island are the same muted cobalt and crimson. Gold `#f3d58a` appears only on victory, ice `#dbe9f4` / `#9cc3e0` only on defeat.
- **Texture:** fine film grain over the menus, a woven-thread overlay and embroidered trim and chevrons on the banners, snow on the island's rim and trees.
- **Home:** amber *Arena* wordmark, the arena island centre-stage over low-poly snowy ranges, lit by its six braziers. Blue banner: your name (click to rename), rank, points and a bar to the next rank. Red banner: Opponent, and your last match (opponent and score) once you've played one. One big **Play online**, with **Practice** (plus Easy / Normal / Hard) and **Join a room** beside it. Footer: connection status with a dot, and the credit line.
- **Title:** the wordmark under a low-poly moon, "Say a troop. Watch it fight.", Press any key.
- **Motion:** one entrance, then only the weather moves. Pressing a key on the title glides the wordmark up into the home screen (view transition); the banners unfurl and the buttons rise. After that: the scene leans a little toward the cursor (ranges least, island most), snow falls, embers rise from the braziers, the brazier light flickers, mist drifts, the island bobs and the banners sway. Play online catches a sheen of light on entry and on hover. All of it stops under reduced motion.
- **Victory:** gold-lit ranges, rays and faceted gold confetti; your banner stands, theirs frosts over. **Defeat:** icy ranges, snow and heavy frost; your banner is the frozen one.
- **Setup and How to play:** the same chamfered stone panels, Cinzel headings, octagon step markers, amber primary button.
- **Password gate:** the same wordmark, a chamfered password field and an amber Enter slab.
- Art lives in `client/public/ui` as SVG (ranges, frost, island, banners, moon); menu weather is `client/src/hubfx.ts`.

## Open questions

- Should frost and warmth map to the two teams (blue vs red), or stay a mood both sides share?
- Snow, breath fog or ember particles in the 3D arena?

## Decisions

- **2026-10-24:** Merged Isaac's troop quirks: generated sprites with attack-pose frames, status visuals, and the 3D view now starts on top of your king tower (still the only view).
- **2026-10-24:** Theme is warmth and frost. Music gets a fireplace crackle under every track; menu, battle and overtime redone to match.
- **2026-10-24:** Match sounds and arena ambience redone for warmth and frost (snow, ice, wind, embers, braziers). Troop sound sets left as they are, since they follow what the player describes.
- **2026-10-24:** Menus rebuilt in design G (faceted heraldry): home with house banners, Send a Raven room pop-up, gold Victory and frost Defeat screens, embers and ranks. To Battle opens the room pop-up until matchmaking exists.
- **2026-10-24:** The deployed site opens on a password gate (`middleware.ts`): the ARENA title in gold over the frozen-night gradient, one password field and an amber Enter button.
- **2026-10-24:** Home polish pass: one amber accent (stone side buttons, deep dyed banners, muted tower caps), lit and snowy island with flickering braziers, snow, embers, mist and grain, a moon on the title, the wordmark gliding from title to home, a rank bar and a real difficulty selector. UI font is now Alegreya Sans.
- **2026-10-24:** Game text is plain language; fantasy stays in the visuals. Houses became blue and red sides, embers became points, ranks are Bronze to Diamond.
