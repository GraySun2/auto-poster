# The 2D animation process, up to export

**For people (one minute):** each short is a web page that plays a drawn animation in time with a narrated voice, then gets rendered to an MP4 for this repository to post. Everything before the MP4 happens in three steps, each checked by you before the next starts: **timing** (when every spoken word starts and ends), **storyboard** (what the screen shows during each few seconds, written as a table) and the **render draft** (the animation built as a page, then rendered once as a draft video to look at). Changing a storyboard line costs a minute; changing a finished scene costs an hour, so the cheap steps come first. The voice is made before all of this, and the final export after it. The sections below are written for the agent.

This is the process used for the narrated history shorts made with the `animated-short` skill (its scripts and how-tos live in the content repository's `.claude/skills/animated-short/`, not here). The finished folders are what [the posting-kits importer](../README.md#using-it-in-a-repository-that-already-has-your-videos) reads.

---

## Where it sits

| # | Stage | Reads | Writes |
|---|---|---|---|
| 0 | Script | the topic | `script.md` (the exact words to say, and the Posting section) |
| 1 | Voice | `script.md` | `voice/voice.mp3` |
| 2 | **Timing** | `voice/voice.mp3`, `script.md` | `transcript/words.json`, `transcript/captions.srt` |
| 3 | **Storyboard** | `script.md`, `words.json` | `storyboard/storyboard.md`, key frames, a preview page |
| 4 | **Render draft** | `storyboard.md`, `words.json`, `voice.mp3` | `scene/index.html`, `scene/sfx.json`, `export/draft.mp4` |
| 5 | Export | the checked scene | `export/short.mp4`, `export/cover.png`, `export/posting.md` |

One folder per video. Each stage reads what the one before it wrote and writes one thing of its own. A stage counts as done only when the person has checked it, and that check is written in the video's `notes.md` with their words and the date.

**Two hard gates:**

- **The scene waits.** The real scene (stage 4) starts only when the voice, the timing and the storyboard are all checked. A rough test page to prove a technique is fine.
- **Upstream changes reopen downstream.** A new voice take means new timings, so timing, storyboard and scene are checked again. Say which stages a change reopens before making it.

## The input: the voice

The voice comes first, because every time in the video comes from it. The script's lines are sent to ElevenLabs as a batch through the studio's asset tool (a dry run with its estimate first, then the real send), one episode at a time. The person listens and keeps a take. The kept take, joined from its lines with 0.35 second pauses, becomes `voice/voice.mp3`; ElevenLabs' own word timings come with it as `voice/timings.json`. Timing locks to the kept take and nothing else.

---

## Step 1: Timing

Find when every word in the voice starts and ends. The storyboard's beats, the scene's motion and the captions all hang off these times.

The words are already known (the script), so this is **forced alignment**: line the known text up with the audio. The spelling always comes from the script; only the times come from the audio.

1. **Make the folder from the kept take.** The setup script joins the voice lines, checks the join against the kept take (they must match), adds the series' closing line, and writes `voice/voice.mp3`, `script.md` and the start of `notes.md` (the era's Look line included).
2. **Align.** `make-words.py <folder>` runs pocketsphinx (its English model ships inside the package, so nothing else downloads) in a Python virtual environment with `pocketsphinx` and `numpy`. It writes `transcript/words.json`, `transcript/captions.srt` and a check page that plays the voice and lights up each word as it is said.
3. **Fix what trips it, the right way:**
   - Spell numbers out in the script ("twenty", not "20"); the script stops otherwise.
   - A name the aligner doesn't know goes in `EXTRA_WORDS` at the top of `make-words.py` with how it sounds (CMU phones), so the script keeps the real spelling for the captions. Scan a lines file for unknown words before timing it.
   - A word the aligner puts in the wrong place goes in the video's `transcript/fixes.json` (`{ "fixes": [ { "word": 1, "text": "AI", "start": 0.16, "why": "..." } ] }`), which every run applies and reports. Never edit `words.json` by hand.
   - If the voice drifted from the script (a changed, added or dropped word), the alignment fails. Regenerate the voice or change the script to match what was said. Don't widen the aligner's search to force a pass: that puts old words onto a take that changed.
4. **Second opinion.** Compare word starts with ElevenLabs' `timings.json`; a word more than about half a second apart is worth listening to.

**Claude's checks:** every script word appears once in `words.json`, in order; times only go forward; no word is longer than about 1.5 seconds; the last word ends within half a second of the audio's end. Captions are cut at punctuation and pauses, then into chunks of up to four words.

**The person's check:** open the check page on a phone, press play, and say "words OK" or name the words that are early, late or wrong.

---

## Step 2: Storyboard

