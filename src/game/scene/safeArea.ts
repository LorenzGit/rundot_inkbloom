/**
 * Host insets, in CSS pixels, readable from Pixi.
 *
 * The React shell publishes RUN's safe area onto `documentElement` as
 * `--safe-*` custom properties, with `env(safe-area-inset-*)` as the fallback
 * for plain browsers. Reading the resolved custom property means the canvas
 * respects notches, home indicators, and the RUN header without the scene
 * needing to know which of those it is dealing with.
 */
export interface SafeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

function readInset(styles: CSSStyleDeclaration, name: string): number {
    const raw = styles.getPropertyValue(name).trim();
    if (!raw) return 0;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

export function readSafeInsets(): SafeInsets {
    try {
        const styles = window.getComputedStyle(document.documentElement);
        return {
            top: readInset(styles, "--safe-top"),
            right: readInset(styles, "--safe-right"),
            bottom: readInset(styles, "--safe-bottom"),
            left: readInset(styles, "--safe-left"),
        };
    } catch {
        return { top: 0, right: 0, bottom: 0, left: 0 };
    }
}
