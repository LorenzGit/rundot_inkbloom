/**
 * Art direction: **Inkbloom**.
 *
 * The page is a warm sheet of rag paper — that part is the game and never
 * changes, because the whole look depends on pigment multiplying into fibre.
 * Everything *around* it is a modern mobile-game chrome: a deep indigo shell,
 * rounded surfaces with a light rim and a real drop shadow, and one saturated
 * gold accent reserved for progress and reward.
 *
 * Two rules keep it coherent:
 *   1. **On the page it is pigment.** Ink multiplies into the sheet so the
 *      paper's grain and vignette read through every mark.
 *   2. **Off the page it is UI.** Deep indigo, rounded, lit from above, with
 *      gold used only for things the player earned. The indigo is what makes
 *      the paper glow — a brown desk made it muddy.
 */

/** The shell behind everything. Deep indigo, lit from the top. */
export const SHELL = 0x141222;
export const SHELL_DEEP = 0x0b0a13;
export const SHELL_LIFT = 0x241f3a;

/** Raised surfaces: the shelf plank, cards, buttons. */
export const SURFACE = 0x241f38;
export const SURFACE_HIGH = 0x322b4d;
/** The one-pixel light rim that sells a surface as raised. */
export const RIM = 0xffffff;

/** Warm rag paper. */
export const PAPER = 0xfcf9f0;
export const PAPER_SHADE = 0xcbbc98;

/** The pen. Every ruled line, label, and glyph drawn on the sheet. */
export const INK = 0x2a2622;

/** Type on the dark shell. */
export const CREAM = 0xf4eedd;
export const MUTED = 0x9d95c2;

/** Gold. Progress, discoveries, unlocks — and nothing else. */
export const GOLD = 0xf5b841;
export const GOLD_DEEP = 0xd8862a;
export const GOLD_GLOW = 0xffd98a;

/** Confirmation and a dormant, not-yet-earned state. */
export const CONFIRMED = 0x4cc38a;
export const DORMANT = 0x5d5680;

/**
 * Type roles.
 *
 * The UI voice is a system sans at heavy weights — that is what reads as a
 * game on a phone, and it is available everywhere without shipping a font.
 * The serif is kept for the wordmark and the journal's entry titles, where the
 * game's identity lives; the handwritten face is used only for short marginal
 * notes, where a sans fallback still reads as an annotation.
 */
export const UI =
    '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
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
