# Launch plan

How we get people playing, filmed and talking about the game between now (Sat Oct 24, 2:30 PM) and judging. Submission is Devpost, 9:00 AM PT Sun Oct 25 (aim for 7:00 AM).

## What traction buys us

Traction is a means, not the prize. It pays off in four places:

| Where | What it needs from us |
|---|---|
| **Hacker's Choice** | Other hackers at Cal Hacks play it and remember it. In-person reach beats X here. |
| **Sponsor tracks** (Anthropic, Cartesia, SpacetimeDB, Supercell) | Sponsors see their tech used well, ideally in a post that tags them and that they reshare. |
| **Devpost video and pitch** | A montage of real strangers playing, plus real numbers: "N people summoned M troops in 18 hours". |
| **Judges' "Application" weak spot** | Proof that people who aren't us pick it up and play. The montage and the numbers are that proof. |

So every playtest is also a filming session, and every post points back to the table and the Devpost.

## The hook

One line, used everywhere (posts, table sign, video opener, pitch):

> **An arena battler with no deck. Point at the arena, say anything, and it fights.**

The hero shot is always the same three beats in under 3 seconds: a person says something absurd → their words appear on the arena → the troop drops in with its art and starts fighting. Every clip opens on that, never on a title card or menu.

## Before anything goes public (by 4:30 PM)

These block every step after them.

- [ ] **Pick the game name.** Still "Untitled" in SPEC.md. Needed for posts, the table sign and Devpost.
- [ ] **Decide how strangers get in.** The deployed site sits behind `SITE_PASSWORD` (`middleware.ts`), so a link on X opens a locked page. Options:
  - Open the site, with a per-IP cap on `/api/troop`, `/api/sprite` and `/api/voice-token` (none exists today) and spend limits set in the Anthropic, fal and Cartesia consoles. Best reach; needed if posts carry a link.
  - Keep the gate and print the password on the table sign and in the Cal Hacks Discord only. Safe, but posts become "come find us at table X" rather than "play now".
- [ ] **`?bot` link** (already on PROGRESS.md's list): opens straight into Play vs Bot, so a QR scan is one step from playing. Bot matches need no SpacetimeDB, so they survive bad hall wifi.
- [ ] **Short link and QR code** to that URL, on a printed or on-screen sign at the table.
- [ ] **Recording consent:** a line on the sign ("we're filming play for our demo, tell us if you'd rather not") and a verbal yes before anyone's face goes in a post.
- [ ] **Profanity check on art.** The designer already turns junk and profanity into the weak 150 hp troop, but fal will still draw whatever was said. Watch every clip before it goes out.

## Capture setup (start with the first playtest, keep it running)

The magic is a person's voice and hand turning into a troop, so the footage needs both the screen and the person.

- **Screen + face in one file:** OBS on the demo laptop, game window full frame, webcam as a picture-in-picture corner, mic audio on. Record every match; disk is cheap, missed moments aren't.
- **Second angle:** one of us films over the player's shoulder on a phone (vertical, 1080p60): hand pointing and pinching in the foreground, troop landing on the screen behind. This is the X-native shot.
- **Reaction shot:** the face when the troop appears. Point a phone at the player for the first drop of every match.
- **Moment log:** a shared note with timestamp + what was said + why it's good ("grandma on a shark, crowd laughed, 0:42 of recording 7"). Cutting goes ten times faster.
- **Mine the play logs:** `npm run logs -- --server maincloud --db calhacks-arena` lists every deploy with the words said, the design and the outcome. Use it to find the funniest descriptions, the best fights and the numbers for the stats card. `--wishes` gives "things players wanted that the game didn't have", a good honest beat for the pitch.

## In-person distribution (highest return for Hacker's Choice)

- **Table:** game always loaded on Play vs Bot, camera and mic on, sign with the hook line, the QR code and "Can you beat Hard bot?".
- **Hard-bot challenge:** whiteboard or sticky-note wall of people who beat Hard and the troop that won it. Gives people a reason to come back and bring friends; makes great B-roll.
- **Walk the hall** with a laptop between 4 and 10 PM: "want to summon something?" A 90-second match fits a coffee break.
- **Cal Hacks Discord:** post the hero clip and the table location once tonight, once Sunday morning. Follow the server's self-promo rules.
- **Sponsor booths:** show each sponsor their part live: Cartesia (talk → words in ~180 ms), SpacetimeDB (the 20 Hz tick, two laptops in one room), Anthropic (Claude designs and prices the troop inside the 2.5 s deploy delay), Supercell (Clash Royale arena, no deck). Ask the person by name if they'll reshare the post.

## X plan

Post from both teammates' personal accounts: one original, the other quote-posts with their own angle. Ask 10 or so friends to like and reply in the first 30 minutes; early engagement is what the algorithm reads. Native video only (upload, don't link YouTube), burned-in captions since most people watch muted, vertical or square crop.

