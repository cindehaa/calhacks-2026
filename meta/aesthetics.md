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
| Embers (the resource; `elixir` in code) | `#ff8a3d` | Warm amber, between the enemy red and the gold. **Proposal for Cindy** |
| Gold accents | `#ffd27a`, `#ffb02e` | Firelight; the wordmark and the one main action |
| Frost on towers | `#eef5fb` edge, `#dbe9f4` / `#9cc3e0` lit, `#6f97bd` shadow | The ice crust, crystals and icicles; a bright edge, then lit and shadow facets |

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
| Double embers | Shimmer of ice crystals | Whoosh of flame |
| Match end | | Gong, a fire flaring then settling |
| Victory | Sleigh bells, celesta | Warm, festive brass |
| Defeat | Cold wind gust | A fire dying to embers |

**Troop sets** (blade, ranged, magic, swarm, heavy, mech, beast) stay unthemed: they describe what the troop is, and a player's "fire dragon" or "robot" shouldn't sound snowy.

## Art

Troop sprites are generated per description by fal (FLUX.1 schnell, background cut by BiRefNet; `STYLE` in `api/_lib/sprites.ts`): a single unit, full body, chunky stylised 3D mobile-game art, bold silhouette, bright saturated colours, soft studio lighting. Each stands on a team-coloured ring in the 3D view; the team disc with the troop's glyph shows until the art lands. Attack-pose frames (`api/_lib/poses.ts`) redraw the same sprite mid-strike from the troop's flavor. The style isn't tuned to warmth and frost yet; it should fit a wintry night with warm light sources, and stay readable at about 64 px.

Troop quirks show on the unit: a blue tint when slowed, a white flash on a hit, a charge glow during windups, dash smears, and element-coloured particles.

## The arena's surroundings

The board sits in a snowy valley at night (`client/src/scenery.ts`), all low-poly and flat-shaded like the menus:

