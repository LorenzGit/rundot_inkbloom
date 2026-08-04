/**
 * Inkbloom's invariants.
 *
 * These are the rules that are easy to break quietly and expensive to notice
 * later: a discovery that no longer matches its save id, a monetization surface
 * that stopped failing closed, template identity left behind in a shipped
 * string, or `Math.random()` sneaking into game logic.
 *
 * Gameplay correctness lives in `scripts/verify-sim.mjs`; this file is about
 * the contracts around it.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expect(condition, message) {
    if (!condition) failures.push(message);
}

function sourceFiles(directory) {
    const absolute = path.join(root, directory);
    if (!fs.existsSync(absolute)) return [];
    return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(relative);
        return /\.(?:ts|tsx)$/.test(entry.name) ? [relative] : [];
    });
}

const allSources = sourceFiles("src");
const packageJson = JSON.parse(read("package.json"));

// ------------------------------------------------------------------ identity

expect(packageJson.name === "inkbloom", "package name must be inkbloom");
expect(packageJson.private === true, "package.json must stay private");
expect(!("three" in (packageJson.dependencies ?? {})), "three is not used by this game and must not be a dependency");

const identityLeaks = [/PIXEL\s*FOUNDRY/i, /rundot_template/, /template-pixi/, /Pixel Foundry/i];
for (const relativePath of [...allSources, "index.html", "src/assets/strings.csv", "src/styles/app.css"]) {
    const contents = read(relativePath);
    for (const leak of identityLeaks) {
        expect(!leak.test(contents), `${relativePath} still contains template identity (${leak})`);
    }
}

const gameConfig = JSON.parse(read("game.config.prod.json"));
expect(gameConfig.orientation === "Portrait", "game.config.prod.json must declare Portrait");
expect(Array.isArray(gameConfig.keywords) && gameConfig.keywords.length >= 4, "catalog keywords are required");

// ----------------------------------------------------------------- randomness

/** Strip comments so a rule *documented* in prose is not mistaken for a breach. */
function code(relativePath) {
    return read(relativePath)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

for (const relativePath of allSources) {
    expect(
        !/Math\.random\s*\(/.test(code(relativePath)),
        `${relativePath} uses Math.random(); game logic must use NoiseRandom or SimRandom`,
    );
}
expect(
    /squirrel|NoiseRandom/i.test(read("src/game/sim/simRandom.ts")),
    "simRandom.ts must document that it is NoiseRandom's algorithm, not a second one",
);

// ----------------------------------------------------------------- discovery

const discoveries = read("src/game/sim/discoveries.ts");
const ids = [...discoveries.matchAll(/^\s+id:\s+"([a-z-]+)",$/gm)].map((match) => match[1]);
expect(ids.length === 60, `expected 60 discoveries, found ${ids.length}`);
expect(new Set(ids).size === ids.length, "discovery ids must be unique");
for (const id of ids) {
    expect(
        new RegExp(`"${id}"`).test(read("scripts/verify-sim.mjs")),
        `discovery "${id}" has no reachability scenario in verify-sim.mjs`,
    );
}
expect(/Append new entries; never reorder/.test(discoveries), "discoveries.ts must keep its save-format warning");

const elements = read("src/game/sim/elements.ts");
const unlockGates = [...elements.matchAll(/unlockAt:\s*(\d+)/g)].map((match) => Number(match[1]));
expect(
    unlockGates.some((gate) => gate === 4),
    "an ink must unlock at 4 discoveries",
);
expect(Math.max(...unlockGates) < ids.length, "no ink may gate behind the final discovery");

// -------------------------------------------------------------- monetization

const monetization = read("src/systems/monetization.ts");
expect(/getEntitlementQuantity/.test(monetization), "ownership must be read from host entitlements");
expect(
    /if \(quantity === null\) return previous;/.test(monetization),
    "an unreachable host must not revoke or grant ownership",
);
expect(/outcome !== "verified"/.test(monetization), "a rewarded nudge must only be granted on a verified host outcome");

const platform = read("src/config/platform.ts");
expect(/REPLACE_WITH_RUN_GAME_ID/.test(platform), "gameId placeholder must survive until `rundot init` runs");
expect(/inkbloom_illuminators_kit/.test(platform), "the Kit product id must be self-authored and stable");

expect(/inkbloom_pot_of_ink/.test(platform), "the pot product id must be self-authored and stable");
expect(/inkbloom_borrow_ink_rewarded/.test(platform), "the borrow placement id must be self-authored and stable");

// Looked up by id, never by position. This used to read `items[0]` and broke
// the moment a second product sorted above the Kit.
const shopConfig = JSON.parse(read("rundot/shop.config.json"));
const shopItem = (id) => shopConfig.items?.find((entry) => entry.itemId === id);

const kit = shopItem("inkbloom_illuminators_kit");
expect(kit !== undefined, "shop config must define the Kit");
expect(
    kit?.entitlements?.[0]?.entitlementId === "inkbloom_illuminators_kit" && kit.entitlements[0].consumable === false,
    "the Kit must grant a non-consumable entitlement matching platform.ts",
);
expect(kit?.unique === true, "the Kit is a one-time purchase and must be unique");

const pot = shopItem("inkbloom_pot_of_ink");
expect(pot !== undefined, "shop config must define the Pot of Ink");
expect(
    pot?.entitlements?.[0]?.entitlementId === "inkbloom_nudges" && pot.entitlements[0].consumable === true,
    "the pot must grant a consumable nudge entitlement matching platform.ts",
);
expect(pot?.unique === false, "a pot is repeatable — a second one adds to the same balance");
const potQuantity = Number(pot?.entitlements?.[0]?.quantity);
expect(
    potQuantity === Number(/POT_NUDGE_QUANTITY = (\d+)/.exec(read("src/systems/monetizationConfig.ts"))?.[1]),
    "the pot's catalog quantity must match POT_NUDGE_QUANTITY",
);
for (const item of shopConfig.items ?? []) {
    expect(item.price?.type === "bucks", `${item.itemId} must be priced in Run Bits`);
    expect(Number(item.price?.value) > 0, `${item.itemId} must carry a real launch price, not a QA value`);
}

const liveOps = JSON.parse(read("rundot/liveops.config.json"));
const monetizationConfig = liveOps.client?.values?.inkbloom_monetization;
expect(monetizationConfig?.interstitialAdsEnabled === false, "this game ships no interstitials");
expect(
    monetizationConfig?.placements?.margin_nudge?.dailyCap === 3,
    "the rewarded nudge daily cap must match the shipped design",
);
// Flags that do not ship leave the surface dark even with real ids, which is
// how a game launches with monetization unintentionally off.
expect(monetizationConfig?.placements?.borrow_ink?.enabled === true, "the borrow placement must ship enabled");
expect(monetizationConfig?.products?.pot_of_ink?.enabled === true, "the pot product must ship enabled");

expect(
    /const left = await consumeEntitlement/.test(monetization),
    "a bought nudge must be spent through the server, never decremented locally",
);
expect(
    /if \(left === null\) return "unavailable";/.test(monetization),
    "an unreachable host must not spend a pot nudge",
);
expect(
    /const spent = await spendPotNudge\(\);/.test(read("src/systems/hints.ts")),
    "a pot nudge must be charged before the note is revealed",
);

// --------------------------------------------------------------- presentation

const css = read("src/styles/app.css");
expect(/prefers-reduced-motion/.test(css), "a reduced-motion treatment is required");
expect(/user-select: none/.test(css), "text selection must be disabled across the game surface");
expect(/env\(safe-area-inset-top/.test(css), "safe-area fallbacks are required");

const main = read("src/main.tsx");
for (const guard of ["selectstart", "contextmenu", "dragstart"]) {
    expect(main.includes(guard), `main.tsx must prevent the ${guard} browser gesture`);
}
expect(/unhandledrejection/.test(main), "the RUN unhandled-rejection guard must stay installed");

const thumbnail = path.join(root, "public", "thumbnail.jpg");
expect(fs.existsSync(thumbnail), "public/thumbnail.jpg is required");
if (fs.existsSync(thumbnail)) {
    expect(fs.statSync(thumbnail).size > 8_000, "thumbnail.jpg looks like a placeholder");
}

// ------------------------------------------------------------------- results

if (failures.length > 0) {
    console.error(`Inkbloom invariants failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
} else {
    console.log(`Inkbloom invariants passed: ${allSources.length} source files, ${ids.length} discoveries.`);
}
