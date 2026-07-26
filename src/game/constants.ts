/** Identity and tuning constants shared by the simulation, UI, and save. */

export const GAME_NAME = "Inkbloom";
export const GAME_TAGLINE = "paint inks that live";

/** Simulation grid. 3:4 so the page is a portrait notebook, not a phone screen. */
export const SIM_WIDTH = 150;
export const SIM_HEIGHT = 200;
export const PAGE_ASPECT = SIM_WIDTH / SIM_HEIGHT;

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
