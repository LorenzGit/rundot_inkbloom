/** Identity and tuning constants shared by the simulation, UI, and save. */

export const GAME_NAME = "Inkbloom";
export const GAME_TAGLINE = "paint inks that live";

/**
 * Simulation grid.
 *
 * The sheet fills every pixel between the header and the shelf, so the grid is
 * **derived from the device** rather than fixed. A fixed 150x258 grid had one
 * aspect ratio and the phone had another, which left a band of bare desk down
 * both sides of the page — dead space on the one screen the player looks at.
 *
 * The long edge is fixed so a cell is always the same fraction of the page's
 * height, and the short edge follows from the space actually available. Cells
 * therefore stay square and the ink reads at the same scale on every device.
 */
export const SIM_HEIGHT = 258;
export const SIM_MIN_WIDTH = 96;
export const SIM_MAX_WIDTH = 260;

/** Cell columns for a page of the given width-over-height ratio. */
export function simWidthForAspect(aspect: number): number {
    const columns = Math.round(SIM_HEIGHT * aspect);
    if (!Number.isFinite(columns) || columns < SIM_MIN_WIDTH) return SIM_MIN_WIDTH;
    return columns > SIM_MAX_WIDTH ? SIM_MAX_WIDTH : columns;
}

/** Fixed simulation rate. Catch-up is capped so a stalled tab cannot spiral. */
export const SIM_HZ = 60;
export const SIM_STEP_MS = 1_000 / SIM_HZ;
export const MAX_CATCHUP_STEPS = 2;

/** Brush radii in cells. */
export const BRUSH_SMALL = 2;
export const BRUSH_LARGE = 5;

/** A quick tap keeps pouring briefly, so a dab is still a drop of ink. */
export const POUR_TAIL_STEPS = 28;
export const TAP_MAX_MS = 300;

/** Sheets the player can work on. Everything but `rag` comes with the Kit. */
export const PAPERS = ["rag", "vellum", "nocturne", "blueprint"] as const;
export type PaperId = (typeof PAPERS)[number];
export const DEFAULT_PAPER: PaperId = "rag";

export type QualityPreset = "high" | "low";
