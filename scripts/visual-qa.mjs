/**
 * Headless visual QA.
 *
 * Boots a dev server, drives the game through its screens at a phone viewport,
 * and writes PNGs to `tmp/visual-qa/`. Fails the run if any page error is
 * logged — a Pixi scene that throws during construction leaves a blank canvas
 * with the React shell still rendering on top, which is exactly the failure
 * that is easiest to miss by eye and most obvious here.
 *
 *   node scripts/visual-qa.mjs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = process.cwd();
const outputDir = path.join(root, "tmp", "visual-qa");
const PORT = 5392;
const VIEWPORT = { width: 393, height: 852 };

/**
 * `page` is reached by pressing the real button rather than by the `?screen=`
 * deep link. That distinction matters: the button is what mounts the canvas
 * host, and a renderer that fails to come up in that window leaves a blank
 * canvas under a perfectly healthy React shell. Deep-linking past it hides
 * exactly the bug most worth catching.
 */
const SHOTS = [
    { name: "01-title", screen: "" },
    { name: "02-page", screen: "", pressStart: true },
    { name: "03-field-notes", screen: "notes" },
    { name: "04-kit", screen: "shop" },
    { name: "05-settings", screen: "settings" },
    { name: "06-record", screen: "stats" },
];

/**
 * Paint a few strokes so the page screenshot shows actual ink.
 *
 * Ink slots are located through the QA contract rather than by arithmetic on
 * the canvas size. Hard-coded shelf coordinates have silently rotted twice now:
 * the taps land on the wrong control, the strokes come out in the wrong ink,
 * and the run still "passes".
 */
const PAINT = `() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return "no canvas";
    const slots = window.__gameQa?.shelfSlots?.() ?? [];
    if (slots.length === 0) return "no shelf geometry";
    const sheet = window.__gameQa?.pageRect?.();
    if (!sheet) return "no page geometry";
    const rect = canvas.getBoundingClientRect();
    const send = (target, type, x, y) =>
        target.dispatchEvent(
            new PointerEvent(type, { pointerId: 1, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true }),
        );
    const pick = (index) => {
        const slot = slots.find((entry) => entry.kind === "ink" && entry.index === index);
        if (!slot) return false;
        send(canvas, "pointerdown", rect.left + slot.x, rect.top + slot.y);
        send(window, "pointerup", rect.left + slot.x, rect.top + slot.y);
        return true;
    };
    // Fractions are of the *sheet*, not the viewport: the shelf has grown
    // twice now, and both times viewport fractions quietly walked the strokes
    // off the paper while the run kept reporting success.
    const stroke = (fraction, from, to) => {
        const y = rect.top + sheet.y + sheet.height * fraction;
        const sx = (t) => rect.left + sheet.x + sheet.width * t;
        send(canvas, "pointerdown", sx(from), y);
        for (let step = 0; step <= 30; step++) send(window, "pointermove", sx(from + (to - from) * (step / 30)), y);
        send(window, "pointerup", sx(to), y);
    };
    if (!pick(3)) return "no briar slot";
    for (const f of [0.96, 0.92, 0.88]) stroke(f, 0.08, 0.92);
    pick(1); stroke(0.22, 0.10, 0.50);
    pick(0); stroke(0.40, 0.52, 0.92);
    pick(2); stroke(0.82, 0.80, 0.94);
    return "painted";
}`;

/**
 * Make the page as loud as it ever gets, and measure it.
 *
 * Every continuous sound at once — a burning thicket plus a nib dragged across
 * the sheet — because that is the state a player described as noise. Measuring
 * an idle page measures the analyser's floor instead of the game.
 */
const MEASURE_LOUD = `async () => {
    const canvas = document.querySelector("canvas");
    const rect = canvas.getBoundingClientRect();
    const sheet = window.__gameQa.pageRect();
    const slots = window.__gameQa.shelfSlots();
    const send = (target, type, x, y) =>
        target.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const pick = (index) => {
        const slot = slots.find((entry) => entry.kind === "ink" && entry.index === index);
        send(canvas, "pointerdown", rect.left + slot.x, rect.top + slot.y);
        send(window, "pointerup", rect.left + slot.x, rect.top + slot.y);
    };
    const at = (t) => rect.left + sheet.x + sheet.width * t;
    const stroke = (fraction, from, to) => {
        const y = rect.top + sheet.y + sheet.height * fraction;
        send(canvas, "pointerdown", at(from), y);
        for (let step = 0; step <= 40; step++) send(window, "pointermove", at(from + (to - from) * (step / 40)), y);
        send(window, "pointerup", at(to), y);
    };
    pick(3);
    for (const f of [0.55, 0.63, 0.71, 0.79, 0.87, 0.95]) stroke(f, 0.04, 0.96);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    pick(2);
    stroke(0.5, 0.04, 0.96);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const measuring = window.__gameQa.measureAudio(2200);
    const y0 = rect.top + sheet.y + sheet.height * 0.3;
    pick(0);
    send(canvas, "pointerdown", at(0.05), y0);
    for (let step = 0; step < 200; step++) {
        send(window, "pointermove", at(0.05 + 0.9 * ((step % 40) / 40)), y0 + (step / 200) * sheet.height * 0.35);
        if (step % 6 === 0) await new Promise((resolve) => setTimeout(resolve, 14));
    }
    send(window, "pointerup", at(0.95), y0);
    return await measuring;
}`;

