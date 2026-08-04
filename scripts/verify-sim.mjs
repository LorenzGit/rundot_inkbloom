/**
 * Headless proof for the ink simulation.
 *
 * Two things are verified, both against the exact TypeScript source that ships
 * in the game rather than a parallel JavaScript model:
 *
 *   1. `SimRandom` produces the identical stream as the workspace's
 *      `NoiseRandom` for the same (seed, position). The simulation's hot-path
 *      RNG is an optimisation of that class, not a second algorithm.
 *
 *   2. Every one of the sixty discoveries is actually reachable. Each has a
 *      scripted arrangement of inks; the simulation is stepped and the
 *      discovery must fire. A secret that cannot be found is a broken promise,
 *      and a silent one — this is the only thing that catches it.
 *
 * Run with `npm run simulate`.
 */
import process from "node:process";
import { createServer } from "vite";

const loader = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
});
const { NoiseRandom } = await loader.ssrLoadModule("/src/game/noiseRandom.ts");
const { SimRandom } = await loader.ssrLoadModule("/src/game/sim/simRandom.ts");
const { InkSim } = await loader.ssrLoadModule("/src/game/sim/inkSim.ts");
const { DISCOVERIES } = await loader.ssrLoadModule("/src/game/sim/discoveries.ts");
const { STIRS } = await loader.ssrLoadModule("/src/game/sim/stirs.ts");
const E = await loader.ssrLoadModule("/src/game/sim/elements.ts");
await loader.close();

const WIDTH = 60;
const HEIGHT = 80;
const SEED = 0x1a_c0ff_ee % 0xffff_ffff;

function verifyRandomStreamsMatch() {
    for (const seed of [0, 1, 0x1ac0ffee, 0xffff_ffff]) {
        const reference = new NoiseRandom(seed >>> 0, 0);
        const fast = new SimRandom(seed >>> 0, 0);
        for (let i = 0; i < 4_096; i++) {
            const expected = reference.nextUint();
            const actual = fast.nextUint();
            if (expected !== actual) {
                throw new Error(
                    `SimRandom diverged from NoiseRandom at seed ${seed} step ${i}: ${actual} !== ${expected}`,
                );
            }
        }
        if (reference.position !== fast.position) {
            throw new Error(`SimRandom position drifted at seed ${seed}`);
        }
    }
}

function createPage(seed = SEED) {
    return new InkSim({ width: WIDTH, height: HEIGHT, seed });
}

/** Write cells directly so a scenario sets up an exact arrangement. */
function block(sim, x0, y0, x1, y1, element, life = 0, burn = 0) {
    for (let y = Math.max(0, y0); y <= Math.min(HEIGHT - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(WIDTH - 1, x1); x++) {
            const i = y * WIDTH + x;
            sim.cells[i] = element;
            sim.life[i] = life;
            sim.burn[i] = burn;
        }
    }
}

function run(sim, steps) {
    const found = new Set();
    for (let step = 0; step < steps; step++) {
        sim.step();
        for (const event of sim.takeDiscoveries()) found.add(DISCOVERIES[event.index].id);
    }
    return found;
}

/**
 * One arrangement per secret. `steps` is generous: these prove reachability,
 * not how quickly a player would stumble into it.
 */
