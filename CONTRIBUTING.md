# Contributing to Inkbloom

## Before you start

Read [`AGENTS.md`](AGENTS.md). Two renderer decisions and one randomness rule
are load-bearing and easy to undo by accident.

## Local setup

```sh
npm install
npm run dev
```

If `npm install` fails with `EACCES` or `EEXIST`, the npm cache is partially
root-owned; use `npm install --cache /tmp/inkbloom-npm` or fix the cache
ownership permanently.

## Before opening a change

```sh
npm run check
```

That runs formatting, lint, the invariant suite, the headless simulation proof,
the public-repository audit, and both production builds.

If you touched the simulation or the ink colour rules, also re-render the store
tile so it still matches the game:

```sh
npm run thumbnail
```

## Adding a discovery

1. Append it to `src/game/sim/discoveries.ts`. Never reorder existing entries —
   the indices are the save format.
2. Fire it from the simulation with `this.discover(...)`.
3. Add a reachability scenario to `scripts/verify-sim.mjs`. `npm run simulate`
   must find it, and `npm run test` fails without one.
4. Check the ink unlock gates in `src/game/sim/elements.ts` still make sense.

## What not to do

- Do not add `Math.random()` anywhere in `src/`. Use `NoiseRandom` for ordinary
  logic and `SimRandom` in the automaton's hot path. Web Crypto for identifiers.
- Do not let the simulation import the store, audio, Pixi, or the DOM.
- Do not grant an entitlement, a reward, or a discovery from anything other
  than a verified host outcome or the simulation itself.
- Do not commit credentials, `.env` files, player data, or
  `game.config.playground.json`.
