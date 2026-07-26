# Art direction

The direction, stated once so it can be checked against.

## The idea

**A bright craft table.** A saturated teal ground, a warm wooden shelf of ink
bottles, cream cards with chunky rounded edges and hard bottom bevels, and one
amber accent for progress and reward. The page is a real sheet of rag paper and
is the only quiet, tactile thing on screen — which is exactly why it holds the
eye.

The direction went through two wrong turns worth recording. A sepia "field
journal" read as a literary artefact rather than a game. A deep indigo shell
read as a premium indie puzzle. Casual mobile is **high-key and saturated**: the
background is bright, the cards are cream rather than dark, the buttons are
thick and bevelled, and the type is heavy. Teal specifically, because it is the
one hue none of the ten inks use, so every ink stays legible against it.

Two rules keep it coherent:

1. **On the page it is pigment.** The ink layer multiplies into the sheet, so
   the paper's grain, foxing and vignette read through every mark. Nothing UI
   is ever drawn onto the page except the first-run hint and the ruled border.
2. **Off the page it is a toy.** Saturated ground, wooden shelf, cream cards,
   thick bottom-bevelled buttons. Amber is reserved for things the player
   earned.

## The surface recipe

Every raised thing in the game — the shelf plank, the progress chip, panels,
buttons, note cards — is built the same way. That repetition is what makes it
feel like one object rather than a pile of components.

```
background  : top-lit linear gradient (lighter → darker)
bottom edge : a hard 3–8px darker edge, no blur — this is the casual-game
              signature, and it is what makes a button feel pressable
drop shadow : one soft shadow under the hard edge
radius      : 16–30px, chunkier than product UI
```

Pressing a control translates it *down onto its own bottom edge* rather than
scaling it. That is the interaction that reads as physical.

The Pixi shelf follows the identical recipe with layered fills, because Pixi
Graphics has no gradient primitive.

## Palette

| Role | Value | Where |
| --- | --- | --- |
| Shell | `#1cadaa` → `#0a5457` | The teal ground behind everything |
| Wood | `#c98f55` → `#5f3a1b` | The shelf plank and its recessed slots |
| Card | `#fff8ea` / `#f2e3c9` | Panels, chips, pills, the reward toast |
| Card ink | `#3a2e24`, muted `#8b7a68` | Type on cream |
| Paper | `#fcf9f0` | The default Rag sheet |
| Amber | `#ffb92e` (deep `#dc8a11`, edge `#a4620a`) | Progress, discoveries, unlocks, selection |
| Green | `#5cc96b` (deep `#34a04b`, edge `#237035`) | The primary call to action, toggles |

The ten inks carry their own colours (`src/game/sim/elements.ts`) and the twenty
discoveries each carry an accent used for their star, their journal medal, and
the rim flash when they are found (`src/game/sim/discoveries.ts`).

## Type

- **UI voice** — the system sans at 800–900 weight. This is what reads as a game
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
  grain and watercolour edge darkening on any cell touching bare paper. The
  mark is deliberately **not** blurred: a cell is only a few device pixels
  wide, so even a one-cell blur turns a pile of sand into a brown cloud and
  destroys the grain. Bilinear magnification supplies exactly enough softness.
  Only the wet halo underneath gets a wide blur.
- **Shelf** (`scene/handDrawn.ts`) — corked bottles drawn for the size they are
  actually seen at, roughly 40 design units: the silhouette is filled with the
  ink itself so the eye reads "the blue one" first, with a darker lower half, a
  meniscus, one specular stripe, a light rim and a lit cork. Locked bottles are
  slate with a hint of their colour — a low-alpha tint just becomes more wood —
  and wear an amber badge in the corner rather than over the middle.
- **Title hero** (`ui/TitleScreen.tsx`) — three SVG bottles and a falling drop.
  This replaced a crop of the store tile, which at hero size was an unreadable
  smear: a screenshot of a simulation is not an illustration.
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
- Picking a bottle *pops* it — a scale overshoot that settles — and lifts it
  onto a bright amber card. The left-right shake is reserved for tapping a
  locked bottle, because a shake universally reads as "no"; using it for
  selection made every pick feel like an error.
  The pop is applied as a **size multiplier, never a scale transform**: Pixi
  composes `scaleTransform` after `translateTransform` such that the existing
  translation is scaled too, which at a shelf y of ~1400 design units threw the
  bottle 200 units down the screen.
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