| When | Post | Notes |
|---|---|---|
| **Sat ~7 PM** | **Hero clip** (15–25 s): best "say it → it fights" moment from the afternoon, then two more fast drops. | Thread: (1) clip + hook line, (2) how it works in one sentence each for Claude, Cartesia, SpacetimeDB, fal, tagging each, (3) "we're at Cal Hacks table X, come play" + link if public. |
| **Sat ~10 PM** | **"Reply with a troop and we'll summon it."** | The engagement loop: we play the replies and answer each with a 5–10 s clip of their troop fighting. Every answer is a new post in their notifications, and the best ones go in the montage. |
| **Sun ~1 AM** | **"Things people summoned today"**: a grid of the generated sprites with the words that made them. | Pull from the logs; one image, no video needed. |
| **Sun ~7:30 AM** | **The montage** + Devpost link. | Same video as the Devpost submission. Tag @CalHacks and the sponsors. |
| **After judging** | Thank-you post with any result, the numbers, and the montage again. | |

Draft for the hero thread:

> we built an arena battler with no deck.
> point at the arena, say anything, and it fights.
> built in 36 hours at @CalHacks 🧵

> claude designs the troop's stats and prices it, cartesia turns your voice into words, spacetimedb runs the match at 20 ticks a second, fal draws the art. all inside the 2.5 s it takes the troop to drop.

> come play at table __ / try it: [link]

Account handles to tag, to confirm before posting: @CalHacks, @AnthropicAI (and @claudeai), @cartesia_ai, @spacetime_db (SpacetimeDB / Clockwork Labs), @fal, @supercell.

Also worth one post each, same clip: LinkedIn (recruiters and sponsors read it), and the Cal Hacks Devpost gallery comments once it's up.

## The montage (Devpost video, X closer, demo backup)

60–90 seconds, landscape 1080p for Devpost with a vertical cut for X. Doubles as the backup video for when wifi dies at the judging table.

| Time | Beat |
|---|---|
| 0–3 s | Cold open on the best hero shot: words → troop → it fights. No title card. |
| 3–10 s | Hook line on screen. A second person, a second absurd troop. |
| 10–40 s | Rapid-fire: 8–12 strangers, one drop each, faces and reactions, cut on the moment the troop lands. Mix camera play and mouse play. |
| 40–55 s | How it works, one line each over gameplay, with logos: "Cartesia hears it, Claude designs and prices it, fal draws it, SpacetimeDB runs the fight." |
| 55–65 s | Stats card from the logs: players, troops summoned, median time from letting go to stats, weirdest troop. |
| 65–75 s | End card: name, link or QR, "Cal Hacks 13.0", both our names. |

Music: the game's own menu or battle track. Captions burned in. Cut the rough version Saturday night from what we have; swap in better clips Sunday morning before 7 AM.

## Timeline

| Time (PT) | What |
|---|---|
| Sat 2:30–4:30 PM | Name, gate decision, `?bot` link, QR sign, OBS set up, spend limits. |
| Sat 4:30–10 PM | Table open and recording; walk the hall; sponsor booth visits. One person runs the table, the other logs moments and cuts clips. |
| Sat 7 PM | Hero thread on X; Discord post. |
| Sat 10 PM | "Reply with a troop" post; answer replies through the night. |
| Sat 11 PM–1 AM | Rough montage cut; sprite grid post. |
| Sun 6 AM | Feature freeze. Pull final numbers from `npm run logs`. |
| Sun 6–7 AM | Final montage, Devpost page (image, video, repo, numbers). Submit by 7 AM. |
| Sun 7:30 AM | Montage post on X; second Discord post. |
| Judging | Live demo with the judge playing; montage loaded as backup; quote the numbers. |

## Numbers to track

- Vercel Web Analytics (already injected in `client/src/main.ts`): visits and where they came from.
- `npm run logs`: rounds played, distinct players, troops summoned, release → stats p50/p90, mismatch rate. These go in the stats card, the Devpost and the pitch.
- X: views and replies on the hero thread; sponsor reshares.
