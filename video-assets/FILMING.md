# Filming plan

The gameplay is already rendered from the game (`film/out/duel-cindy.mp4`, `film/out/duel-isaac.mp4`), the narrator is recorded (`narrator/`), the B-roll is done, and so is the montage (`film/out/montage.mp4`, cut from hackathon phone footage by `scripts/montage.mjs`). The rough cut (`film/out/roughcut.mp4`) already plays end to end at 3:24. All that's left to film is the two of us: the cold-open intros, faces, hands and reactions, and the two laptops.

## Schedule (Sun Oct 25)

Submission is Devpost, 9:00 AM PT; we aim for 7:00 AM. Everything filmed replaces seconds in the rough cut rather than adding them: it is already 24 s over 3:00.

| Time (PT) | Block | What | Done when |
|---|---|---|---|
| 2:00–2:20 | Set up | Room dim, warm practical, tripods on tape marks, renders on both laptops, notifications off, voice memos rolling. Shoot 10 s on each phone and check exposure, focus and audio. | Both test clips look and sound right |
| 2:20–2:35 | **Cold-open intros** (must have) | Centred, straight on. Isaac ×4, then Cindy ×4 (beat 1.2–1.3). These replace the face photos in a 1.3 s slot each. | One clean take each |
| 2:35–3:05 | **Duel runs** | Re-frame to the duel setup. Three full runs performing to the render (2 min each, plus count-in and reset). Gives 2.1, 2.7, 2.9 and 2.13 in one go. | One run with every line landing on time |
| 3:05–3:20 | Close-up pickups | In order of payoff: Isaac frozen (2.12), Cindy "…innocent cat." (2.11), Cindy narrowing her eyes (2.8), Isaac smug (2.7). Play the render from about 10 s before each moment. | One keeper each |
| 3:20–3:30 | Wide pickup | Isaac stands into frame for the titan line (2.10), low angle. | One keeper |
| 3:30–3:40 | Hand inserts | Cindy's hand over the shoulder for the aim (2.2), then tight on the pinch and open (2.3–2.4). | One keeper each |
| 3:40–3:45 | Laptops wide (optional) | Both renders in sync, the two of us facing off (play live). | Skip if behind |
| 3:45–4:00 | Offload and log | Copy every take to `film/takes/` as `<beat>-<who>-<take>.mp4`; note the keeper and its timecode per beat. | Log written |
| 4:00–5:30 | Edit | `node scripts/coldopen.mjs --isaac <clip> --cindy <clip>`, then cut the faces into the duel over the gameplay; trim to 3:00. | Watch-through at 3:00 or under |
| 5:30–6:00 | Final render | Grade with `grade/artifice-frost-fire.cube`, one full watch with sound, export 1080p. | Final file |
| 6:00–7:00 | Submit | Upload to Devpost (and YouTube if it needs a link), fill in the page. | Submitted |
| 7:00–9:00 | Buffer | Re-upload a fixed cut if needed. | |

**If we fall behind:** at 3:05, cut to one duel run; at 3:20, drop the rest of the pickups and go straight to offload. The cold-open intros plus one good duel run is the minimum worth keeping. If even that slips past 4:00, ship the rough cut as it is, trimmed to 3:00, with the photos in the cold open.

## How it works: perform to the render

- Each of you plays your own render full screen on your own laptop while the camera rolls: Cindy plays `duel-cindy.mp4`, Isaac `duel-isaac.mp4`. Your eyes, the screen glow on your face and your timing then match the gameplay we cut to.
- Both renders are the same match, so start them together. One person counts "3, 2, 1, go", both press play, and you clap once on camera to sync in the edit.
- Say each line when it comes up. Your own words appear at your cursor, and the other player's in a bubble over their drop. The table below gives the times, but trust the screen.
- Keep the render's sound low, or in one earbud, so it doesn't bleed into your mic.
- Don't record the narrator: those lines are already done.

## Line sheet

Render time is seconds into the video file. FIGHT! comes about 5.5 s in, after the versus card and countdown. Two stretches play in slow motion: the knight being made (action 8.6–12.2 s at 0.4×) and the titan (action 74–80.6 s at 0.55×). Times are within about half a second; the screen is the real cue.

