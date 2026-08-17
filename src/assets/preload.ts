/**
 * Asset warming via Pixi Assets. Awaited during the loading screen (critical
 * bundle, with progress), then background-loads the deferred bundle.
 *
 * Failure posture: a missing asset must never brick boot. Errors are logged
 * and boot continues. The default demo uses procedural graphics, so both
 * bundles intentionally start empty.
 */
import { Assets } from "pixi.js";
import { MANIFEST, CRITICAL_BUNDLES, DEFERRED_BUNDLES } from "./manifest.ts";

/**
 * @param onProgress 0..1, called as the critical bundle loads; always ends
 *   with a final call at 1.
 */
export async function warmAssets(onProgress: (progress: number) => void = () => {}): Promise<void> {
    try {
        await Assets.init({ manifest: MANIFEST });
        if (CRITICAL_BUNDLES.length > 0) {
            await Assets.loadBundle(CRITICAL_BUNDLES, onProgress);
        }
        if (DEFERRED_BUNDLES.length > 0) {
            // Deliberately NOT Assets.backgroundLoadBundle: its internal queue
            // has no rejection handling, so one flaky fetch silently wedges
            // every remaining deferred asset for the session. Sequential loads
            // with a catch keep the trickle alive past a failure, and Assets
            // dedupes if a later explicit load needs one of these sooner.
            void (async () => {
                for (const bundle of DEFERRED_BUNDLES) {
                    try {
                        await Assets.loadBundle(bundle);
                    } catch (error) {
                        console.warn(`[preload] deferred bundle "${bundle}" failed — skipping`, error);
                    }
                }
            })();
        }
    } catch (err) {
        console.warn("[preload] asset warm failed — continuing without", err);
    }

    // Wait for @font-face fonts so the first painted screen doesn't swap
    // fonts mid-frame. (No custom fonts by default; harmless either way.)
    try {
        await document.fonts.ready;
    } catch {
        /* older engines */
    }

    onProgress(1);
}
