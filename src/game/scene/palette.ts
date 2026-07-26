/**
 * Art direction: **Inkbloom**.
 *
 * A bright, friendly craft table. A teal ground, a warm wooden shelf of ink
 * bottles, cream cards with chunky rounded edges, and one amber accent for
 * progress and reward. The page is a real sheet of rag paper and is the only
 * quiet, tactile thing on screen — which is exactly why it holds the eye.
 *
 * Two rules keep it coherent:
 *   1. **On the page it is pigment.** Ink multiplies into the sheet so the
 *      paper's grain and vignette read through every mark.
 *   2. **Off the page it is a toy.** Saturated ground, wooden shelf, cream
 *      cards, thick bottom-bevelled buttons. Amber is reserved for things the
 *      player earned.
 */

/**
 * The shell behind everything: a bright teal craft table.
 *
 * Casual mobile games are high-key and saturated. A near-black shell reads as a
 * premium puzzle game; this reads as something you play on a bus. The teal is
 * also the one hue none of the ten inks use, so every ink stays legible on it.
 */
export const SHELL = 0x148c8c;
export const SHELL_DEEP = 0x0a5457;
export const SHELL_LIFT = 0x2bb3ad;

/** The shelf: a warm wooden plank, the one heavy object on screen. */
export const WOOD = 0xc98f55;
export const WOOD_DEEP = 0x8a5628;
export const WOOD_DARK = 0x5f3a1b;

/** Cards and panels are cream, not dark. This is the biggest casual signal. */
export const CARD = 0xfff8ea;
export const CARD_SHADE = 0xf2e3c9;
/** Type on cream. */
export const CARD_INK = 0x3a2e24;
export const CARD_MUTED = 0x8b7a68;

/** The one-pixel light rim that sells a surface as raised. */
export const RIM = 0xffffff;

/** Warm rag paper. */
export const PAPER = 0xfcf9f0;
export const PAPER_SHADE = 0xcbbc98;

/** The pen. Every ruled line, label, and glyph drawn on the sheet. */
export const INK = 0x2a2622;

/** Type on the teal shell. */
export const CREAM = 0xfff8ea;
export const MUTED = 0xa8ded8;

/** Amber. Progress, discoveries, unlocks — and nothing else. */
export const GOLD = 0xffb92e;
export const GOLD_DEEP = 0xdc8a11;
export const GOLD_GLOW = 0xffd97a;

/** Confirmation, and a dormant not-yet-earned state. */
export const CONFIRMED = 0x5cc96b;
export const DORMANT = 0x9c8a76;

/** Kept for compatibility with the surface helpers. */
export const SURFACE = WOOD_DEEP;
export const SURFACE_HIGH = WOOD;

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