| Who | Line | Action time (s) | Render time (s) | Say it over | Hand |
|---|---|---|---|---|---|
| Cindy | (aim: sweep across the arena) | 0.8–5.8 | 6.3–11.3 | — | Raise your hand and point; follow the cursor left, right, then settle on the left lane |
| Cindy | "A knight with a flaming sword." | 6.0 | 11.5 | 2.6 s | Hold the pinch while you talk; open your hand at about 14.1 (the drop) |
| Isaac | "A dragon. Bigger." | 15.0 | 25.9 | 1.6 s, unbothered | Pinch to talk, open to drop |
| Cindy | "An ice wizard." | 33.0 | 43.9 | 1.3 s | Pinch, open |
| Isaac | "A fire golem." | 40.0 | 50.9 | 1.1 s | Pinch, open |
| Cindy | "A frost dragon with three heads." | 46.5 | 57.4 | 1.7 s | Pinch, open |
| Isaac | "An angry flock of geese charging at you with knives." | 52.5 | 63.4 | 2.6 s | Pinch, open |
| Cindy | "A cybertruck." | 58.0 | 68.9 | 0.9 s | Pinch, open |
| Isaac | "Taylor Swift with a chainsaw." | 62.5 | 73.4 | 1.4 s | Pinch, open |
| Cindy | "Skibidi Toilet with knives." | 67.0 | 77.9 | 1.4 s | Pinch, open |
| Isaac | "An ancient frost titan, older than the mountains, crowned in lightning, leading an army of giants across the frozen wastes." | 71.5 | 82.4 | about 9 s on screen (it's in slow motion): slow, grand, standing | Stand up at about 81, pinch, open at about 91.3 |
| Cindy | "…innocent cat." | 83.0 | 99.3 | 1 s, soft, almost a whisper | Small pinch, gentle open |

Other moments to react to, in render time:
- 20.4: the knight lands and the cost rolls.
- About 27–32: the dragon torches the knight. Isaac smug, Cindy narrows her eyes.
- 95.8: the titan lands.
- 102.8: the cat lands.
- 103.1: everything of Isaac's freezes. Isaac freezes too.
- 104.3, 106.3 and 108.7: Isaac's towers fall.
- About 111: the result screen.

The gestures are the game's: aim with an L (index up, thumb out), pinch thumb to middle finger to talk, open to send.

## Setup

- **Two phones on tripods, one per person, both rolling the whole duel.** Landscape, 1080p or 4K, 30 fps, exposure and focus locked.
- **Framing:** medium close-up (chest up) from just beside the laptop, at eye height, slightly off-axis so the screen lights the face. Same lens, distance and height for both of you, so the split screen matches.
- **Lighting:** cold and dark like the game's frozen night. The room is dim, the laptop screen is the cool key light, and one small warm practical sits to the side (a desk lamp turned away, an orange LED) for a firelight edge on the face. Same side for both of you (or mirrored on purpose, so you face each other in the split). Keep the background dark and plain.
- **Audio:** a lav on each of you, or a second phone close by recording voice memos. Clap at the start of every take. The game's sound comes from the render; we only need your voices, clean, for the lines and captions.

## Shot list

| Beat | Shot | Who | Framing, camera | Takes |
|---|---|---|---|---|
| 1.2–1.3 Cold-open intros | A dramatic look to camera: head down, then lift your eyes into the lens and hold 2 s. Dead serious. | Isaac, then Cindy | Medium close-up, centred, straight on, slow push-in by hand or a zoom. Same framing and light for both. | 4 each |
| 2.1 Match starts | Locked in: lean toward the screen as the countdown ends | Both (the duel take) | Duel framing | From the duel take |
| 2.2 Aim | Cindy's hand raised and pointing, sweeping with the cursor | Cindy | Insert: over the shoulder, hand and screen both in frame, so the hand moves with the cursor | 3 |
| 2.3–2.4 Imagine, deploy | Close-up of Cindy's hand: pinch while talking, then open to drop | Cindy | Insert, hand fills the frame, screen glow behind | 3 |
| 2.7 The reply | Isaac smug after the dragon: a tiny shrug, half smile | Isaac | Duel framing, plus a tighter close-up pickup | 3 |
| 2.8 The turn | Cindy narrows her eyes slowly at the screen | Cindy | Close-up, eyes and brows | 3 |
| 2.9 Escalation | Every line, faces only; each reacts to the other's troop landing | Both | Duel framing, the whole run uninterrupted | 3 full runs |
| 2.10 The peak | Isaac stands up out of frame into frame, then delivers the titan line, arm out | Isaac | Wider, so standing fits; a slight low angle | 4 |
| 2.11 The drop | Cindy, soft: "…innocent cat." A tiny shrug. | Cindy | Close-up | 4 |
| 2.12 The shock | Isaac frozen, mouth slightly open, not blinking | Isaac | Tight close-up, hold 5 s | 3 |
| 2.13 Result | Isaac staring at the defeat screen; Cindy calm, sipping something | Both | Duel framing | 2 |
| 2.7 Play live (optional) | Both laptops side by side, both renders playing in sync, the two of you facing off | Both | Wide from behind and between the laptops; both screens readable | 3 |

A good duel run gives you most of these in one go. The inserts and close-ups are pickups after.

## Montage (beat 4)

Done: `film/out/montage.mp4` (43 s), cut by `scripts/montage.mjs` from the shots in `film/montage.json`. No strangers' faces: backs of heads, hands, arms and laptops only. Any extra montage clip follows the same rule; add it to `montage.json` and run the script again.

## On-set checklist

- [ ] Both renders copied to both laptops, brightness up, notifications off
- [ ] Phones charged, storage free, exposure and focus locked, landscape
- [ ] Lav or voice-memo phone per person, levels checked
- [ ] Room dim, one warm light at the side, background plain and dark
- [ ] Same framing and height for both of you (mark tripod spots with tape)
- [ ] Clap at the start of every take
- [ ] Count-in to start both renders together
- [ ] Line sheet printed or on a second screen
- [ ] Cold-open intros, duel runs ×3, then pickups: hands, smug, narrow, titan stand-up, "innocent cat", frozen, result
- [ ] Laptops wide shot for "play live"
- [ ] Every take offloaded to `film/takes/`, keepers logged
