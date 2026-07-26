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

/** Paint a few strokes so the page screenshot shows actual ink. */
const PAINT = `() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return "no canvas";
    const rect = canvas.getBoundingClientRect();
    const send = (target, type, x, y) =>
        target.dispatchEvent(
            new PointerEvent(type, { pointerId: 1, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true }),
        );
    const pitch = rect.width / 11;
    const row = rect.height - 150;
    const pick = (slot) => { send(canvas, "pointerdown", pitch * (slot + 0.5), row); send(window, "pointerup", pitch * (slot + 0.5), row); };
    const stroke = (fraction, from, to) => {
        const y = rect.top + rect.height * (0.09 + fraction * 0.68);
        send(canvas, "pointerdown", rect.left + rect.width * from, y);
        for (let step = 0; step <= 30; step++) send(window, "pointermove", rect.left + rect.width * (from + (to - from) * (step / 30)), y);
        send(window, "pointerup", rect.left + rect.width * to, y);
    };
    pick(3); for (const f of [0.99, 0.95, 0.91]) stroke(f, 0.08, 0.92);
    pick(1); stroke(0.24, 0.10, 0.50);
    pick(0); stroke(0.42, 0.52, 0.92);
    pick(2); stroke(0.84, 0.80, 0.94);
    return "painted";
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