Split the voice into **beats** and say what the screen shows during each, before any animation is written.

### Draft early, fit later

Beats are written as **word ranges**, not times, so a storyboard can be drafted from the script before the voice even lands: a word-index list of the lines file shows which word is number what. When the voice is timed, the times fill themselves in from `words.json`.

### The spec

Each episode's storyboard is written as a small spec file, and a script (`sb4.py` for Era 4, `sb5.py` for Era 5) turns it into `storyboard/storyboard.md`. The model spec is `spec-example-82.py`. Its keys:

- `look`: the episode's look lines on top of the era's (what carries the episode, what is drawn as our own, how numbers are counted, callbacks to earlier episodes, how real people appear).
- `sets`: each place the episode visits, with the beats it serves and the drawing function that makes it.
- `frames`: the key frames, one line each.
- `beats`: one tuple a beat, `(first_word, last_word, shot, on screen, motion, host, sound)`, covering every word in order. The last beat is the closing card that cuts back to beat 1 so the short loops.
- `calls`: Claude's numbered decisions, for the person to agree with or change.
- `notes`: captions off where a text box is the caption, labels checked against the kit, and so on.
- `posting`: the title, hook, summary and hashtags, which the script writes into the Posting section of `script.md`.

### Rules for the beats

- **A new beat on each new idea, and at least every 3 seconds.** A beat over 3 seconds needs a second picture change in its Motion cell.
- **Beat 1 is the hook:** motion from the first frame, and a picture that would stop a scroll on its own. The last beat's picture matches the first so the video loops.
- **Shot** is `Wide` (the whole place), `Close` (pushed in until one thing fills the frame) or `Card` (the world dimmed, a few words or one number). One shot a beat, none held past 3 seconds, and a payoff is `Close`.
- **On screen** names the one big thing first (at least half the frame wide, in the world and not in a small box), then what changes. Aim for 12 to 16 picture changes in 30 seconds.
- **Motion** ties every move to a spoken word, in quotes: `the tag swings on on "two thousand yen"`. On a payoff, say how the frame reacts (a freeze of two or three frames, a small shake, a push in).
- **Host** says what the narrator does and how big he is: big for the hook, the turn and the reaction; small at the side or off screen while the picture does the work. Every so often he takes part instead of pointing: a Host cell that starts `Activity` has him play a pad, hold up a handheld, type, play an arcade stick, win or lose (the poses are below).
- **Sound** names the chiptune cue and the word it lands on (`pop-b on "inexpensive"`), from the repo's own set (blip, pop, hit, whoosh, jump, coin, check, error, sparkle, levelup, gameover; versions a, b and c), kept under the voice.
- **Real things are named, never shown.** Our own console, cabinets and boxes stand in for real products; a real game is a name in type on something of our own. Real people are name plates or a text box's tab, never drawn.
- **Keep words above the bottom 450 pixels,** where the apps put their own buttons and text.
- **Labels must fit the kit's type** (for Era 5's kit, 17 capitals across at size 96, or two lines).

### Each era moves its own way

Each era is drawn the way its own screens drew, and has a **motion grammar** the storyboard script writes into every storyboard's Look. Era 4 (8-bit): moves step in whole art pixels; a cut to another place is a palette fade through black in four steps, never a cross-dissolve; things pop in, drop with one bounce or slide in, and leave by blinking out; a quote is a text box typed with the voice, the said word in gold, captions off while it is up; a shake only for hard landings. Era 5 (16-bit): moves ease in and out; pans move three layers at different speeds; a cut is a mosaic; a quote is the 16-bit window; a hit is a three-frame freeze, a shake and a spark. A chain of episodes may add its own grammar on top (Era 5's fighting-game episodes stage their fights in a fighting-game frame of our own drawing).

### Key frames

The sets are drawn on the era's own kit in `storyboard/sketch/` (one function per set, ready for the scene to lift), and a short Node script renders the key frames to `storyboard/frames/` with a contact sheet. The person sees the look before the scene exists.

### Checks, then hand-off

1. **The spec check** (`check_e5.py`, or `quotecheck.py` and `longbeats.py` for Era 4): beats cover every word in order and end on the closing card; every quoted cue word in Motion and Sound is actually said inside its beat; beats over 3 seconds have a second change; beats under a second are flagged; labels fit; enough numbered calls. Before the voice lands it estimates times from the text.
2. **The preview page** (`make-preview.mjs`): plays the voice and shows each beat as a plain card at its real time, so the pacing can be judged without art. It also checks that beats are in order with no gaps and every shot starts with Wide, Close or Card.
3. **The person's check:** with the audio playing, Keep, Change or Cut each beat. When every beat is a Keep, the tick script writes the check into `notes.md` with their words and the date.
4. **Hand-off:** commit, push, keep a copy of the spec, and tell whoever renders that the episode is ready. Storyboard work stops there; rendering is someone else's step.

