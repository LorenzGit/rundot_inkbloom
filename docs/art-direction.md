# Illuminated Marginalia

The art direction, stated once so it can be checked against.

## The idea

A naturalist's field journal, open on a dark desk under one warm lamp. The
journal has printed structure — a serif heading, a ruled border, a numbered
index of twenty entries — and it has been annotated by a hand that is clearly
still working: the rules wobble, the marginal notes are handwritten, and gilt
stars get stamped in one at a time as each secret is confirmed.

Two rules keep it coherent:

1. **Everything on the page is pigment on paper.** The ink layer multiplies
   into the sheet rather than sitting on top of it, so the paper's fibre,
   foxing and vignette read through every mark.
2. **Everything off the page is desk.** Cream on walnut. Gilt is reserved for
   things the player earned — discovery stars, unlock glows — and nothing else.

## Palette

| Role | Value | Where |
| --- | --- | --- |
| Desk | `#1b1712`, lamp pool `#3a2f22` | Behind the sheet, and the shelf band |
| Paper | `#fcf9f0` | The default Rag sheet |
| Ink | `#2a2622` | Every ruled line, label and glyph on the sheet |
| Cream | `#f4eedd` | Type and outlines on the desk side |
| Gilt | `#c9a227` / `#f0d488` | Discoveries, unlocks, focus rings |
| Confirmed | `#3f7d45` | A kept daily prompt |

The ten inks carry their own colours (`src/game/sim/elements.ts`) and the
twenty discoveries each carry an accent used for their star and their toast
(`src/game/sim/discoveries.ts`).

## Type

- **Printed voice** — `Iowan Old Style, Palatino Linotype, Palatino, Georgia,
  Times New Roman, serif`. Headings, labels, the wordmark. This resolves to a
  real book face on every platform the game ships to: Iowan or Palatino on
  Apple, Noto Serif behind `serif` on Android, Georgia on Windows.
- **Handwritten voice** — `Bradley Hand, Chalkboard SE, Segoe Print, Comic Sans
  MS, cursive`. Used *only* for short marginalia, where a sans fallback still
  reads as an annotation rather than as a broken asset.

**Why no webfont.** A handwriting face is the obvious choice and the wrong one:
the game would ship a large blocking font file for text that is, by design,
sparse, and any coverage gap would land on the most decorative surface. The
system stack above is legible everywhere and the direction survives every
fallback in it.

## Everything is procedural

No image asset ships except the store thumbnail, and that is rendered by the
game.

- **Paper** (`scene/paperTexture.ts`) — fibre speckle, long pressed fibres, age
  foxing at the edges, lamp falloff, an optional drafting grid. Deterministic
  per sheet seed, so grain never crawls between frames, and a torn-off page gets
  a genuinely different sheet.
- **Ink** (`scene/simTexture.ts`) — granulation from each cell's fixed paper
  grain, and watercolour edge darkening on any cell touching bare paper. Those
  two effects are most of what makes the simulation read as pigment rather than
  as coloured sand.
- **UI** (`scene/handDrawn.ts`) — bottles, eraser, torn sheet, brush dots, and
  the dip pen cursor. Panels are ruled with a deterministic wobble so they look
  hand-drawn rather than jittery.
- **Audio** (`audio/inkAudio.ts`) — a nib scraping rag paper, fire ticking at a
  density driven by the simulation's burning-cell count, a gilt chime for a
  discovery, and a sparse D-dorian ambient bed. Plus a continuous *page voice*
  whose level follows how busy the sheet is, which makes a burning page feel
  loud and a settled one feel calm without a single scripted cue.
- **Thumbnail** (`scripts/thumbnail.html`) — a real page: a thicket grown by
  the real simulation, set alight, and caught halfway through becoming
  something else.

## Sheets

Paper is not a skin. On Rag and Vellum the ink multiplies into the sheet the
way pigment darkens paper. On Nocturne and Blueprint it *screens*, so the same
inks stop being stains and become light — an ember on Nocturne is a lamp, not a
scorch. The desk tone shifts with the sheet so the whole frame moves together.

## Motion

Centralised timings in `scene/palette.ts`. Toasts slide down from the top of
the page and rotate slightly as they settle; a torn sheet flies off the desk
with its rotation and shadow intact; the discovery counter punches when it
changes; bottles wiggle when selected or refused.

**Reduced motion is a treatment, not an absence.** With it on, toasts fade in
place instead of sliding, the tear becomes a fast crossfade, discovery particle
bursts are suppressed, and the counter marks itself with a gilt ring instead of
a bounce. Every state change still reads as a change.

## Fit

Portrait only. The page holds a fixed 3:4 aspect and is centred in whatever
vertical space is left between the header and the shelf, weighted slightly
upward so the header is never stranded in empty desk on a tall phone. Safe-area
insets are read from the same CSS custom properties the React shell publishes,
so the canvas respects notches and home indicators without knowing which it is
dealing with. On a wide screen the game stays a phone-shaped column and the
desk fills the rest.
