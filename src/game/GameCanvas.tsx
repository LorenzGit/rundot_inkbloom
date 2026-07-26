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
import { createPageScene, type Scene } from "./scene/pageScene.ts";
import { store, useStore } from "../state/store.ts";

export default function GameCanvas() {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const appRef = useRef<Application | null>(null);
    const paused = useStore((s) => s.paused);

    useEffect(() => {
        let disposed = false;
        let scene: Scene | null = null;
        let stage: Stage | null = null;
        const host = hostRef.current;
        if (!host) return;

        const initialize = async (): Promise<void> => {
            const app = await createPixiApp(host);
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
        };
        void initialize().catch((error) => {
            if (disposed) return;
            console.error("[renderer] Pixi initialization failed", error);
            store.patch({
                phase: "menu",
                menuScreen: "title",
                toast: "this device cannot open the page — try another",
            });
        });
        return () => {
            disposed = true;
            try {
                scene?.destroy();
            } catch {
                /* scene already torn down */
            }
            try {
                stage?.destroy();
            } catch {
                /* stage already torn down */
            }
            if (appRef.current) {
                appRef.current.destroy({ removeView: true }, { children: true });
                appRef.current = null;
            }
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