Episodes in a story chain are owned by one storyboard hand, so callbacks (a prop, a set, a last picture the next episode opens on) stay consistent.

---

## Step 3: Render draft

Build the animation as one web page that plays in time with the voice, then render it once as a draft video.

### Set up

`prep-scene.mjs <folder>` refuses to run until voice, timing and storyboard are checked. It copies the scene kit into `scene/kit/` (copied, not linked, so a finished video renders the same after the kit changes) and writes `scene/data.js` from `words.json`.

### The rules that make it renderable

1. **One clock.** Everything is on one paused GSAP timeline, or is a plain function of the time. No CSS animations, no timers, no `Date.now()`, no video elements. Nothing is kept from one frame to the next, so a seek to any time draws the same picture.
2. **A seek hook.** The page sets `window.scene` so the renderer can jump to any time.
3. **Playing follows the audio:** the timeline is moved to the audio's current time every frame.
4. **A fixed stage** of 1080 by 1920, scaled to fit the window.
5. **Everything local:** scripts, fonts and pictures are files in the repo.
6. **Seeded randomness,** so two renders are identical.
7. **Captions** come from `words.json`.

### Drawing it

The history series draws everything itself on one canvas with the era's kit: `gh.shots([...])` gives one entry per cut, each with a `draw(g, s)` function where `s` is seconds into the shot, and `gh.captions()` puts the captions on. Kits by era:

| Era | Kit | Look |
|---|---|---|
| 4 | `gamehistory-8bit.js` | 270 by 480 art pixels, the console's own color table, flat with no light, CRT glass |
| 5 | `gamehistory-16bit.js` | 360 by 640, 48 colors with darker partners, banded light, CRT glass |
| 6 | `gamehistory-3d.js` | faceted shapes lit from the upper left, fog, no glass |
| 7 and 8 | `gamehistory-vector.js` | smooth shapes; `flash` (thick outlines, gloss) or `flat` (soft shadows) |
| 9 | `gamehistory-mix.js` | the five kits at once, the picture cut into five strips in era order |

The calls carry over from kit to kit, so earlier scene code draws on later kits.

**The narrator** is the same man in a different build each era: rubber hose (Era 4), big head (Era 5), athletic (Eras 6 and 7), bodybuilder (Eras 8 and 9). One call draws him, `g.narrator(x, feetY, height, pose, options)`, with the poses `rest`, `point`, `hold`, `notes`, `hat`, `glass` and the activities `play` (a pad), `handheld`, `phone`, `type`, `arcade`, `win`, `lose` and `vr`. Activities move on their own (thumbs, taps, the stick); he looks down at what he holds. He slides and hops like a game piece; he doesn't walk.

### Order of work

1. Lay out beat 1, the hook, fully first, since it sets the look.
2. Build the rest in order, a few beats at a time, lifting the sets from the storyboard's sketch.
3. **Look at every beat.** A contact sheet script (`sheet.cjs`) draws three frames a beat (start, middle, end), labeled with beat and time, and prints any page error; ask it for frames every half second, or a few frames up close, where something moves fast. Fix what reads wrong: an empty card right after a cut, a pattern behind the narrator's head that reads as part of him, a label too small for a phone.
4. **Collect the sounds.** `cues.cjs` seeks through the timeline, collects the sound cues the scene registers as it draws, and writes `scene/sfx.json` (time, sound, optional pitch and gain).
5. **Render the draft.** `render-video.mjs <folder> --draft` opens the page in a headless browser at 1080 by 1920, seeks every frame, and pipes the pictures and the voice into ffmpeg: `export/draft.mp4` and a draft cover, which git ignores. It stops on a page error, a file that fails to load, a stage that doesn't fill the frame, or a scene whose length doesn't match the voice. Then `mix-sfx.mjs <folder> --draft` mixes the sound cues under the voice (render again before a second mix, or the sounds mix twice).
6. **Check the draft.** Its length is within a frame of the voice; spot frames from the start, middle and end match the page; a contact strip of the MP4 looks right; it plays in a phone browser.

**The person's check:** watch the draft (or the scene link) on a phone and on a PC with sound on, and note changes by time ("0:12 text too small"). When there are none left, Scene is ticked and stage 5 renders the final `short.mp4`, cover and posting text, which this repository then posts.

### Settings the video comes out at

1080 by 1920, 30 frames a second, H.264 `yuv420p`, AAC audio at 192k, `+faststart`. The video is exactly as long as the voice.
