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
            app.renderer.off("resize", layout);
            resizeCbs.clear();
            root.destroy({ children: true });
        },
    };
}
