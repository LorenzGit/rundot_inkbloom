/**
 * Art direction: **Illuminated Marginalia**.
 *
 * A naturalist's field journal open on a dark desk under a single warm lamp.
 * Printed structure (serif headings, ruled borders, a numbered index) annotated
 * by a hand that is clearly still working: wobbling rules, gilt stars inked in
 * as each secret is confirmed, ink that granulates and darkens at its edges the
 * way real pigment does when it dries on rag paper.
 *
 * Two rules keep it coherent:
 *   1. Everything on the page is *pigment on paper* — the ink layer multiplies
 *      into the sheet rather than sitting on top of it, so the paper's fibre
 *      and vignette read through every mark.
 *   2. Everything off the page is *desk* — cream on walnut, gilt only for
 *      things the player earned.
 */

/** Walnut desk under lamplight; the full-bleed backdrop behind the page. */
export const DESK = 0x1b1712;
export const DESK_LAMP = 0x3a2f22;

/** Warm rag paper. */
export const PAPER = 0xfcf9f0;
export const PAPER_SHADE = 0xcbbc98;

/** The pen. Used for every ruled line, label, and glyph on the sheet. */
export const INK = 0x2a2622;

/** Ink on the desk side, where the paper's contrast is inverted. */
export const CREAM = 0xf4eedd;

/** Gilt. Reserved for discoveries, unlocks, and nothing else. */
export const GILT = 0xc9a227;
export const GILT_BRIGHT = 0xf0d488;

/** A found secret's confirmation green, and a locked entry's grey. */
export const CONFIRMED = 0x3f7d45;
export const DORMANT = 0x8a8274;

/**
 * Type roles.
 *
 * The journal's printed voice is a serif, which resolves to a real book face on
 * every platform the game ships to (Iowan/Palatino on iOS and macOS, Noto Serif
 * behind `serif` on Android, Georgia on Windows). The handwritten voice is used
 * only for short marginalia, where a sans fallback still reads as an
 * annotation rather than a broken asset.
 */
export const SERIF = 'Iowan Old Style, "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';
export const HAND = '"Bradley Hand", "Chalkboard SE", "Segoe Print", "Comic Sans MS", cursive';

/** Shared motion timings, so the whole game eases the same way. */
export const MOTION = {
    /** Bottle select, tool toggle — must feel instant. */
    tapMs: 140,
    /** Toast in, journal open, screen change. */
    revealMs: 320,
    /** Toast dwell before it retires. */
    dwellMs: 2_600,
    /** Tearing a page off the pad. */
    tearMs: 620,
} as const;
