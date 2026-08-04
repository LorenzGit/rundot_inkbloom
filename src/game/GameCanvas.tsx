/**
 * React ↔ Pixi boundary. React owns WHEN the game exists (mount/unmount with
 * the 'playing' phase); Pixi owns everything inside the canvas. No React
 * state flows in per-frame — game → UI communication goes through the store.
 *
 * StrictMode-safe: dev double-mount is handled by the `disposed` flag (the
 * first mount's async init resolves, sees it was cancelled, and destroys its
 * app before the second mount's app appears).
 */
import { useEffect, useRef } from "react";
import type { Application } from "pixi.js";
import { createPixiApp } from "./pixiApp.ts";
import { createStage, type Stage } from "./stage.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { createPageScene, type Scene } from "./scene/pageScene.ts";
import { store, useStore } from "../state/store.ts";

/**
 * How long to watch for a renderer that dies after it started.
 *
 * A WebGPU device can pass `init()`, pass a probe draw, and then fail on the
 * first shader the real scene needs. Nothing throws where React can see it: the
 * ticker keeps running and the player gets a blank canvas under a working UI
 * for the whole session. Watching the window's error channel for a few seconds
 * after mount is the only place that failure is observable.
 */
const RENDER_WATCHDOG_MS = 4_000;

/** Errors that mean "this backend cannot draw", not "the game has a bug". */
function looksLikeRendererFailure(message: string): boolean {
    const text = message.toLowerCase();
    return (
        text.includes("renderpipeid") ||
        text.includes("gpuprogram") ||
        text.includes("createshadermodule") ||
        text.includes("gpu") ||
        text.includes("webgpu") ||
        text.includes("destructure property 'source'")
    );
}

export default function GameCanvas() {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const appRef = useRef<Application | null>(null);
    const paused = useStore((s) => s.paused);

    useEffect(() => {
        let disposed = false;
        let scene: Scene | null = null;
        let stage: Stage | null = null;
        let watchdog = 0;
        let removeWatchdog: (() => void) | null = null;
        const host = hostRef.current;
        if (!host) return;

        const teardown = (): void => {
            // Also done in the scene's own destroy. Repeated here because this
            // path also runs when the scene never got built, and because the
            // one thing that must not survive a teardown is a sound.
            inkAudio.silencePage();
            removeWatchdog?.();
            removeWatchdog = null;
            if (watchdog) window.clearTimeout(watchdog);
            watchdog = 0;
            try {
                scene?.destroy();
            } catch {
                /* scene already torn down */
            }
            scene = null;
            try {
                stage?.destroy();
            } catch {
                /* stage already torn down */
            }
            stage = null;
            if (appRef.current) {
                try {
                    appRef.current.destroy({ removeView: true }, { children: true });
                } catch {
                    /* renderer already gone */
                }
                appRef.current = null;
            }
        };

        const build = async (forceWebGl: boolean): Promise<void> => {
            const app = await createPixiApp(host, forceWebGl ? "webgl" : undefined);
            if (disposed) {
                app.destroy({ removeView: true }, { children: true });
                return;
            }
            appRef.current = app;
            // Design-resolution stage: scenes position in design units, not
            // pixels, so layout is proportional on every device (stage.ts).
            stage = createStage(app);
            scene = createPageScene(app, stage);
            // Respect a pause that landed while the canvas was initializing.
            if (store.get().paused || document.hidden) app.ticker.stop();

            if (forceWebGl) return;

            // Watch for a backend that fails only once the real scene draws.
            const onError = (event: ErrorEvent): void => {
                if (disposed || !looksLikeRendererFailure(event.message ?? "")) return;
                console.warn("[renderer] WebGPU failed after start; rebuilding on WebGL", event.message);
                teardown();
                void build(true).catch(reportFailure);
            };
            window.addEventListener("error", onError);
            removeWatchdog = () => window.removeEventListener("error", onError);
            watchdog = window.setTimeout(() => {
                removeWatchdog?.();
                removeWatchdog = null;
            }, RENDER_WATCHDOG_MS);
        };

        const reportFailure = (error: unknown): void => {
            if (disposed) return;
            console.error("[renderer] Pixi initialization failed", error);
            store.patch({
                phase: "menu",
                menuScreen: "title",
                toast: "this device cannot open the page — try another",
            });
        };

        void build(false).catch(reportFailure);

        return () => {
            disposed = true;
            teardown();
        };
    }, []);

    // Host lifecycle pause/resume → freeze/unfreeze the whole ticker.
    useEffect(() => {
        const app = appRef.current;
        if (!app) return;
        if (paused || document.hidden) app.ticker.stop();
        else app.ticker.start();
    }, [paused]);

    // Browser visibility is a second lifecycle source outside the RUN host.
    // Keep it independent from `paused` so a visibility event cannot clear a
    // host-owned pause overlay.
    useEffect(() => {
        const syncVisibility = () => {
            const app = appRef.current;
            if (!app) return;
            if (document.hidden || store.get().paused) app.ticker.stop();
            else app.ticker.start();
        };
        document.addEventListener("visibilitychange", syncVisibility);
        return () => document.removeEventListener("visibilitychange", syncVisibility);
    }, []);

    return <div ref={hostRef} className="absolute inset-0" />;
}
