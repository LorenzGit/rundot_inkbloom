#!/usr/bin/env node
/**
 * One version rule.
 *
 * `package.json` version is what the menu renders and what every analytics event is
 * tagged with (`build_version`). If it drifts from the version RUN actually serves,
 * the number a player reports and the number in your dashboards describe different
 * builds, and you cannot tell which code produced a session.
 *
 * So: once a game is published, package.json must equal the version on the Public tag.
 *
 * Unpublished games are exempt — there is nothing to match yet. A game is unpublished
 * when it has no game id, or no Public tag with a version.
 *
 * Needs network and a logged-in CLI, so this is deliberately NOT part of `npm run
 * check`. Run it as part of shipping, after deploying and before committing.
 *
 *   node scripts/check-deployed-version.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const packageVersion = JSON.parse(read("../package.json")).version;

const PLACEHOLDER = /^(REPLACE_WITH|UNASSIGNED)/i;

function gameId() {
    for (const path of ["../game.config.prod.json", "../game.config.json", "../rundot/game.config.json"]) {
        try {
            const id = JSON.parse(read(path)).gameId;
            if (id && !PLACEHOLDER.test(id)) return id;
        } catch {
            // Config absent or unreadable in this layout; try the next one.
        }
    }
    return null;
}

/**
 * Version on the Public tag, `null` when the game has never been made public, and
 * `UNKNOWN_GAME` when RUN has no such game at all (stale or deleted id).
 */
const UNKNOWN_GAME = Symbol("unknown game");

function publicVersion() {
    let output;
    try {
        output = execFileSync("rundot", ["game", "list-tags"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
        // A failed request still explains itself on stdout/stderr; keep it for the
        // checks below rather than treating every non-zero exit as unreachable.
        output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    }
    // The CLI exits 0 on a failed request, so detect the failure in the output too.
    if (/404 \(NotFound\)|Could not find game/i.test(output)) return UNKNOWN_GAME;
    if (/Failed to execute|RequestException|Unauthorized|401/i.test(output) || output.trim() === "") {
        console.error("Could not read tags from RUN.");
        console.error("Log in with `rundot login`, or skip this check for an offline build.");
        process.exit(2);
    }
    // Tags print as a header line followed by indented fields; take the first
    // Version under the Public header.
    const lines = output.split("\n");
    const start = lines.findIndex((line) => /^\s*Public\s*$/.test(line));
    if (start === -1) return null;
    for (const line of lines.slice(start + 1)) {
        if (/^\s*\S.*:\s*$/.test(line) && !/Version:/.test(line)) break; // next tag header
        const match = line.match(/Version:\s*(\S+)/);
        if (match) return match[1];
    }
    return null;
}

const id = gameId();
if (!id) {
    console.log(`Unpublished (no game id yet) — version rule does not apply. package.json is ${packageVersion}.`);
    process.exit(0);
}

const deployed = publicVersion();
if (deployed === UNKNOWN_GAME) {
    console.log(`RUN has no game "${id}" — nothing published to match. package.json is ${packageVersion}.`);
    console.log("If this game should exist, the id in the game config is stale.");
    process.exit(0);
}
if (!deployed) {
    console.log(`Unpublished (no Public tag yet) — version rule does not apply. package.json is ${packageVersion}.`);
    process.exit(0);
}

if (deployed !== packageVersion) {
    console.error(`Version mismatch: package.json is ${packageVersion}, RUN serves ${deployed} on the Public tag.`);
    console.error("The menu and every analytics build_version would report a build that is not live.");
    console.error(`Fix: set package.json (and package-lock.json) to ${deployed}, or deploy ${packageVersion}.`);
    process.exit(1);
}

console.log(`Version rule holds: package.json and the Public tag are both ${deployed}.`);
