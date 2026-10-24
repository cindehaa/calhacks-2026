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
| Blue side (side 0) | `#4aa3ff` | Ice blue |
| Red side (side 1) | `#ff5d6c` | Warm red |
| Embers (the resource; `elixir` in code) | `#ff8a3d` | Warm amber, between the enemy red and the gold. **Proposal for Cindy** |
| Gold accents | `#ffd27a`, `#ffb02e` | Firelight; the wordmark and the one main action |
| Frost on towers | `#f4fbff` `#e3f7f5` `#c6f2ee` `#9de6e3` `#78d2d6` `#8cc0e0` `#6f9fcf` `#557fc0` `#3f62ad` `#33489a` `#3f3a86` `#523d7a` | Thin to thick and lit to shadow, after a low-poly iceberg: frost white, mint, aqua, sky, steel, cobalt, violet |

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
- **Standards:** swallowtail flags beside the enemy's half in the enemy's colour (red, or blue when you play red), rippling. There are none on your side: near the camera the poles foreshorten into sticks.
- Text drawn on the board uses Cinzel.

## Tower frost

Designed in Paper ("Arena — UI design systems", page "Tower frost"; picked direction C, *Frozen shell*, over a plain coat and shards alone) and built in `client/src/frost.ts`.

- **Frost from the base:** frost climbs each tower as it loses health, from a thin rime at full health to near the top one hit from falling. Its shape follows how ice really builds on a stone tower on a freezing night. Cold air pools at the ground, so the ice is a real shell outside the walls: thickest at the foot (flaring onto the ground as a skirt), thinning to nothing at a ragged frost line, lumpy and faceted. Freezing wind (from the upper left of the view) piles rime on the side it hits: the shell is thicker there and grows small rime feathers pointing into the wind. Tiny frost needles form along the front. The tower's own fire melts snow on the crown, and the water drips over the rim and refreezes, so once it's cold enough icicles hang under the crown, longer as the frost climbs, and the gem's fire dims. Thin frost is white (air trapped in it scatters light) and thick ice clear and blue, so the shell runs white at its edge to aqua and cobalt at the foot, each facet shaded by which way it faces. Flat facets, no soft gradients.
- **Overtime:** in the last 30 seconds the frost line on every tower creeps up with the clock, whatever its health, so the cold is visibly closing in. A hurt tower keeps its higher line.
- **Crumble:** a destroyed tower breaks into low-poly chunks of stone, crown (in its team colour) and ice that fly out, fall, bounce and settle as rubble round a frosted stump, with ice shards and dust in the burst. Under reduced motion the rubble is laid down without the fall.
- **Cost:** one ice-shell mesh per tower (about five more draw calls); every rime feather, needle and icicle is one instanced mesh, all rubble another. Towers are now flat-shaded, so their eight faces read like the menu art.
- **Home island:** the island towers carry the same ice: a faceted shell standing off the walls, thick at the foot and thicker on the windward left, rime feathers, icicles where it's cold enough; the red side's towers show it climbing (one half-frosted, one near-frozen).



Designed in Paper ("Arena — UI design systems", row G) and built into the client. The low-poly arena sets the shape language; Game of Thrones-style heraldry inspires the look.

- **Words are plain.** Heraldry and fantasy are visual inspiration only. Game text says what things are: Practice, Play online, Join a room, Blue side and Red side, XP and ranks Bronze to Diamond, Embers for the match resource, Forfeit this match?, Rematch. No "houses", "ravens" or "foes" in the text.
- **Sides:** colour follows the side, the same on both screens: the host (and you against the bot) is the blue side, the guest the red side. Each player still sees their own side at the bottom of the board. Towers, troops, team rings, health bars, drop markers, the opponent's speech bubble, the standards and the result tapestries all take the side's colour; your aim and drop markers wear your own. The room pop-up and the versus card always put blue on the left and red on the right, marking yours "· You". The banners and shields keep a raven and a sun sigil as pictures.
- **Shapes:** chamfered slabs split into a lit and a shadow facet, each sitting on a solid darker side face so it pops, with a 1 px lit top edge. No gradients beyond the facet split; no gilding, parchment or ornament.
- **Heraldry:** a faceted gold raven displayed (wings spread) for blue and a radiant sun for red (`client/src/heraldry.ts`), each over a tone-on-tone damask of small birds or small suns on a diamond lattice. Embroidered on every tapestry (home and result; the long result cloth repeats a smaller emblem below) and etched into the halves of the versus card. They replace the old octagon sigil badges.
- **One 3D language:** everything is a faceted piece with a lit facet, a shadowed facet and an extruded side, lit from the upper left. That covers slabs, panels, crowns, shields and icons. Icons (`client/src/icons.ts`) are built the same way: raised gold on stone, carved into amber buttons (dark faces with a light lip below), pale on the tool buttons, ice on a loss. No flat line icons; the Join a room icon is the raven emblem itself.
 Cinzel Decorative for the *Artifice* wordmark (faceted fill: light gold top half, amber bottom half, with a warm glow), Cinzel for titles and names, Alegreya Sans for everything else, always with lining figures. Alegreya Sans replaced Chakra Petch, whose squared techno shapes fought the heraldry.
