/**
 * Asset manifest — the single place that lists what gets loaded and when.
 * Files live in public/ and use page-relative URLs so deployed subdirectories
 * work without special handling.
 *
 * Two tiers (pattern from a shipped RUN game):
 *   - 'critical'  — awaited during the loading screen. Everything the first
 *                   interactive screen needs: menu art, UI chrome, the sprites
 *                   visible in the first seconds of play.
 *   - 'deferred'  — fire-and-forget background load after boot. Sub-screen
 *                   art, late-game content, anything the player can't see yet.
 *
 * Keep 'critical' small: every asset here delays first interaction.
 */
import type { AssetsManifest, UnresolvedAsset } from "pixi.js";

/**
 * A narrowing of Pixi's AssetsManifest: Pixi also allows `assets` to be a
 * record, but this template keeps it an array so the tier filters below can
 * check `assets.length`. Still assignable to AssetsManifest (Assets.init).
 */
export interface Manifest extends AssetsManifest {
    bundles: { name: string; assets: UnresolvedAsset[] }[];
}

export const MANIFEST: Manifest = {
    bundles: [
        {
            name: "critical",
            assets: [
                // ADAPT: first-screen art and sprites, for example:
                // { alias: "player", src: "images/player.png" },
            ],
        },
        {
            name: "deferred",
            assets: [
                // ADAPT: sub-screen backgrounds, later levels, and shop art.
            ],
        },
    ],
};

// Empty bundles are skipped so an unused tier never errors.
export const CRITICAL_BUNDLES: string[] = MANIFEST.bundles
    .filter((b) => b.name !== "deferred" && b.assets.length > 0)
    .map((b) => b.name);

export const DEFERRED_BUNDLES: string[] = MANIFEST.bundles
    .filter((b) => b.name === "deferred" && b.assets.length > 0)
    .map((b) => b.name);
