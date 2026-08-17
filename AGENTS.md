# Inkbloom

A portrait RUN.world sandbox: living inks on a sheet of rag paper, sixty secrets
to catch them keeping. PixiJS 8, WebGPU-first, React 19 shell, RUN Game SDK 5.24.
Derived from `rundot_template`.

Game ID: `gCoSWVsu7MchgqeaLNrM` (also in `game.config.prod.json` and
`src/config/platform.ts`).

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
- Safe-area pixels are published by `applyRunSafeArea` in `src/sdk/runSdk.ts`.
  Prefer measured browser/ViewDeck insets over the mock's tiny defaults; only a
  real attached RUN host overrides them. Always publish resolved `px` values so
  Pixi `readSafeInsets` and CSS agree (`parseFloat` cannot read bare `env()`).

## Content rules

- Discovery indices in `src/game/sim/discoveries.ts` are the save format.
  Append; never reorder.
- Every discovery needs a reachability scenario in `scripts/verify-sim.mjs`.
  The invariant check enforces this.
- Ink unlock gates live in `src/game/sim/elements.ts` and must stay below the
  final discovery count.

## Key art

Masters live in `src/assets/art/`. `npm run thumbnail` re-encodes them into
`public/thumbnail.jpg` (512×512 store tile with the **Inkbloom** wordmark) and
`public/title-hero.jpg`. Do not regenerate the shipping tile from the simulation;
`scripts/thumbnail.html` is local curiosity only.

## Verification

`npm run check` runs format, lint, invariants, the simulation proof, the public
audit, and both production builds.

Development contracts (`?screen=`, `?debug=1`, `?qa=1`) must stay
development-only and may never fabricate a RUN ad, purchase, entitlement, or
other privileged outcome.

## One version

`package.json` is the single version number: the menu renders it and every analytics
event is tagged with it as `build_version`. Once published it must equal the version
RUN serves on the Public tag — never pin it to a separate development track.
`rundot deploy --bump <Major|Minor|Patch>` decides the number; set `package.json` and
`package-lock.json` to it in the same commit as the ship, then verify with
`npm run version:check` (unpublished games pass; needs network, so it sits outside
`npm run check`).