const SCENARIOS = [
    {
        id: "silt",
        steps: 400,
        setup(sim) {
            block(sim, 10, 60, 50, 79, E.GRIT);
            block(sim, 20, 40, 40, 45, E.RILL);
        },
    },
    {
        id: "steam",
        steps: 400,
        setup(sim) {
            block(sim, 10, 70, 50, 79, E.RILL);
            block(sim, 20, 66, 40, 68, E.EMBER, 200);
        },
    },
    {
        id: "deep-drink",
        steps: 4_000,
        setup(sim) {
            block(sim, 20, 70, 24, 79, E.BRIAR, 120);
            block(sim, 25, 70, 40, 79, E.RILL);
        },
    },
    {
        id: "blossom",
        steps: 30_000,
        setup(sim) {
            block(sim, 20, 40, 40, 79, E.BRIAR, 200);
        },
    },
    {
        id: "wildfire",
        steps: 600,
        setup(sim) {
            block(sim, 10, 70, 50, 79, E.BRIAR, 100);
            block(sim, 10, 68, 12, 69, E.EMBER, 200);
        },
    },
    {
        id: "flashpoint",
        steps: 600,
        setup(sim) {
            block(sim, 10, 74, 50, 79, E.PITCH);
            block(sim, 10, 72, 12, 73, E.EMBER, 200);
        },
    },
    {
        id: "slick",
        steps: 600,
        setup(sim) {
            block(sim, 20, 40, 40, 76, E.RILL);
            block(sim, 20, 77, 40, 79, E.PITCH);
        },
    },
    {
        id: "fire-on-water",
        steps: 600,
        setup(sim) {
            block(sim, 10, 70, 50, 79, E.RILL);
            block(sim, 10, 68, 50, 69, E.PITCH, 0, 60);
        },
    },
    {
        id: "glass",
        steps: 600,
        setup(sim) {
            block(sim, 10, 70, 50, 79, E.GRIT);
            block(sim, 10, 67, 50, 69, E.EMBER, 250);
        },
    },
    {
        id: "dew",
        steps: 3_000,
        setup(sim) {
            block(sim, 0, 8, WIDTH - 1, 10, E.BASALT);
            block(sim, 10, 11, 50, 20, E.STEAM, 250);
        },
    },
    {
        id: "rain",
        steps: 6_000,
        setup(sim) {
            block(sim, 10, 16, 50, 22, E.HAZE, 240);
        },
    },
    {
        id: "sprout",
        steps: 2_000,
        setup(sim) {
            block(sim, 0, 76, WIDTH - 1, 79, E.BASALT);
            block(sim, 20, 20, 40, 22, E.SPORE);
        },
    },
    {
        id: "ashfall",
        steps: 1_200,
        setup(sim) {
            block(sim, 10, 60, 50, 79, E.BRIAR, 100, 40);
        },
    },
    {
        id: "ice",
        steps: 600,
        setup(sim) {
            block(sim, 10, 70, 50, 79, E.RILL);
            block(sim, 10, 66, 50, 68, E.FROST);
        },
    },
    {
        id: "thaw",
        steps: 900,
        setup(sim) {
            block(sim, 10, 70, 50, 79, E.ICE);
            block(sim, 10, 68, 50, 69, E.EMBER, 250);
        },
    },
    {
        id: "brine",
        steps: 600,
        setup(sim) {
            block(sim, 10, 70, 50, 79, E.RILL);
            block(sim, 10, 66, 50, 68, E.SALT);
        },
    },
    {
        id: "salt-flat",
        steps: 900,
        setup(sim) {
            block(sim, 10, 70, 50, 79, E.BRINE);
            block(sim, 10, 68, 50, 69, E.EMBER, 250);
        },
    },
    {
        id: "withered",
        steps: 4_000,
        setup(sim) {
            block(sim, 20, 70, 24, 79, E.BRIAR, 120);
            block(sim, 25, 70, 45, 79, E.BRINE);
        },
    },
    {
        id: "glowmote",
        steps: 900,
        setup(sim) {
            block(sim, 10, 70, 50, 74, E.BLOSSOM);
            block(sim, 10, 68, 50, 69, E.EMBER, 250);
        },
    },
    {
        id: "rime",
        steps: 900,
        setup(sim) {
            block(sim, 10, 60, 50, 70, E.STEAM, 250);
            block(sim, 10, 55, 50, 59, E.FROST);
        },
    },
    {
        id: "melt",
        steps: 600,
        setup(sim) {
            block(sim, 20, 70, 40, 79, E.WAX);
            block(sim, 24, 67, 36, 69, E.EMBER, 250);
        },
    },
    {
        id: "seal",
        steps: 1_200,
        setup(sim) {
            block(sim, 20, 70, 40, 74, E.MOLTEN);
            block(sim, 20, 75, 40, 79, E.ICE);
        },
    },
    {
        id: "quench",
        steps: 800,
        setup(sim) {
            block(sim, 10, 72, 50, 79, E.RILL);
            block(sim, 20, 66, 40, 70, E.MOLTEN);
        },
    },
    {
        id: "taper",
        steps: 1_500,
        setup(sim) {
            block(sim, 20, 70, 40, 79, E.MOLTEN);
            block(sim, 24, 70, 30, 72, E.PITCH, 0, 30);
        },
    },
    {
        id: "wick",
        steps: 1_500,
        setup(sim) {
            block(sim, 20, 70, 40, 79, E.MOLTEN);
            block(sim, 24, 66, 34, 69, E.BRIAR, 60, 90);
        },
    },
    {
        id: "creep",
        steps: 2_000,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.BASALT);
            block(sim, 28, 69, 30, 69, E.MOSS);
        },
    },
    {
        // A walled basin, so the water cannot simply run away from the moss.
        // An open row lets both drift apart and the contact never lasts.
        id: "verdant",
        steps: 3_000,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.BASALT);
            block(sim, 5, 55, 6, 69, E.BASALT);
            block(sim, 54, 55, 55, 69, E.BASALT);
            block(sim, 7, 69, 9, 69, E.MOSS);
            block(sim, 10, 64, 53, 69, E.RILL);
        },
    },
    {
        id: "scorch",
        steps: 2_000,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.BASALT);
            block(sim, 10, 69, 50, 69, E.MOSS);
            block(sim, 10, 68, 12, 68, E.EMBER, 250);
        },
    },
    {
        id: "peat",
        steps: 2_000,
        setup(sim) {
            block(sim, 5, 72, 55, 79, E.SILT);
            block(sim, 20, 71, 40, 71, E.MOSS);
        },
    },
    {
        id: "bogfire",
        steps: 3_000,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.PEAT);
            block(sim, 20, 68, 24, 69, E.EMBER, 250);
        },
    },
    {
        id: "fume",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.BASALT);
            block(sim, 20, 66, 40, 69, E.ACID);
        },
    },
    {
        id: "firedamp",
        steps: 3_000,
        setup(sim) {
            block(sim, 5, 72, 55, 79, E.BASALT);
            block(sim, 20, 68, 40, 71, E.ACID);
            block(sim, 20, 40, 40, 44, E.EMBER, 250);
        },
    },
    {
        id: "etched",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.GLASS);
            block(sim, 20, 66, 40, 69, E.ACID);
        },
    },
    {
        id: "neutral",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.SALT);
            block(sim, 20, 66, 40, 69, E.ACID);
        },
    },
    {
        id: "scour",
        steps: 1_500,
        setup(sim) {
            block(sim, 20, 70, 40, 79, E.BRIAR, 120);
            block(sim, 20, 66, 40, 69, E.ACID);
        },
    },
    {
        id: "quickbead",
        steps: 800,
        setup(sim) {
            block(sim, 5, 60, 55, 79, E.RILL);
            block(sim, 26, 50, 34, 55, E.QUICK);
        },
    },
    {
        id: "sinkhole",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 60, 55, 79, E.GRIT);
            block(sim, 26, 50, 34, 55, E.QUICK);
        },
    },
    {
        id: "quicksand",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 60, 55, 79, E.SILT);
            block(sim, 26, 50, 34, 55, E.QUICK);
        },
    },
    {
        id: "amalgam",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 60, 55, 79, E.GRIT);
            block(sim, 26, 50, 34, 58, E.QUICK);
        },
    },
    {
        id: "mirrorstone",
        steps: 2_500,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.AMALGAM);
            block(sim, 20, 66, 40, 69, E.ACID);
        },
    },
    {
        id: "kindle",
        steps: 1_200,
        setup(sim) {
            block(sim, 20, 70, 40, 79, E.BRIAR, 120);
            block(sim, 20, 66, 40, 69, E.MAGMA);
        },
    },
    {
        id: "basaltflow",
        steps: 1_500,
        setup(sim) {
            block(sim, 20, 70, 40, 79, E.MAGMA);
        },
    },
    {
        id: "obsidian",
        steps: 800,
        setup(sim) {
            block(sim, 10, 72, 50, 79, E.RILL);
            block(sim, 20, 66, 40, 70, E.MAGMA);
        },
    },
    {
        id: "crucible",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.GRIT);
            block(sim, 20, 66, 40, 69, E.MAGMA);
        },
    },
    {
        id: "smelt",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.AMALGAM);
            block(sim, 20, 66, 40, 69, E.MAGMA);
        },
    },
    {
        id: "resinset",
        steps: 1_500,
        setup(sim) {
            block(sim, 20, 70, 40, 79, E.RESIN);
        },
    },
    {
        id: "inclusion",
        steps: 1_200,
        setup(sim) {
            block(sim, 5, 74, 55, 79, E.BASALT);
            block(sim, 20, 72, 40, 73, E.BLOSSOM);
            block(sim, 20, 66, 40, 71, E.RESIN);
        },
    },
    {
        id: "sapfire",
        steps: 1_500,
        setup(sim) {
            block(sim, 20, 70, 40, 79, E.RESIN);
            block(sim, 24, 70, 30, 72, E.PITCH, 0, 30);
        },
    },
    {
        id: "stuck",
        steps: 2_000,
        setup(sim) {
            block(sim, 5, 74, 55, 79, E.BASALT);
            block(sim, 10, 68, 50, 73, E.RESIN);
            block(sim, 20, 64, 40, 67, E.GRIT);
        },
    },
    {
        id: "arc",
        steps: 1_000,
        setup(sim) {
            block(sim, 5, 74, 55, 79, E.BASALT);
            block(sim, 10, 70, 50, 73, E.QUICK);
            block(sim, 26, 66, 34, 69, E.VOLT, 120);
        },
    },
    {
        id: "brinearc",
        steps: 1_000,
        setup(sim) {
            block(sim, 5, 74, 55, 79, E.BASALT);
            block(sim, 10, 70, 50, 73, E.BRINE);
            block(sim, 26, 66, 34, 69, E.VOLT, 120);
        },
    },
    {
        id: "fulgurite",
        steps: 1_000,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.GRIT);
            block(sim, 20, 66, 40, 69, E.VOLT, 120);
        },
    },
    {
        id: "electrolysis",
        steps: 1_000,
        setup(sim) {
            block(sim, 5, 74, 55, 79, E.BASALT);
            block(sim, 10, 70, 50, 73, E.RILL);
            block(sim, 26, 66, 34, 69, E.VOLT, 120);
        },
    },
    {
        id: "shockbloom",
        steps: 1_000,
        setup(sim) {
            block(sim, 20, 70, 40, 79, E.BRIAR, 120);
            block(sim, 20, 66, 40, 69, E.VOLT, 120);
        },
    },
    {
        id: "welded",
        steps: 1_000,
        setup(sim) {
            block(sim, 5, 70, 55, 79, E.AMALGAM);
            block(sim, 20, 66, 40, 69, E.VOLT, 120);
        },
    },
    {
        id: "scatter",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 74, 55, 79, E.BASALT);
            block(sim, 24, 70, 30, 73, E.GRIT);
            block(sim, 20, 70, 22, 73, E.GUST, 90);
        },
    },
    {
        id: "fanned",
        steps: 1_200,
        setup(sim) {
            block(sim, 5, 74, 55, 79, E.BASALT);
            block(sim, 26, 70, 34, 73, E.EMBER, 200);
            block(sim, 20, 70, 24, 73, E.GUST, 120);
        },
    },
    {
        id: "snuffed",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 74, 55, 79, E.BASALT);
            block(sim, 26, 70, 34, 73, E.EMBER, 200);
            // A gust already almost spent: a strong one would feed the fire.
            block(sim, 20, 70, 24, 73, E.GUST, 10);
        },
    },
    {
        // Spores root the instant they touch a floor, so a gust can only carry
        // one that is still in the air. Rain them through a standing band.
        id: "drift",
        steps: 2_000,
        setup(sim) {
            block(sim, 5, 78, 55, 79, E.BASALT);
            block(sim, 12, 34, 48, 44, E.GUST, 200);
            block(sim, 20, 12, 40, 20, E.SPORE);
        },
    },
    {
        id: "dustdevil",
        steps: 1_500,
        setup(sim) {
            block(sim, 5, 74, 55, 79, E.BASALT);
            block(sim, 24, 70, 34, 73, E.SILT);
            block(sim, 18, 70, 22, 73, E.GUST, 120);
        },
    },
];

