# Third-party notices

Inkbloom's direct runtime dependencies are distributed under the following
licenses, as declared by the installed packages audited on 2026-07-26:

| Package | Reviewed version | License |
| --- | --- | --- |
| `@series-inc/rundot-game-sdk` | 5.24.0 | MIT |
| `firebase` | 12.16.0 | Apache-2.0 |
| `pixi.js` | 8.19.0 | MIT |
| `react` | 19.2.4 | MIT |
| `react-dom` | 19.2.4 | MIT |

The lockfile also resolves transitive and development dependencies. Their
license texts ship in their npm packages and remain controlling. Re-run a
dependency-license review whenever the lockfile changes, preserve required
copyright and attribution notices, and include applicable notices with any
distributed compiled build. This file does not replace those license texts.

## Development and QA tooling

| Package | Reviewed version | License |
| --- | --- | --- |
| `playwright-core` | 1.62.0 | Apache-2.0 |

Playwright is used for local browser verification (`scripts/visual-qa.mjs` and
related headless checks). It is not included in the compiled game bundle.
