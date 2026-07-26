# Inkbloom

**paint inks that live**

A portrait sandbox for RUN.world. Ten inks are poured onto a sheet of rag
paper; they pile, flow, climb, burn, freeze, dissolve and bloom, and where two
of them meet something happens that the page has not told you about yet. There
are twenty of those secrets. Finding them is the whole game.

Built on PixiJS 8 with a WebGPU-first renderer (automatic WebGL fallback),
React 19 for the shell, and RUN Game SDK 5.24.

---

## Playing

Pour an ink. Watch what it does. Pour a second one into it.

- **The shelf** — eleven slots: six inks to start, four more that arrive at
  4, 8, 12 and 16 discoveries, and a kneaded eraser. Below them, the brush size
  and a torn-off sheet to start again.
- **Field Notes** — the counter in the top right opens the journal. Twenty
  lines; the found ones are titled, the rest are blank. Each blank line can be
  nudged, which writes a marginal note next to it — never a recipe.
- **Today's Page** — a short daily brief, drawn only from secrets you already
  know. Keeping it banks a nudge and extends a streak.

Keyboard: `1`–`0` select inks, `E` erases, `B`/space toggles brush size,
`M` mirrors (with the Kit), `X` tears the sheet off, arrows cycle the shelf.

## The twenty secrets

Nothing here should be read before playing. They are enumerated in
`src/game/sim/discoveries.ts`, and every one has a scripted reachability
scenario in `scripts/verify-sim.mjs` — a secret that cannot be found is a
broken promise, and a silent one.

## Architecture

| Path | What lives there |
| --- | --- |
| `src/game/sim/` | The simulation. Pure, headless, deterministic — no canvas, no DOM, no Pixi. This is what `npm run simulate` proves. |
| `src/game/scene/` | The Pixi scene: paper generation, cells-to-pigment, the hand-drawn shelf, layout, and input. |
| `src/systems/` | Progress, save, hints, the daily prompt, monetization, and background services. |
| `src/ui/` | The React shell: title, header, and the four panels. |
| `src/sdk/` | The RUN boundary. `runSdk.ts` for lifecycle and storage; `runCommerce.ts` for anything that costs money. |

Two decisions are worth knowing before touching the renderer, and both are
documented at their call sites:

1. **The ink layer never carries a Pixi filter directly.** A filtered display
   object is composited by its filter pass rather than by its own blend mode, so
   a blur over a `multiply` blend silhouettes every ink in flat black. Ink is
   composited into an offscreen plate with normal blending, and the finished
   plate is multiplied onto the paper once.
2. **The simulation's hot-path RNG is `SimRandom`, not `NoiseRandom`.** It is
   the same squirrel-noise hash with the per-call argument validation removed,
   because the automaton draws millions of numbers a second. `npm run simulate`
   asserts the two produce identical streams, so there is still exactly one
   deterministic random source and no `Math.random()` anywhere in game logic.

## Art direction — Illuminated Marginalia

A naturalist's field journal open on a dark desk under one warm lamp. Printed
serif structure, annotated by a hand that is clearly still working. Everything
is procedural: the paper's fibre, foxing and vignette, the wobbling ruled
borders, the ink bottles, the audio, and `public/thumbnail.jpg` — which is
rendered by the simulation itself, so the store tile cannot drift away from what
the game actually looks like.

Full notes: [`docs/art-direction.md`](docs/art-direction.md).

## Monetization

One product, one ad placement, and a promise printed on the same screen as the
price: every one of the twenty secrets, all ten inks, and the daily page are
free forever. See [`docs/monetization.md`](docs/monetization.md).

## Commands

```sh
npm run dev            # local development on :5184
npm run dev:playground # opt-in RUN Playground (real services, real purchases)
npm run typecheck
npm run simulate       # headless proof: RNG parity, all 20 secrets reachable, determinism
npm run test           # invariants + NoiseRandom + simulate
npm run build          # embedded-libraries production build
npm run build:bundled  # standalone production build
npm run check          # format, lint, test, public audit, both builds
npm run thumbnail      # re-render public/thumbnail.jpg from the simulation
```

`?screen=page|notes|shop|settings|stats` deep-links a screen in development.
`?debug=1` shows runtime diagnostics; `?qa=1` installs the semantic automation
contract. All three are development-only and can never fabricate a RUN outcome.

## Deploying

`game.config.prod.json` still carries `REPLACE_WITH_RUN_GAME_ID`; run
`rundot init` to claim a game id, then upload `rundot/shop.config.json` and
`rundot/liveops.config.json` before the monetization surfaces will do anything
but fail closed. Build immediately before every deploy.