function verifyEveryDiscoveryIsReachable() {
    const missing = [];
    const stepsTaken = {};
    for (const scenario of SCENARIOS) {
        const sim = createPage();
        scenario.setup(sim);
        const found = run(sim, scenario.steps);
        stepsTaken[scenario.id] = scenario.steps;
        if (!found.has(scenario.id)) missing.push(scenario.id);
    }
    const covered = new Set(SCENARIOS.map((scenario) => scenario.id));
    const uncovered = DISCOVERIES.filter((entry) => !covered.has(entry.id)).map((entry) => entry.id);
    if (uncovered.length > 0) throw new Error(`Discoveries with no reachability scenario: ${uncovered.join(", ")}`);
    if (missing.length > 0) throw new Error(`Discoveries that never fired: ${missing.join(", ")}`);
    return stepsTaken;
}

/** Identical seeds must replay identically, or saved pages diverge on reload. */
function verifyDeterminism() {
    const fingerprint = () => {
        const sim = createPage(0x5eed_1234);
        block(sim, 5, 30, 55, 40, E.GRIT);
        block(sim, 5, 10, 55, 20, E.RILL);
        block(sim, 20, 60, 40, 79, E.BRIAR, 150);
        block(sim, 24, 55, 26, 56, E.EMBER, 220);
        run(sim, 1_500);
        let hash = 0x811c_9dc5;
        for (let i = 0; i < sim.cellCount; i++) {
            hash = Math.imul(hash ^ (sim.cells[i] ?? 0), 0x0100_0193) >>> 0;
        }
        return { hash, position: sim.random.position, discoveries: sim.discoveryCount };
    };
    const first = fingerprint();
    const second = fingerprint();
    if (JSON.stringify(first) !== JSON.stringify(second)) {
        throw new Error("Identical seeds produced different pages");
    }
    return first;
}

