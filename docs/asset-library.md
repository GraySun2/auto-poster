# Build your own asset library from code

**For people (one minute):** this template ships no art, sound or fonts, only these instructions. Have your coding agent draw what your videos need *in code*: small pictures as text grids, bigger ones as drawing functions, looks as color and finishing rules. Code keeps everything editable, reviewable in a pull request, free of licence questions and the same every time it renders. You pick from sample pages the agent makes (Keep / Change / Cut); nothing goes into a video until you have kept it. The sections below are written for the agent.

---

## For agents: rules

1. **Make, don't fetch.** Draw every asset yourself in code. Do not download images, sprites, fonts, sounds or music, and do not copy another studio's characters, logos or a living artist's style. A font or sound you did not make may come in only if the person brings it and its licence allows it; record it in `assets/NOTICE.md` (name, source, licence).
2. **Ask before you build a lot.** Propose a short list first (what each asset is for, which video uses it), get the person's pick, then build only that.
3. **Nothing ships unkept.** Every new asset or look goes on a sample page for the person to Keep / Change / Cut. Record each answer in the asset's file with the person's words and the date. Unkept assets stay out of videos.
4. **One look per video.** A video uses one style (palette + finish) from the library throughout; say which at the top of its storyboard or scene file.
5. **Small, plain files.** One file per pack or character, no build step, no dependencies beyond what the repo already uses. Every file opens with a comment: what it is, how to use it, who kept it and when.

## The library layout

```
assets/
  README.md          the index: every pack, style and character, one line each, with its kept/proposed state
  NOTICE.md          anything not made here (person-supplied fonts or sounds) and its licence
  palettes/<name>.json        one palette per style
  sprites/<pack>.js           small pictures as letter grids
  draw/<thing>.js             bigger pictures as drawing functions
  styles/<name>.js            finishing passes that turn one drawing into a look
  characters/<name>/          a host or mascot: drawing, poses, personality
  audition/<what>.html        sample pages the person picks from
```

Keep the index (`assets/README.md`) current in the same commit as any asset change.

## Palettes

- 8 to 16 colors per style, each named with one letter in a JSON map, for example `{"k": "#0b1020", "w": "#f5ecd7", "a": "#ff5a8a"}`. Always include an outline dark, a light, two or three mid tones and one accent.
- The accent is the color captions use for the highlighted word; keep it readable on the style's background (contrast 4.5:1 or more against it).
- Check every palette on a dark and a light phone screen before proposing it.

## Small sprites: letter grids

For icons and items up to about 32 by 32:

```js
// assets/sprites/items.js: pickups for the platformer shorts. Kept: <person's words>, <date>.
export const palette = "default";
export const sprites = {
  heart: [
    ".kk.kk.",
    "kaakaak",
    "kaaaaak",
    ".kaaak.",
    "..kak..",
    "...k...",
  ],
};
```

- `.` is transparent; every other letter is a palette key. All rows the same width.
- One drawing helper renders a grid at any whole-number scale onto a canvas with image smoothing off, so pixels stay crisp. Snap positions to whole art pixels.
- To recolor for another style, swap the palette, not the grid.

## Bigger pictures: drawing functions

For characters, scenery and anything that moves or squashes:

- Write a function that draws from simple shapes (rectangles, circles, paths) with its size and pose as arguments: `drawHero(ctx, x, y, { w, h, squash, blink })`. Shapes stretch cleanly; a grid does not.
- Anchor at the bottom middle, so a character stands on the ground line whatever its size.
- Draw at the video's art resolution (for example a 270 by 480 canvas shown 4 times bigger for chunky pixels, or 540 by 960 shown twice for finer ones) and scale up with smoothing off.
- Keep a `seed` argument for anything random (stars, grass, dither) so a frame renders the same every time.

## Styles: one drawing, many looks

A style is a palette plus a finishing pass applied after drawing, so every sprite and drawing gets the look for free:

- Examples of passes you can write: an outline (darkest key around every filled pixel), rim light (the lightest key on edges facing the light), ordered dither (a 4 by 4 Bayer pattern between two keys), two-ink print (reduce to two inks plus paper, offset one ink by a pixel), hard shadow (a dark copy offset down-right), flat sticker (a thick light outline plus a drop shadow).
- Build a style audition page: the same three test pictures (a character, an item, a piece of scenery) in every style side by side, each with Keep / Change / Cut. Propose at most six new styles at a time.
- A kept style gets one line in the index: name, palette file, pass file, what it suits.

## Characters (hosts and mascots)

- A folder per character: `draw.js` (or a sprite sheet the person drew), `character.json` (name, size, poses, colors), and `personality.md` (who they are, how they talk, what they never say). Read `personality.md` before writing any line they speak.
- Poses in a fixed order: talk (mouth closed, slightly open, open, round), blink, then any extras. Every pose falls back to the first talk frame if not drawn yet, so a character works from one drawing and improves frame by frame.
- Mouth movement follows the voice's loudness or a word-timing file; a blink every 2 to 6 seconds at random (seeded).
- Make a character check page: every pose at real size on the style's background, plus a 3-second talking loop.

## Text on screen

- Captions and title cards use one font per style. A pixel or monospaced font draws crisply and lets you wrap by counting characters.
- Keep captions inside the safe area: away from about the top 220, bottom 450 and right 160 pixels of a 1080 by 1920 frame, where apps put their own buttons and text.
- The hook can be laid over a finished video at upload time with `onScreenText` in the queue (see the README); nothing needs re-exporting.

## Sound (optional)

- Make effects in code with the Web Audio API or a short script: a blip is a square wave with a fast pitch drop, a hit is noise with a 60 ms decay, a pickup is two quick rising notes. Save each as a preset (`sounds/<name>.json` with the oscillator settings) and render to WAV when a video needs it.
- Same audition rule: a page that plays each sound with Keep / Change / Cut.

## Checking before you hand over

- Render every new asset at real size on a 1080 by 1920 frame and look at it yourself before showing anyone. Fix blurry edges, half pixels, colors that vanish on the background, and anything touching the safe-area edges.
- Bring one strong option per need rather than a padded spread.
- After the person keeps something, record their words and the date in the asset file and the index, in the same pull request.