- **Snow:** faceted ground, flat round the board and rolling into gentle drifts further out, in a dark cool blue (`#1f2a48`) so the board stays the brightest thing on screen. Snow falls across the whole scene.
- **Crags:** snow-capped rock up both sides of the valley and a row of peaks far behind the enemy. The camera looks down too steeply to see a horizon, so the mountains stand at the sides where the view reaches.
- **Woods:** snow-laden pines (each tier's top band white) with rocks between them, kept 5 tiles clear of the board so play reads cleanly.
- **Warmth:** four stone braziers along the banks, by the river and at the far corners, with flickering flames, a glow, rising embers and orange light pooling on the snow.
- **Red standards:** swallowtail flags beside the enemy's half, rippling. There are none on your side: near the camera the poles foreshorten into sticks.
- Text drawn on the board uses Cinzel.

## Tower frost

Designed in Paper ("Arena — UI design systems", page "Tower frost"; picked direction C, *Frozen shell*, over a plain coat and shards alone) and built in `client/src/frost.ts`.

- **Frost from the base:** an ice crust climbs each tower as it loses health, from a thin rime at full health to near the top one hit from falling. Its edge is uneven, not a regular zigzag: each corner stands at its own height and each face rises to one big peak, so the line reads as large crystal facets. A bright band (`#eef5fb`) runs along the edge where light catches it, and each face splits at its peak into a lit and a shadow facet. The ice is blue (`#9cc3e0` / `#6f97bd`) with a cold glow, never near-white, so it doesn't read as white socks. Inside, the ice is a mosaic of small triangular facets, each its own shade and clarity: milky ones hide the stone, clear ones let it show through tinted blue, so the crust reads as translucent. A few facet edges carry hairline cracks, tiny glints are scattered through it, and it glows brighter where you see it edge-on. The crystals are see-through too, each its own tint. Clumps of hexagonal crystals (one tall crystal with two smaller ones leaning off it) sit at the foot and grow with the frost; past 70% icicles hang off the crown and the gem's fire dims. No soft gradients.
- **Overtime:** in the last 30 seconds the frost line on every tower creeps up with the clock, whatever its health, so the cold is visibly closing in. A hurt tower keeps its higher line.
- **Crumble:** a destroyed tower breaks into low-poly chunks of stone, crown (in its team colour) and ice that fly out, fall, bounce and settle as rubble round a frosted stump, with ice shards and dust in the burst. Under reduced motion the rubble is laid down without the fall.
- **Cost:** the coat is painted in the tower's own stone shader; all shards and icicles are one instanced mesh, all rubble another (two draw calls in all). Towers are now flat-shaded, so their eight faces read like the menu art.
- **Home island:** every tower carries the same crust with its lit edge and crystal clumps; the red side's towers show the frost climbing (one half-frosted, one near-frozen with icicles).



Designed in Paper ("Arena — UI design systems", row G) and built into the client. The low-poly arena sets the shape language; Game of Thrones-style heraldry inspires the look.

- **Words are plain.** Heraldry and fantasy are visual inspiration only. Game text says what things are: Practice, Play online, Join a room, Blue side and Red side, points, ranks Bronze to Diamond, Forfeit this match?, Rematch. No "houses", "embers", "ravens" or "foes" in the text.
- **Sides:** you are always the blue side, the opponent the red side. The banners and shields keep a raven and a sun sigil as pictures.
- **Shapes:** chamfered slabs split into a lit and a shadow facet, each sitting on a solid darker side face so it pops, with a 1 px lit top edge. No gradients beyond the facet split; no gilding, parchment or ornament.
- **Type:** Cinzel Decorative for the *Arena* wordmark (faceted fill: light gold top half, amber bottom half, with a warm glow), Cinzel for titles and names, Alegreya Sans for everything else, always with lining figures. Alegreya Sans replaced Chakra Petch, whose squared techno shapes fought the heraldry.
- **Colour:** one accent. Amber `#ffb02e` marks the main action (Play online, Start match, Rematch) and the selected option; everything else is stone (`#252b4a` / `#1c2140`) with amber icons. Banner cloth is dyed deep: cobalt `#2c5ea8` / `#21498a` with ice trim, crimson `#a3303e` / `#80222f` with gold trim. Tower caps on the island are the same muted cobalt and crimson. Gold `#f3d58a` appears only on victory, ice `#dbe9f4` / `#9cc3e0` only on defeat.
- **Texture:** fine film grain over the menus, a woven-thread overlay and embroidered trim and chevrons on the banners, snow on the island's rim and trees.
- **Home:** amber *Arena* wordmark, the arena island centre-stage over low-poly snowy ranges, lit by its six braziers. Your blue tapestry hangs on chains from the top edge of the screen and ripples in the wind (`client/src/banner.ts`: a grid of facets moved by a wave that grows toward the swallowtail, each facet shaded by its slope, so folds catch the light as they travel down; gusts every few seconds; the name and rank sway with it). It holds your name (click to rename), rank, points and a bar to the next rank. A stone plaque hung on chains on the right shows your last match. There is no red banner on the home screen: the opponent is always red, so it said nothing. One big **Play online**, with **Practice** (plus Easy / Normal / Hard) and **Join a room** beside it. Footer: connection status with a dot, and the credit line.
- **Title:** the wordmark under a low-poly moon, "Say a troop. Watch it fight.", Press any key.
- **Motion:** one entrance, then only the weather moves. Pressing a key on the title glides the wordmark up into the home screen (view transition); the banners unfurl and the buttons rise. After that: the scene leans a little toward the cursor (ranges least, island most), snow falls, embers rise from the braziers, the brazier light flickers, mist drifts, the island bobs and the banners sway. Play online catches a sheen of light on entry and on hover. All of it stops under reduced motion.
- **Victory:** gold-lit ranges, rays and faceted gold confetti; your banner stands, theirs frosts over. **Defeat:** icy ranges, snow and heavy frost; your banner is the frozen one.
- **Result motion:** each result screen stages its entrance: the title slams in on Victory (or drops and shivers on Defeat), the crowns pop one by one, the points count up or down, the reasons slide in, and the frozen banner shivers. Then the weather keeps going: on Victory the rays turn slowly while gold confetti tumbles and embers rise; on Defeat, snow blows in gusts and frost creeps in from the corners.
- **Setup and How to play:** the same chamfered stone panels, Cinzel headings, octagon step markers, amber primary button.
- **In-match HUD:** the clock sits on a stone plaque top right under the tools (Cinzel figures, "vs Bot" or "Double elixir" in amber under it), clear of the enemy king tower. Elixir is a violet ten-segment bar with a hexagonal count gem, turning amber for double elixir. The describe field is a chamfered dark slab with an amber underline on focus; hints and status are plain text lines. Starter troops are small stone chips with amber key badges (keys only on the first ten). The raw connection status shows only online and only when something is wrong. Text drawn on the board (troop names, health, the countdown) is Cinzel, whose figures are lining.
- **Virtual hand:** during a match with the camera on, a small stone panel bottom right draws the hand the tracker sees (the 21 landmarks, mirrored, nearer joints thicker in ice tones). The index fingertip and a label show the gesture: amber Aiming, pale gold Flick · sent, rose Fist · clearing, or Show your hand.
- **Password gate:** the same wordmark, a chamfered password field and an amber Enter slab.
- Art lives in `client/public/ui` as SVG (ranges, frost, island, banners, moon); menu weather is `client/src/hubfx.ts`.

## Open questions


- Should frost and warmth map to the two teams (blue vs red), or stay a mood both sides share?

## Decisions

- **2026-10-24:** Merged Isaac's troop quirks: generated sprites with attack-pose frames, status visuals, and the 3D view now starts on top of your king tower (still the only view).
- **2026-10-24:** Theme is warmth and frost. Music gets a fireplace crackle under every track; menu, battle and overtime redone to match.
- **2026-10-24:** Match sounds and arena ambience redone for warmth and frost (snow, ice, wind, embers, braziers). Troop sound sets left as they are, since they follow what the player describes.
- **2026-10-24:** Menus rebuilt in design G (faceted heraldry): home with house banners, Send a Raven room pop-up, gold Victory and frost Defeat screens, embers and ranks. To Battle opens the room pop-up until matchmaking exists.
- **2026-10-24:** The deployed site opens on a password gate (`middleware.ts`): the ARENA title in gold over the frozen-night gradient, one password field and an amber Enter button.
- **2026-10-24:** Home polish pass: one amber accent (stone side buttons, deep dyed banners, muted tower caps), lit and snowy island with flickering braziers, snow, embers, mist and grain, a moon on the title, the wordmark gliding from title to home, a rank bar and a real difficulty selector. UI font is now Alegreya Sans.
- **2026-10-24:** Game text is plain language; fantasy stays in the visuals. Houses became blue and red sides, embers became points, ranks are Bronze to Diamond.
- **2026-10-24:** In-match HUD restyled to match the menus: stone clock plaque, faceted segmented elixir bar, chamfered describe field, stone troop chips, Cinzel for text on the board.
- **2026-10-24:** The arena got a world: snowy valley, crags, snow-laden pines, braziers with firelight and embers, red standards and falling snow. The old random dark spires are gone.
- **2026-10-24:** Victory and Defeat screens got motion (staged entrance, confetti and rays, gusting snow and creeping frost). Added the virtual hand panel.
- **2026-10-24:** Things react when poked (`client/src/react.ts`, rule in `pokes.ts`): buttons squish on press and brighten or tilt on hover with a soft thock; the home tapestry, plaque and result banners swing and throw embers, the wordmark flares. On the board your troops hop with an emote or call their name, enemy troops flinch, towers shudder and shed frost, and the opponent's ground puffs snow with a few embers; hovering a unit (mouse or fingertip) lights it with its name and cost. A click on your own half still deploys. All motion stops under reduced motion; M mutes the sounds.
- **2026-10-24:** Home banners: picked direction 2 from the Paper "Banner workshop" page (hung from above). The tapestry flutters; the red banner is gone from home, its last match moved to a hung plaque.
- **2026-10-24:** Core loop juice (`client/src/juice.ts`): cost revealed on landing as a rolling reel tinted gold (bargain) or red (pricey), size-scaled landing impact with snow bursts, an amber-to-gold summoning circle under each drop, Cinzel names that stamp in, the opponent's words in a frost-white chamfered bubble with a red edge, a gold coin that shatters for a refused troop, and an MVP card on the result screen in the chronicle's stone.
- **2026-10-24:** Tower frost (Paper "Tower frost", direction C; reworked after review: the even sawtooth and near-white coat looked like a doily and white socks, so the crust is now uneven, bluer and edge-lit, with crystal clumps; then given texture and translucency: a facet mosaic with clear cells, cracks and glints): towers frost up from the base as they're hurt, every tower frosts slowly through overtime, and a destroyed tower crumbles into rubble round a frosted stump. The home island's towers show the frost.
- **2026-10-24:** The resource is called embers wherever players see it (code keeps `elixir`). The bar is a kindling pile whose sticks glow brighter as it refills, the count sits in a flame, costs carry a small flame, spent sticks fly as embers to the summoning circle, and the banner reads DOUBLE EMBERS, "the fire roars". The amber `#ff8a3d` is a proposal for Cindy. Rank points stay "Points".
