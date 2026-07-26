# Art direction

The direction, stated once so it can be checked against.

## The idea

**A warm sheet of paper inside a modern game.** The page is the only warm,
tactile, analogue thing on screen — real fibre, real pigment, ink that
granulates and darkens at its drying edges. Everything around it is a
contemporary mobile-game chrome: a deep indigo shell, rounded surfaces lit from
above, and one saturated gold accent.

That contrast is the whole design. The indigo is what makes the paper glow; an
earlier brown "desk" made it muddy. The gold is what makes progress feel like a
reward rather than a statistic.

Two rules keep it coherent:

1. **On the page it is pigment.** The ink layer multiplies into the sheet, so
   the paper's grain, foxing and vignette read through every mark. Nothing UI
   is ever drawn onto the page except the first-run hint and the ruled border.
2. **Off the page it is UI.** Deep indigo, rounded, top-lit, with gold reserved
   for things the player earned — progress meters, discovery stars, unlocks.

## The surface recipe

Every raised thing in the game — the shelf plank, the progress chip, panels,
buttons, note cards — is built the same way. That repetition is what makes it
feel like one object rather than a pile of components.

```
background : top-lit linear gradient (lighter → darker)
inset rim  : 1px white at ~10% along the top edge
drop shadow: a tight one and a wide one, both warm-black
radius     : 14–26px, generous like a native control
```

The Pixi shelf follows the identical recipe with layered fills, because Pixi
Graphics has no gradient primitive.

## Palette

| Role | Value | Where |
| --- | --- | --- |
| Shell | `#141222` → `#0b0a13` | The frame behind everything |
| Surface | `#322b4d` → `#241f38` | Shelf plank, cards, buttons, panels |
| Paper | `#fcf9f0` | The default Rag sheet |
| Ink | `#2a2622` | Ruled border and on-page marginalia |
| Cream | `#f4eedd` | Primary type on the shell |
| Muted | `#9d95c2` | Secondary type, captions, disabled |
| Gold | `#f5b841` (deep `#d8862a`, glow `#ffd98a`) | Progress, discoveries, unlocks, the CTA |
| Confirmed | `#4cc38a` | A kept daily prompt |

The ten inks carry their own colours (`src/game/sim/elements.ts`) and the twenty
discoveries each carry an accent used for their star, their journal medal, and
the rim flash when they are found (`src/game/sim/discoveries.ts`).

## Type

- **UI voice** — the system sans at 700–800 weight. This is what reads as a game
  on a phone, and it ships no font. Used for every control, label, count and
  heading.
- **Identity** — `Iowan Old Style / Palatino / Georgia / serif` for the wordmark
  and for discovery titles in Field Notes. It is the trace of the journal the
  game grew out of, kept exactly where it earns its place.
- **Marginalia** — `Bradley Hand / Chalkboard SE / Segoe Print / cursive`, only
  for the one-line notes under a discovery and the first-run hint on the page.

**Why no webfont.** The UI voice is a system sans on purpose: a downloaded
display face would block first paint for text that is mostly short labels, and
any coverage gap would land on the most visible surface. The stacks above are
legible everywhere and the direction survives every fallback in them.

## Everything is procedural

No image asset ships except the store thumbnail, and that is rendered by the
game itself.

- **Paper** (`scene/paperTexture.ts`) — fibre speckle, long pressed fibres, age
  foxing, lamp falloff, an optional drafting grid. Deterministic per sheet seed,
  so grain never crawls between frames and a torn-off page gets a new sheet.
- **Ink** (`scene/simTexture.ts`) — granulation from each cell's fixed paper
  grain, watercolour edge darkening on any cell touching bare paper, and two
  blur radii for the mark and its wet halo.
- **Shelf** (`scene/handDrawn.ts`) — corked apothecary bottles with glass, ink
  level, specular stripe and contact shadow; the eraser, brush and torn-sheet
  icons; the gold lock disc.
- **Audio** (`audio/inkAudio.ts`) — a nib on rag paper, fire ticking at a
  density driven by the simulation's burning-cell count, a gold chime for a
  discovery, a sparse D-dorian bed, and a continuous *page voice* that follows
  how busy the sheet is.
- **Thumbnail** (`scripts/thumbnail.html`) — a real page: a thicket grown by the
  real simulation, set alight, caught halfway through becoming something else.
  It doubles as the title screen's hero art.

## Sheets

Paper is not a skin. On Rag and Vellum the ink multiplies into the sheet the way
pigment darkens paper. On Nocturne and Blueprint it *screens*, so the same inks
stop being stains and become light — an ember on Nocturne is a lamp, not a
scorch. The shell tone shifts with the sheet so the whole frame moves together.

## Motion and reward

Shared timings in `scene/palette.ts`.

- The CTA has a hard bottom edge and depresses into it — a physical key press.
- The progress chip punches when the count changes.
- A discovery fires three things at once: a particle burst at the cell, a rim
  of the discovery's own colour racing around the sheet, and a reward card
  sliding down from the top. The rim matters most: the player is usually
  watching the reaction, not the counter, and it works even when the discovery
  happened off-screen.
- Panels arrive as bottom sheets with a grab handle — the native mobile gesture.
- A torn sheet flies off with its rotation and shadow intact.

**Reduced motion is a treatment, not an absence.** With it on, ambient loops
stop entirely, toasts fade in place instead of sliding, the tear becomes a fast
crossfade, particle bursts are suppressed, the celebration rim is brief, and the
progress chip marks itself with a gold ring instead of a bounce. Every state
change still reads as a change.

## Fit

Portrait only. The sheet is 150×258 cells — deliberately taller than a notebook
page, because a phone is roughly 9:19.5 and a 3:4 sheet leaves a third of the
screen as dead shell. It also plays better: material gets more room to fall,
climb and react before it reaches an edge.

The sheet takes everything between the HUD and the shelf; the shelf is sized by
its contents, not by a share of the screen, so bottles are the same comfortable
size on every device. Safe-area insets are read from the same CSS custom
properties the React shell publishes, so the canvas respects notches and home
indicators without knowing which it is dealing with. On a wide screen the game
stays a phone-shaped column.
