/**
 * The material vocabulary of the page.
 *
 * Every mark the player makes is one of these element ids sitting in a cell of
 * the simulation grid. Ten of them can be poured from a bottle; the rest only
 * ever appear because two inks met and something happened. That split is the
 * whole game: the shelf is the alphabet, the derived elements are the words.
 */

export const EMPTY = 0;
/** Ochre powder. Piles into slopes, drinks water, fuses to glass. */
export const GRIT = 1;
/** Water. Flows, seeps, quenches, carries. */
export const RILL = 2;
/** Live fire. Short-lived, spreads to anything that will take it. */
export const EMBER = 3;
/** Creeping green. Climbs, drinks, and eventually flowers. */
export const BRIAR = 4;
/** Plum-dark oil. Floats on water and catches in an instant. */
export const PITCH = 5;
/** Inert wall ink. Never moves; cold enough for steam to bead on. */
export const BASALT = 6;
/** Burnt exhaust. Rises and fades. */
export const SMOKE = 7;
/** Hot vapour. Rises, condenses on cold stone. */
export const STEAM = 8;
/** Water-darkened grit. Holds a steeper slope than dry grit. */
export const SILT = 9;
/** A briar tip that opened. Static until something disturbs it. */
export const BLOSSOM = 10;
/** Fused grit. Clear, permanent, immovable. */
export const GLASS = 11;
/** A low cloud. Drifts sideways and lets down rain. */
export const HAZE = 12;
/** Falls until it finds a floor, then roots. */
export const SPORE = 13;
/** Cold powder. Stills water and bites at anything warm. */
export const FROST = 14;
/** Stilled water. Melts back near heat. */
export const ICE = 15;
/** Dry white powder. Dissolves the moment it meets water. */
export const SALT = 16;
/** Salt water. Flows like water but kills what it touches. */
export const BRINE = 17;
/** What brine leaves behind when the water goes. */
export const CRYSTAL = 18;
/** The grey residue of anything that finished burning. */
export const ASH = 19;
/** A drifting spark of pollen-light. Rises, glows, goes out. */
export const MOTE = 20;
/** Feathered frost grown out of steam. */
export const RIME = 21;

export const ELEMENT_COUNT = 22;

/** Bottles on the shelf, in shelf order. `element: -1` is the kneaded eraser. */
export interface InkDefinition {
    /** Stable id used in saves, analytics, and hint copy. */
    readonly id: string;
    /** Shelf label shown under the selected bottle. */
    readonly name: string;
    /** Element this bottle pours. `-1` erases. */
    readonly element: number;
    /** Bottle glass colour (also tints the nib cursor and selection ring). */
    readonly colour: number;
    /** Discoveries required before the bottle appears on the shelf. */
    readonly unlockAt: number;
    /** One line shown when the bottle is first unlocked. */
    readonly unlockLine: string;
}

export const INKS: readonly InkDefinition[] = [
    { id: "grit", name: "GRIT", element: GRIT, colour: 0xd9a441, unlockAt: 0, unlockLine: "it piles." },
    { id: "rill", name: "RILL", element: RILL, colour: 0x3e7cb8, unlockAt: 0, unlockLine: "it finds the low ground." },
    { id: "ember", name: "EMBER", element: EMBER, colour: 0xe06a1f, unlockAt: 0, unlockLine: "it is always hungry." },
    {
        id: "briar",
        name: "BRIAR",
        element: BRIAR,
        colour: 0x3f7d45,
        unlockAt: 0,
        unlockLine: "it climbs toward the top of the page.",
    },
    {
        id: "pitch",
        name: "PITCH",
        element: PITCH,
        colour: 0x6e3a5e,
        unlockAt: 0,
        unlockLine: "it will not sink, and it will not wait.",
    },
    {
        id: "basalt",
        name: "BASALT",
        element: BASALT,
        colour: 0x2a2622,
        unlockAt: 0,
        unlockLine: "it holds still. everything else does not.",
    },
    {
        id: "haze",
        name: "HAZE",
        element: HAZE,
        colour: 0x8d96b8,
        unlockAt: 4,
        unlockLine: "paint a cloud. wait for weather.",
    },
    {
        id: "spore",
        name: "SPORE",
        element: SPORE,
        colour: 0x7a5230,
        unlockAt: 8,
        unlockLine: "drop it. it takes root.",
    },
    {
        id: "frost",
        name: "FROST",
        element: FROST,
        colour: 0x9fc9d8,
        unlockAt: 12,
        unlockLine: "it asks the water to stop.",
    },
    {
        id: "salt",
        name: "SALT",
        element: SALT,
        colour: 0xe8e2d2,
        unlockAt: 16,
        unlockLine: "it dissolves — and remembers.",
    },
    { id: "erase", name: "ERASER", element: -1, unlockAt: 0, colour: 0xc9bfa8, unlockLine: "" },
] as const;

export const ERASER_INDEX = INKS.length - 1;

/** Anything fire will happily take hold of. */
export function isFlammable(element: number): boolean {
    return element === BRIAR || element === PITCH || element === BLOSSOM || element === SPORE;
}

/** Rises instead of falling, and can be displaced by anything heavier. */
export function isGas(element: number): boolean {
    return element === SMOKE || element === STEAM || element === MOTE;
}

/** Pours and levels out. */
export function isLiquid(element: number): boolean {
    return element === RILL || element === PITCH || element === BRINE;
}

/** Never updated and never displaced — the simulation can skip these entirely. */
export function isStatic(element: number): boolean {
    return element === BASALT || element === GLASS || element === CRYSTAL;
}

/** Cold enough that steam will bead on it and rime will grow against it. */
export function isCold(element: number): boolean {
    return element === BASALT || element === ICE || element === FROST || element === RIME || element === CRYSTAL;
}
