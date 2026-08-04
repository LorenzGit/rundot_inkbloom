/**
 * Ship the painted store tile and title hero from the art masters.
 *
 * Masters live in `src/assets/art/`:
 *   - store-thumbnail.jpg  (square key art with the Inkbloom wordmark)
 *   - title-hero.jpg       (title-screen key art, no wordmark)
 *
 * This script resizes/re-encodes into `public/` so the store tile is always
 * 512×512 and the hero is a compact JPEG. It deliberately does **not**
 * re-render from the simulation: a sim crop reads as a soft journal smear at
 * store size, and the wordmark needs painted key-art treatment.
 *
 *   node scripts/make-thumbnail.mjs
 *
 * The older sim composition still lives at `scripts/thumbnail.html` for
 * local curiosity; it is not the shipping tile.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const artDir = path.join(root, "src", "assets", "art");
const publicDir = path.join(root, "public");

const masters = {
    thumbnail: path.join(artDir, "store-thumbnail.jpg"),
    hero: path.join(artDir, "title-hero.jpg"),
};
const outputs = {
    thumbnail: path.join(publicDir, "thumbnail.jpg"),
    hero: path.join(publicDir, "title-hero.jpg"),
};

function requireFile(file, label) {
    if (!fs.existsSync(file)) {
        throw new Error(`Missing ${label}: ${path.relative(root, file)}`);
    }
}

function runSips(args) {
    const result = spawnSync("sips", args, { encoding: "utf8" });
    if (result.status !== 0) {
        throw new Error(`sips failed (${result.status}): ${result.stderr || result.stdout}`);
    }
}

requireFile(masters.thumbnail, "store thumbnail master");
requireFile(masters.hero, "title hero master");

// 512×512 JPEG for the RUN store tile.
runSips(["-z", "512", "512", "-s", "format", "jpeg", "-s", "formatOptions", "88", masters.thumbnail, "--out", outputs.thumbnail]);

// Title hero: keep master aspect, re-encode for a lean public file.
runSips(["-s", "format", "jpeg", "-s", "formatOptions", "90", masters.hero, "--out", outputs.hero]);

for (const [label, file] of Object.entries(outputs)) {
    const size = fs.statSync(file).size;
    if (size < 8_000) throw new Error(`${label} looks empty (${size} bytes)`);
    console.log(`Wrote ${path.relative(root, file)} — ${(size / 1024).toFixed(1)} kB`);
}