fs.mkdirSync(outputDir, { recursive: true });

const server = await createServer({
    configFile: path.join(root, "vite.config.js"),
    logLevel: "silent",
    server: { port: PORT, strictPort: true },
});
await server.listen();

let browser;
const problems = [];
try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() === "error") problems.push(`console error: ${message.text()}`);
    });

    for (const shot of SHOTS) {
        const query = shot.screen ? `?screen=${shot.screen}&qa=1` : "?qa=1";
        await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: "load" });
        await page.waitForTimeout(600);
        if (shot.pressStart) {
            await page.getByRole("button", { name: /START PAINTING|KEEP PAINTING/i }).click();
            // The canvas mounts asynchronously once the renderer resolves.
            await page.waitForSelector("canvas", { timeout: 10_000 });
            await page.waitForTimeout(900);

            // `evaluate` on a string evaluates it as an *expression*, which
            // yields the function rather than calling it. Invoke it.
            const painted = await page.evaluate(`(${PAINT})()`);
            if (painted !== "painted") problems.push(`could not paint the page: ${String(painted)}`);
            await page.waitForTimeout(1_600);

            // Proof that input reached the simulation and the simulation
            // reacted: the scripted strokes plant a briar and set it alight,
            // which always produces discoveries.
            //
            // Deliberately not a pixel check — reading the canvas back through
            // a 2D context returns blank on WebGL without `preserveDrawingBuffer`,
            // so that test would pass or fail for the wrong reason. Whether the
            // frame actually *drew* is covered by the error capture above, by
            // the renderer probe in `pixiApp.ts`, and by looking at the PNGs.
            const found = await page.evaluate(() => window.__gameQa?.snapshot()?.discoveries ?? -1);
            if (typeof found !== "number" || found < 1) {
                problems.push(`painting produced no discoveries (${String(found)}) — input or simulation is broken`);
            }

            // Bare plank under the last control reads as an unfinished screen
            // and is easy to introduce by changing the row maths in one place
            // and the height maths in another.
            const sheet = await page.evaluate(() => window.__gameQa?.pageRect() ?? null);
            if (sheet) {
                // The bottom inset is reserved on purpose — a home indicator
                // sits there — so only the padding beyond it is slack.
                const slack = VIEWPORT.height - sheet.shelfContentBottom - sheet.safeBottom;
                if (slack > 26) problems.push(`${slack.toFixed(0)}px of empty shelf below the last control`);
                if (slack < 0) problems.push(`shelf controls run ${(-slack).toFixed(0)}px off the bottom`);
            } else {
                problems.push("the scene published no page geometry");
            }

            // What the game actually sounds like, as a number.
            //
            // Spectral flatness is 1.0 for white noise and falls toward 0 as a
            // signal becomes tonal, so "it sounds like noise" is measurable
            // rather than a matter of taste. Measured over a burning page —
            // the state where every continuous sound is running at once — the
            // shipped mix measures ~1.1e-5 flatness at a ~415Hz centroid. The
            // broadband synthesis it replaced measured 2.0e-4 at 1068Hz —
            // twenty times flatter and an octave brighter — and that is what a
            // player heard as static. Both thresholds sit between the two, so
            // this catches a regression back to hiss without policing tuning.
            const spectrum = await page.evaluate(`(${MEASURE_LOUD})()`);
            if (!spectrum || spectrum.samples < 4) {
                // Not a verdict on the mix: the scenario failed to make the
                // page loud, so there is nothing to judge and saying "fine"
                // would be covering nothing.
                problems.push(`audio measurement got ${spectrum?.samples ?? 0} loud windows — the scenario is wrong`);
            } else {
                if (spectrum.flatness > 8e-5) {
                    problems.push(`audio spectral flatness ${spectrum.flatness.toExponential(2)} — the mix is hissy`);
                }
                if (spectrum.centroid > 900) {
                    problems.push(`audio centroid ${spectrum.centroid.toFixed(0)}Hz — the mix is too bright`);
                }
            }

            // The borrow offer: a surface reached only by tapping a locked
            // bottle, which no other shot in this run does.
            await page.evaluate(() => window.__gameQa?.openBorrowOffer(6));
            await page.waitForTimeout(300);
            const offerOpen = await page.evaluate(() => document.querySelectorAll(".borrow-sheet").length);
            if (offerOpen !== 1) problems.push(`borrow offer did not render (${offerOpen} sheets)`);
            const granted = await page.evaluate(() => window.__gameQa?.snapshot()?.borrowedInk ?? null);
            if (granted !== null) problems.push("opening the borrow offer granted the loan without an ad");
            await page.screenshot({ path: path.join(outputDir, "07-borrow-offer.png") });
            await page.evaluate(() => window.__gameQa?.openPage());
            await page.waitForTimeout(200);

            // Audio, at the two moments it has actually gone wrong: a page busy
            // enough to be making every continuous sound at once, and the trip
            // back to the menu afterwards.
            //
            // `activeVoices` is the real assertion. The page voice is a
            // permanent looping source gated only by a bus gain, so nothing
            // about destroying the Pixi scene stopped it — the bed droned on
            // through the main menu. A screenshot cannot see that; this can.
            const busy = await page.evaluate(() => window.__gameQa?.snapshot()?.audio ?? null);
            if (!busy) {
                problems.push("no audio snapshot while painting");
            } else if (busy.activeVoices > 14) {
                problems.push(`${busy.activeVoices} audio voices on a busy page — the voice budget is not holding`);
            }

            await page.evaluate(() => window.__gameQa?.returnToTitle());
            await page.waitForTimeout(400);
            const quiet = await page.evaluate(() => window.__gameQa?.snapshot()?.audio ?? null);
            if (!quiet) {
                problems.push("no audio snapshot after returning to the title");
            } else {
                if (!quiet.pageSilent) problems.push("the page was not silenced on the way back to the menu");
                if (quiet.pageVoiceGain > 0) {
                    problems.push(`page voice still open at ${quiet.pageVoiceGain} on the title screen`);
                }
            }
            await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: "load" });
            await page.waitForTimeout(400);
            await page.getByRole("button", { name: /START PAINTING|KEEP PAINTING/i }).click();
            await page.waitForSelector("canvas", { timeout: 10_000 });
            await page.waitForTimeout(600);

            // A number that overflows its own badge reads as a rendering bug
            // and is invisible to everything except a person squinting at a
            // screenshot. It has happened twice.
            const badges = await page.evaluate(() => window.__gameQa?.lockBadges() ?? []);
            if (!Array.isArray(badges) || badges.length === 0) {
                problems.push("no locked bottles published a badge — the check is covering nothing");
            }
            for (const badge of badges) {
                const padX = badge.pill.width / 2 - badge.text.width / 2;
                const padY = badge.pill.height / 2 - badge.text.height / 2;
                if (padX < 2) problems.push(`lock badge ${badge.index}: number overflows the pill sideways`);
                if (padY < 2) problems.push(`lock badge ${badge.index}: number overflows the pill vertically`);
            }

            // Overlapping controls are invisible to a screenshot diff and
            // obvious to arithmetic. Check every pair in a row.
            const slots = await page.evaluate(() => window.__gameQa?.shelfSlots() ?? []);
            if (!Array.isArray(slots) || slots.length === 0) {
                problems.push("the shelf published no geometry");
            }
            for (let a = 0; a < slots.length; a++) {
                for (let b = a + 1; b < slots.length; b++) {
                    const first = slots[a];
                    const second = slots[b];
                    const overlapX = Math.abs(first.x - second.x) < (first.width + second.width) / 2 - 0.5;
                    const overlapY = Math.abs(first.y - second.y) < (first.height + second.height) / 2 - 0.5;
                    if (overlapX && overlapY) {
                        problems.push(
                            `shelf controls overlap: ${first.kind}@${first.x.toFixed(0)} and ` +
                                `${second.kind}@${second.x.toFixed(0)}`,
                        );
                    }
                }
            }
        } else {
            await page.waitForTimeout(500);
        }
        await page.screenshot({ path: path.join(outputDir, `${shot.name}.png`) });
        console.log(`captured ${shot.name}`);
    }
} finally {
    await browser?.close();
    await server.close();
}

if (problems.length > 0) {
    console.error(`Visual QA found ${problems.length} runtime problem(s):`);
    for (const problem of [...new Set(problems)]) console.error(`- ${problem}`);
    process.exitCode = 1;
} else {
    console.log(`Visual QA clean. Screenshots in ${path.relative(root, outputDir)}/`);
}
