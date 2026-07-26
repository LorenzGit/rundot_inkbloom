/**
 * Pixi v8 Application factory. One place owns renderer options so the rest of
 * the game never touches them.
 */
import { Application, Container, Graphics } from "pixi.js";

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
    } catch (error) {
        destroyQuietly(app);
        throw error;
    }

    // Prove the backend can actually draw before handing it to the game.
    //
    // `app.init()` resolving is not evidence that rendering works: on some
    // mobile WebViews Pixi's WebGPU feature detection passes and the adapter is
    // created, and then the very first shader compile fails. Nothing throws
    // where anyone is listening, the ticker keeps running, and the player is
    // left staring at a blank canvas for the whole session. A one-frame probe
    // turns that silent failure into a fallback.
    try {
        const probe = new Container();
        const mark = new Graphics().rect(0, 0, 2, 2).fill({ color: 0xffffff, alpha: 0.001 });
        probe.addChild(mark);
        app.renderer.render(probe);
        probe.destroy({ children: true });
    } catch (error) {
        destroyQuietly(app);
        throw new Error(`${preference} renderer failed its first draw: ${String(error)}`);
    }

    return app;
}

function destroyQuietly(app: Application): void {
    try {
        app.destroy({ removeView: true }, { children: true });
    } catch {
        // Initialization may fail before Pixi creates a renderer to destroy.
    }
}

/**
 * Create and mount a Pixi app inside a host element. The canvas auto-resizes
 * to the host (the playable-frame div), so the game is sized by CSS — the same
 * orientation-aware `--game-w` frame that sizes the DOM UI.
 *
 * @param host element the canvas fills (position: relative/absolute)
 * @param force pin a backend, skipping detection. Used by the caller's
 *   recovery path when WebGPU has already been shown not to work here.
 */
export async function createPixiApp(host: HTMLElement, force?: RendererPreference): Promise<Application> {
    const rendererQuery = new URLSearchParams(window.location.search).get("renderer");
    const requested = force ?? (rendererQuery === "webgl" || rendererQuery === "webgpu" ? rendererQuery : null);
    let app: Application;
    if (requested) {
        // Forced modes are strict so QA — and the caller's WebGPU recovery
        // path — can pin a backend and know exactly what it got.
        app = await initializeRenderer(host, requested);
    } else {
        try {
            app = await initializeRenderer(host, "webgpu");
        } catch (webGpuError) {
            console.warn("[renderer] WebGPU unusable; falling back to WebGL", webGpuError);
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
