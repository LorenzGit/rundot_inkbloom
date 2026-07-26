# Inkbloom

A portrait RUN.world sandbox: ten living inks on a sheet of rag paper, twenty
secrets to catch them keeping. PixiJS 8, WebGPU-first, React 19 shell, RUN Game
SDK 5.24. Derived from `rundot_template`; follow the workspace `AGENTS.md` and
`helper/AGENTS.md` for platform rules.

## Read before changing the renderer

Two non-obvious decisions, both documented at their call sites. Undoing either
one silently breaks the game's entire look:

1. **No Pixi filter on the ink layer.** A filtered display object is composited
   by its filter pass, not by its own blend mode, so a blur over `multiply`
   silhouettes every ink in flat black. Ink composites into an offscreen plate
   with normal blending; the finished plate multiplies onto the paper once.
   Setting `blendMode` on the *container* is worse still — it isolates a render
   group and blends the first child against transparent black.
2. **`SimRandom` is not a second RNG.** It is `NoiseRandom`'s squirrel-noise
   hash with per-call argument validation removed, because the automaton draws
   millions of numbers per second. `npm run simulate` asserts stream parity.
   Never add `Math.random()` — `scripts/check-game.mjs` fails the build on it.

## Boundaries

- `src/game/sim/` is pure and headless: no DOM, no Pixi, no store, no audio. It
  queues discoveries; the scene drains them. Keep it that way — it is what
  makes the headless proof honest.
- `src/game/scene/` owns the canvas and is the only place that reads a pointer.
- `src/state/store.ts` is the React↔Pixi boundary. Nothing per-frame crosses it.
- `src/sdk/runCommerce.ts` holds every call that can cost a player money.
  Ownership is read from host entitlements and never inferred.

## Content rules

- Discovery indices in `src/game/sim/discoveries.ts` are the save format.
  Append; never reorder.
- Every discovery needs a reachability scenario in `scripts/verify-sim.mjs`.
  The invariant check enforces this.
- Ink unlock gates live in `src/game/sim/elements.ts` and must stay below the
  final discovery count.

## Verification

`npm run check` runs format, lint, invariants, the simulation proof, the public
audit, and both production builds. `npm run thumbnail` re-renders the store
tile from the simulation; re-run it after any change to the sim or the colour
rules.

Development contracts (`?screen=`, `?debug=1`, `?qa=1`) must stay
development-only and may never fabricate a RUN ad, purchase, entitlement, or
other privileged outcome.
