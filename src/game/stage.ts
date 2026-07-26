/**
 * Orientation-adaptive design stage. Scene code works in design units while
 * this module maps them to CSS pixels:
 *
 * - Portrait fixes the design width and reveals more or less vertical space.
 * - Landscape fixes the design height and reveals more or less horizontal
 *   space.
 *
 * This keeps object scale stable across rotation without cropping the scene or
 * stretching art. Re-read designWidth()/designHeight() inside resize handlers;
 * never hardcode the current long edge.
 */
import { Container, type Application } from "pixi.js";

/** ADAPT: the fixed short edge. 720 gives useful 2x-density art targets. */
export const DESIGN_SHORT_EDGE = 720;

/** What createStage returns — the surface scenes build against. */
export interface Stage {
    /** Add all scene content here (NOT app.stage), positioned in design units. */
    root: Container;
    /** Current screen width in design units — re-read after resizes. */
    designWidth(): number;
    /** Current screen height in design units — re-read after resizes. */
    designHeight(): number;
    /** Current design-unit → pixel factor (rarely needed directly). */
    scale(): number;
    /** Subscribe to resizes (re-anchor bottom/center content). Returns unsubscribe. */
    onResize(cb: () => void): () => void;
    destroy(): void;
}

/**
 * Create the stage on a Pixi app. Add all scene content to `stage.root`
 * (NOT app.stage) and position/size it in design units.
 */
export function createStage(app: Application): Stage {
    const root = new Container();
    app.stage.addChild(root);

    const resizeCbs = new Set<() => void>();
    let _designWidth = DESIGN_SHORT_EDGE;
    let _designHeight = (DESIGN_SHORT_EDGE * 16) / 9;

    const layout = () => {
        if (app.screen.width <= 0 || app.screen.height <= 0) return;
        const isLandscape = app.screen.width > app.screen.height;
        const s = isLandscape ? app.screen.height / DESIGN_SHORT_EDGE : app.screen.width / DESIGN_SHORT_EDGE;
        root.scale.set(s);
        _designWidth = app.screen.width / s;
        _designHeight = app.screen.height / s;
        for (const cb of resizeCbs) cb();
    };

    // app.screen is in CSS pixels regardless of resolution/autoDensity, so
    // the design mapping is unaffected by devicePixelRatio.
    app.renderer.on("resize", layout);

    /**
     * Watch the host element, not just the window.
     *
     * Pixi's `resizeTo` option reads the host's clientWidth/clientHeight at
     * init and then ONLY re-reads it on a `window` resize — it installs no
     * ResizeObserver. React mounts this canvas when the phase flips to
     * 'playing', so the host div frequently has no layout yet when the async
     * `app.init()` resolves. The renderer is then sized 0x0, `layout()` bails
     * on the zero guard, and because the window never resizes nothing ever
     * re-triggers it: a permanently blank canvas with no error anywhere.
     *
     * Observing the host closes that race for good, and also handles the host
     * changing size without the window doing so (orientation-driven CSS,
     * safe-area changes, the RUN host resizing its frame).
     */
    const host = app.canvas.parentElement;
    let observer: ResizeObserver | null = null;
    /** True once the host has been observed with no layout at all. */
    let wasCollapsed = app.screen.width <= 0 || app.screen.height <= 0;

    if (host && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
            const { clientWidth, clientHeight } = host;
            if (clientWidth <= 0 || clientHeight <= 0) {
                wasCollapsed = true;
                return;
            }

            if (wasCollapsed) {
                wasCollapsed = false;
                // Coming back from zero size, the host is usually the SAME size
                // it was before. Pixi's `resize()` early-returns when the
                // dimensions match, so it would never reconfigure — and a
                // WebGPU canvas that was collapsed has had its swap chain torn
                // down, so it renders nothing forever with no error. Nudge the
                // height by a pixel to force a genuine reconfigure.
                app.renderer.resize(clientWidth, Math.max(1, clientHeight - 1));
            }

            // Re-sizing emits 'resize', which runs layout(); call it anyway in
            // case the dimensions already matched and only the stage mapping
            // was missed.
            app.renderer.resize(clientWidth, clientHeight);
            layout();
        });
        observer.observe(host);
    }

    layout();

    return {
        root,
        designWidth: () => _designWidth,
        designHeight: () => _designHeight,
        scale: () => root.scale.x,
        onResize(cb) {
            resizeCbs.add(cb);
            return () => resizeCbs.delete(cb);
        },
        destroy() {
            observer?.disconnect();
            observer = null;
            app.renderer.off("resize", layout);
            resizeCbs.clear();
            root.destroy({ children: true });
        },
    };
}
