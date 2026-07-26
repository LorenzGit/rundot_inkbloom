/**
 * Pixi v8 Application factory. One place owns renderer options so the rest of
 * the game never touches them.
 */
import { Application } from "pixi.js";

type RendererPreference = "webgpu" | "webgl";

async function initializeRenderer(host: HTMLElement, preference: RendererPreference): Promise<Application> {
    const app = new Application();
    try {
        await app.init({
            preference,
            resizeTo: host,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            autoDensity: true,
            backgroundAlpha: 0,
            antialias: true,
        });
        return app;
    } catch (error) {
        try {
            app.destroy({ removeView: true }, { children: true });
        } catch {
            // Initialization may fail before Pixi creates a renderer to destroy.
        }
        throw error;
    }
}

/**
 * Create and mount a Pixi app inside a host element. The canvas auto-resizes
 * to the host (the playable-frame div), so the game is sized by CSS — the same
 * orientation-aware `--game-w` frame that sizes the DOM UI.
 *
 * @param host element the canvas fills (position: relative/absolute)
 */
export async function createPixiApp(host: HTMLElement): Promise<Application> {
    const rendererQuery = new URLSearchParams(window.location.search).get("renderer");
    let app: Application;
    if (rendererQuery === "webgl" || rendererQuery === "webgpu") {
        // Forced modes are strict so QA can prove each backend independently.
        app = await initializeRenderer(host, rendererQuery);
    } else {
        try {
            // Pixi feature detection can pass even when adapter/device creation
            // later fails in a WebView. That failure is not auto-retried.
            app = await initializeRenderer(host, "webgpu");
        } catch (webGpuError) {
            console.warn("[renderer] WebGPU initialization failed; retrying with WebGL", webGpuError);
            app = await initializeRenderer(host, "webgl");
        }
    }
    const rendererName = app.renderer.constructor.name.toLowerCase().includes("webgpu") ? "webgpu" : "webgl";
    document.documentElement.dataset.renderer = rendererName;
    app.canvas.dataset.renderer = rendererName;
    app.canvas.setAttribute("aria-label", "Inkbloom page — paint inks and watch them react");
    host.appendChild(app.canvas);
    return app;
}