/** A page left alone must settle, or the simulation never stops costing power. */
function verifySettling() {
    const sim = createPage();
    block(sim, 10, 20, 50, 30, E.GRIT);
    block(sim, 10, 5, 50, 12, E.RILL);
    run(sim, 4_000);
    const before = sim.liveCount;
    run(sim, 600);
    if (sim.burningCount !== 0) throw new Error("A page with no fuel is still burning after 4600 steps");
    if (sim.liveCount !== before) throw new Error("A settled page is still changing its material count");
    return { liveCount: sim.liveCount };
}

/**
 * The stir table must cover every discovery with real elements.
 *
 * A discovery missing from the table can never make the page stir — the tell
 * silently goes cold for exactly that secret, which no screenshot or
 * playthrough would ever pin down. Element ids are checked against
 * ELEMENT_COUNT so a typo cannot point a stir at an element that does not
 * exist.
 */
function verifyStirTableCoversEveryDiscovery() {
    const missing = [];
    for (const discovery of DISCOVERIES) {
        const sets = STIRS.get(discovery.id);
        if (!sets || sets.length === 0) {
            missing.push(discovery.id);
            continue;
        }
        for (const set of sets) {
            if (set.length === 0) throw new Error(`Stir entry for "${discovery.id}" has an empty element set`);
            for (const element of set) {
                if (!Number.isInteger(element) || element <= 0 || element >= E.ELEMENT_COUNT) {
                    throw new Error(`Stir entry for "${discovery.id}" names invalid element ${element}`);
                }
            }
        }
    }
    if (missing.length > 0) throw new Error(`Discoveries with no stir entry: ${missing.join(", ")}`);
    const orphans = [...STIRS.keys()].filter((id) => !DISCOVERIES.some((discovery) => discovery.id === id));
    if (orphans.length > 0) throw new Error(`Stir entries for unknown discoveries: ${orphans.join(", ")}`);
    return { entries: STIRS.size };
}

verifyRandomStreamsMatch();
const stirTable = verifyStirTableCoversEveryDiscovery();
const reachability = verifyEveryDiscoveryIsReachable();
const determinism = verifyDeterminism();
const settling = verifySettling();

console.log(
    JSON.stringify(
        {
            randomStream: "SimRandom matches NoiseRandom",
            discoveries: DISCOVERIES.length,
            reachable: Object.keys(reachability).length,
            stirTable,
            determinism,
            settling,
        },
        null,
        2,
    ),
);

if (process.exitCode === undefined) process.exitCode = 0;
