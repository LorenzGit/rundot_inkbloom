/**
 * Render `public/thumbnail.jpg` from the game's own simulation.
 *
 * Boots a Vite dev server, opens `scripts/thumbnail.html` in headless Chromium,
 * and writes the canvas out as a 512x512 JPEG. Deterministic: the composition
 * is seeded, so re-running this produces a byte-identical tile until the
 * simulation or the colour rules actually change — which is the point. The
 * store tile can never drift away from what the game looks like.
 *
 *   node scripts/make-thumbnail.mjs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = process.cwd();
const output = path.join(root, "public", "thumbnail.jpg");
const PORT = 5391;

const server = await createServer({
    configFile: path.join(root, "vite.config.js"),
    logLevel: "silent",
    server: { port: PORT, strictPort: true },
});
await server.listen();

let browser;
try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 1 });
    const failures = [];
    page.on("pageerror", (error) => failures.push(String(error)));

    await page.goto(`http://localhost:${PORT}/scripts/thumbnail.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof window.__thumbnail === "function", null, { timeout: 20_000 });
    if (failures.length > 0) throw new Error(`Thumbnail page errored: ${failures.join("; ")}`);

    const dataUrl = await page.evaluate(() => window.__thumbnail());
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length < 8_000) throw new Error(`Thumbnail looks empty (${bytes.length} bytes)`);
    fs.writeFileSync(output, bytes);
    console.log(`Wrote ${path.relative(root, output)} — 512x512, ${(bytes.length / 1024).toFixed(1)} kB`);
} finally {
    await browser?.close();
    await server.close();
}