- **Colour:** one accent. Amber `#ffb02e` marks the main action (Play online, Start match, Rematch) and the selected option; everything else is stone (`#252b4a` / `#1c2140`) with amber icons. Banner cloth: cool cobalt `#1c58c4` / `#14429c` for blue and warm scarlet `#c82424` / `#9a181c` for red, pushed apart in hue and warmth so the sides never read alike; gold trim on both. Tower caps on the island are the same muted cobalt and crimson. Gold `#f3d58a` appears only on victory, ice `#dbe9f4` / `#9cc3e0` only on defeat.
- **Texture:** fine film grain over the menus, a woven-thread overlay and embroidered trim and chevrons on the banners, snow on the island's rim and trees.
- **Home:** amber *Artifice* wordmark, the real 3D arena centre-stage (the very board the match is played on, seen from high behind the blue side), in its snowy valley, lit by its braziers. Your blue tapestry hangs on chains from the top edge of the screen and ripples in the wind (`client/src/banner.ts`: a grid of facets moved by a wave that grows toward the swallowtail, each facet shaded by its slope, so folds catch the light as they travel down; gusts every few seconds; the name and rank sway with it). It holds your name (click to rename), rank, points and a bar to the next rank. The red tapestry hangs on the right, mirroring yours, its brazier-lit edge facing the island, and carries your last match (opponent and score, or "No matches yet"). The two move out of step. One big **Play online**, with **Practice** and **Join a room** beside it. Practice opens a small panel to pick Easy, Normal or Hard (the last pick lit amber), which starts the match. Footer: connection status with a dot, and the credit line.
- **Title:** the wordmark under a low-poly moon, "Say a troop. Watch it fight.", Press any key.
- **Motion:** one entrance, then only the weather moves. Pressing a key on the title glides the wordmark up into the home screen (view transition); the banners unfurl and the buttons rise. After that: the camera leans a little toward the cursor and drifts slowly round the arena, snow falls, embers rise from the braziers, mist drifts and the banners sway. Starting a match flies the camera down from the home view to your king-tower eye. Play online catches a sheen of light on entry and on hover. All of it stops under reduced motion.
- **End of a match:** no jump cut. The board freezes where it stands: it desaturates, the HUD fades, frost creeps in from the corners on a loss or a warm glow rises on a win. After 1.8 s the result screen fades in over it, and the frozen board stays visible behind, dimmed and slightly blurred.
- **Victory and Defeat:** the same fluttering blue and red tapestries as home, hung from the top. The loser's freezes to ice (pale ice cloth, frost along the tails) and hangs stiff. Victory adds turning rays and gold confetti; Defeat, gusting snow and the frost from the freeze.
- **Result motion:** each result screen stages its entrance: the title slams in on Victory (or drops and shivers on Defeat), the crowns pop one by one, the points count up or down, the reasons slide in, and the frozen banner shivers. Then the weather keeps going: on Victory the rays turn slowly while gold confetti tumbles and embers rise; on Defeat, snow blows in gusts and frost creeps in from the corners.
- **Setup and How to play:** the same chamfered stone panels, Cinzel headings, octagon step markers, amber primary button. Setup's third step, Point and pinch, shows two hand diagrams (`client/src/input/handart.ts`, inline SVG drawn like the virtual hand: frost bones, dark joints, amber fingertip) on dark stone tiles: a pointing hand drifting with arrows round its fingertip, and a thumb closing onto the index finger with a pale flash where they touch. Both hold still under reduced motion.
- **Pinch practice:** the end of first-time setup with the camera on (`client/src/practice.ts`). A dark full-screen layer with a stone header (pinch diagram, plain instructions, a frost meter that fills amber as thumb and finger close, "1 of 3" in amber Cinzel) and three octagon targets (frost rim, dark face, amber diamond) shown one at a time across the screen; the rim turns amber under the cursor and the target bursts pale gold when pinched. Only a real pinch counts. Skip practice sits at the bottom; Esc skips too.
- **Pinch guide in a match:** when pinches keep almost closing over your half, a small stone card with the pinch diagram slides in just above the virtual hand (below it, top left, on phones): "Pinch not closing · Touch your thumb all the way to your index finger, then let go." It takes no clicks, pauses nothing, fades after about 5 s, and shows at most once a minute and three times a visit.
- **In-match HUD:** the clock sits on a stone plaque top right under the tools (Cinzel figures, "vs Bot", "Double embers", "Overtime · triple embers" or "Tiebreaker" in amber under it; the figures turn amber in overtime, counting down its own 30 s), clear of the enemy king tower. The DOUBLE EMBERS, OVERTIME and TIEBREAKER announcements are a compact dark pill with an ember outline at the top centre that drops in and fades after about 2 s, never over the river or bridges; on a phone it sits just under the clock and tools. Only the 3-2-1-FIGHT countdown stays mid-screen, before anything is on the board. Elixir is a violet ten-segment bar with a hexagonal count gem, turning amber for double elixir. The describe field is a chamfered dark slab with an amber underline on focus; hints and status are plain text lines. No starter-troop chips: every troop is said or typed. The camera / mic panel (buttons, camera preview, readouts) sits top left only at `/dev`; otherwise it takes no space and the camera button stays in the tools during a match. The raw connection status shows only online and only when something is wrong. Text drawn on the board (troop names, health, the countdown) is Cinzel, whose figures are lining.
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
- **2026-10-24:** Things react when poked (`client/src/react.ts`, rule in `pokes.ts`): buttons squish on press and brighten or tilt on hover with a soft thock; the home tapestry, plaque and result banners swing and throw embers, the wordmark flares. On the board your troops hop with an emote or call their name, enemy troops flinch, towers shudder and shed frost, and the opponent's ground puffs snow with a few embers; hovering a unit (mouse or fingertip) lights it (its name and cost label was dropped later, see below). A click on your own half still deploys. All motion stops under reduced motion; M mutes the sounds.
- **2026-10-24:** Home banners: picked direction 2 from the Paper "Banner workshop" page (hung from above). The tapestry flutters; the red banner is gone from home, its last match moved to a hung plaque.
- **2026-10-24:** Core loop juice (`client/src/juice.ts`): cost revealed on landing as a rolling reel tinted gold (bargain) or red (pricey), size-scaled landing impact with snow bursts, an amber-to-gold summoning circle under each drop, Cinzel names that stamp in, the opponent's words in a frost-white chamfered bubble with a red edge, a gold coin that shatters for a refused troop, and an MVP card on the result screen in the chronicle's stone.
- **2026-10-24:** Tower frost (Paper "Tower frost", direction C, then reworked over several reviews and finally led by the physics of icing: a faceted ice shell outside the walls, thick at the foot where cold air pools, thicker to windward with rime feathers, icicles from the crown's meltwater, white where thin and blue where thick): towers frost up from the base as they're hurt, every tower frosts slowly through overtime, and a destroyed tower crumbles into rubble round a frosted stump. The home island's towers show the frost.
- **2026-10-24:** The resource is called embers wherever players see it (code keeps `elixir`). The bar is a kindling pile whose sticks glow brighter as it refills, the count sits in a flame, costs carry a small flame, spent sticks fly as embers to the summoning circle, and the banner reads DOUBLE EMBERS, "the fire roars". The amber `#ff8a3d` is a proposal for Cindy. Rank points stay "Points".
- **2026-10-24:** Overtime and the tiebreaker reuse the DOUBLE EMBERS banner: OVERTIME, "next tower down wins · triple embers", and TIEBREAKER, "all towers lose health · first to fall loses". The clock figures turn amber from overtime on. A draw keeps the existing Draw result screen; its first reason says how the tiebreaker went.
- **2026-10-24:** Room pop-up, other player disconnected: their slot greys out (grayscale shield, muted name) and reads DISCONNECTED in place of Red side; Start match disables with "Your friend disconnected. Waiting for them to come back". A notice says "<name> disconnected" / "<name> is back", and "The other player left the room" when the host closes it on the guest.
- **2026-10-24:** The red tapestry is back on home (the hung plaque looked bare). Matches end on a frozen board, then the result screen fades in over it; result screens use the home tapestries, the loser's frozen.
- **2026-10-24:** Result screen trimmed: no reasons list or stats grid. Under the crowns and points sits one card: the MVP (art, name, words) and your total damage. Every round adds points (win > draw > loss), ticked up one at a time with a rising tick, a chime and a gold pop on the last. Result tapestries hang the full height of the screen. Rematch vs the bot has no subtitle. The home footer's Online/Connecting status is gone. Button hover, press and menu click sounds are louder.
- **2026-10-24:** The difficulty row under Practice moved into a pop-up: Practice opens a panel with Easy, Normal and Hard stacked as slabs (the last pick amber) and a Back link; picking one starts the match.
- **2026-10-24:** Dropped the starter-troop chips (and keys 1–0). The top-left camera / mic panel is dev-only (`/dev`); players reach camera and mic from the camera button in the tools.
- **2026-10-24:** Elixir cap is 15, so the kindling pile has one stick per elixir (15 by default, rebuilt to match whatever cap the match runs on). At `/dev` the Practice pop-up has a collapsed Dev settings section under the difficulties: Max elixir, Starting elixir, Elixir per second, and Reset, in muted small type so it stays out of the way.
- **2026-10-24:** Names: the in-match resource is **Embers** (flame icon), rank progress is **XP** (gold star icon). XP replaced "points" on home, results and the forfeit prompt; the result screen's flame next to XP became a star so the two never share an icon.
- **2026-10-24:** Home shows the arena players actually fight on: the painted island is replaced by the live 3D board (same towers, river, bridges, braziers, valley, light and fog as a match) under the home menu, seen from a home camera that drifts and leans toward the cursor; the red princesses keep home's frost. Pressing Practice or joining a room flies the camera down to your king-tower view over the same arena.
- **2026-10-24:** Etched the raven and the sun into every banner and the versus card. Replaced every flat line icon with faceted 3D icons and gave the crowns and shields an extruded side, so the menus are one 3D style. The result card is Most creative troop; total damage has its own slab.
- **2026-10-24:** The game is called **Artifice** (briefly Abracadabra). The wordmark, page titles and password gate say so; the home banners hang lower to make room for the longer title.
- **2026-10-24:** Phones: in portrait the match camera leaves your king-tower eye for a steeper overhead view fitted so the whole board shows between the tools and the dock (it blends in as the screen narrows; your king is an ordinary solid tower there). The clock moves to the top-left corner level with the tools, the dock goes full width with wrapping hints, and touch devices say "tap your half" instead of click / Space / Esc (`client/src/mobile.css`).
- **2026-10-24:** Result screens use the same banners as home, hung below the title line, and the middle stacks vertically in one narrow column: title, crowns, XP, damage dealt, most creative troop, buttons. The versus card's halves are dyed cloth (folds, grain, gold trim) with the emblems etched tone-on-tone.
- **2026-10-24:** More contrast between the sides: blue banners and the versus card's blue half go cool cobalt, red goes warm scarlet.
- **2026-10-24:** Less clutter on the board: a troop's name tag (name, cost pill, tower icon) shows while it drops and for about 2.5 s after it lands, then fades out over half a second. Troops already down when you join show no tag.
- **2026-10-24:** No hover label on the board: hovering a troop (mouse or fingertip) only makes it glow. The fingertip cursor sits over the board all match, so the name-and-cost label kept a name up on whatever troop was under it.
- **2026-10-24:** Joining a room is hands free: the hand can pinch a code box to focus it, then saying the letters ("A B C D", "bee see", "alpha bravo") fills them in and the fourth letter joins. "Clear" or "cancel" empties the boxes. With the mic on, "Say the four letters" shows under the boxes while one is focused.
- **2026-10-24:** Tab icon (`client/public/favicon.svg`): a faceted amber flame, an ember, lit from the upper left with a pale hot core and a dark extruded side, on a rounded night-slate tile so it reads on light and dark tabs.
- **2026-10-24:** Playtest: the DOUBLE EMBERS banner sat over the river mid-match and got in the way. It (and OVERTIME and TIEBREAKER, which share it) is now a smaller ribbon at the top centre of the screen, dropped below the clock and tools when they would overlap it (phones). On a wide screen it briefly covers the enemy king tower's health number.
- **2026-10-24:** Colours follow the side, not the viewer: in an online match the host is blue and the guest red on both screens (before, each player saw themselves blue). The room pop-up and versus card hold blue left and red right with "· You" on yours; the result tapestries take each player's side colour; the enemy's standards and the far rim light take the enemy's colour.
- **2026-10-24:** Onboarding teaches the hand: setup's Point and pinch step has animated point and pinch diagrams, "Let's play" runs a three-target pinch practice the first time the camera works (skippable), and in a match repeated near-miss pinches over your half bring up a small corner pinch guide, rate limited, never over the board's middle.
