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

/** Pale block wax. Holds still until something warms it. */
export const WAX = 22;
/** Wax that has given up and started running. */
export const MOLTEN = 23;
/** Wax that ran and then set again. */
export const SEALED = 24;
/** Creeping green. Spreads sideways across surfaces rather than climbing. */
export const MOSS = 25;
/** Compacted moss and silt. Burns slowly and smokes for a long time. */
export const PEAT = 26;
/** Bright, impatient liquid. Eats stone and glass. */
export const ACID = 27;
/** What acid gives off when it finds stone. Rises, and catches. */
export const FUME = 28;
/** Quicksilver. Heavier than everything and in a hurry to prove it. */
export const QUICK = 29;
/** Quicksilver that has taken grit into itself and stopped moving. */
export const AMALGAM = 30;

/** A travelling charge. Short-lived, and it goes where it is conducted. */
export const VOLT = 31;
/** Liquid rock. Sets fire to what it touches and cools into stone. */
export const MAGMA = 32;
/** Slow golden sap. Given time it stops being a liquid. */
export const RESIN = 33;
/** Resin that set, with whatever it caught still inside it. */
export const AMBER = 34;
/** Moving air. It carries nothing and moves everything. */
export const GUST = 35;
/** Magma quenched too fast to become stone. */
export const OBSIDIAN = 36;
/** Grit fused by a charge into branching glass. */
export const FULGURITE = 37;

export const ELEMENT_COUNT = 38;

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
    {
        id: "wax",
        name: "WAX",
        element: WAX,
        colour: 0xebd9a8,
        unlockAt: 20,
        unlockLine: "it holds still. warm it and it will not.",
    },
    {
        id: "moss",
        name: "MOSS",
        element: MOSS,
        colour: 0x6fa83c,
        unlockAt: 24,
        unlockLine: "it does not climb. it spreads.",
    },
    {
        id: "acid",
        name: "ACID",
        element: ACID,
        colour: 0xb6e02a,
        unlockAt: 28,
        unlockLine: "it has opinions about stone.",
    },
    {
        id: "quick",
        name: "QUICK",
        element: QUICK,
        colour: 0xb9c4d6,
        unlockAt: 32,
        unlockLine: "heavier than everything, and in a hurry.",
    },
    {
        id: "volt",
        name: "VOLT",
        element: VOLT,
        colour: 0xa9e7ff,
        unlockAt: 36,
        unlockLine: "it goes wherever it is allowed to go.",
    },
    {
        id: "magma",
        name: "MAGMA",
        element: MAGMA,
        colour: 0xe8562a,
        unlockAt: 40,
        unlockLine: "stone, in a hurry.",
    },
    {
        id: "resin",
        name: "RESIN",
        element: RESIN,
        colour: 0xd9902a,
        unlockAt: 44,
        unlockLine: "it is a liquid, but not for long.",
    },
    {
        id: "gust",
        name: "GUST",
        element: GUST,
        colour: 0xd6e8ea,
        unlockAt: 48,
        unlockLine: "it carries nothing and moves everything.",
    },
    { id: "erase", name: "ERASER", element: -1, unlockAt: 0, colour: 0xc9bfa8, unlockLine: "" },
] as const;

export const ERASER_INDEX = INKS.length - 1;

/** Anything fire will happily take hold of. */
export function isFlammable(element: number): boolean {
    return (
        element === BRIAR ||
        element === PITCH ||
        element === BLOSSOM ||
        element === SPORE ||
        element === MOSS ||
        element === PEAT ||
        element === MOLTEN ||
        element === FUME ||
        element === RESIN
    );
}

/** Rises instead of falling, and can be displaced by anything heavier. */
export function isGas(element: number): boolean {
    return element === SMOKE || element === STEAM || element === MOTE || element === FUME || element === GUST;
}

/** Pours and levels out. */
export function isLiquid(element: number): boolean {
    return (
        element === RILL ||
        element === PITCH ||
        element === BRINE ||
        element === ACID ||
        element === MOLTEN ||
        element === QUICK ||
        element === MAGMA ||
        element === RESIN
    );
}

/**
 * Liquids that quicksilver is heavier than, and therefore sinks through.
 *
 * Everything except quicksilver itself: that is the entire character of the
 * ink, and the reason it is the last one the shelf hands over.
 */
export function isSinkable(element: number): boolean {
    return isLiquid(element) && element !== QUICK;
}

/** Warm enough to melt wax and to set fume alight. */
export function isHot(element: number): boolean {
    return element === EMBER || element === MAGMA;
}

/**
 * Carries a charge.
 *
 * Both are liquids on purpose. A charge travels by swapping places with the
 * conductor, which rearranges it — invisible in quicksilver and brine, and
 * obviously wrong in a solid, so solids get their own reaction instead.
 */
export function conducts(element: number): boolean {
    return element === QUICK || element === BRINE;
}

/** Never updated and never displaced — the simulation can skip these entirely. */
export function isStatic(element: number): boolean {
    return (
        element === BASALT ||
        element === GLASS ||
        element === CRYSTAL ||
        element === AMALGAM ||
        element === OBSIDIAN ||
        element === AMBER ||
        element === FULGURITE
    );
}

/** A surface moss will creep across. */
export function isFooting(element: number): boolean {
    return (
        element === BASALT ||
        element === GLASS ||
        element === CRYSTAL ||
        element === AMALGAM ||
        element === SILT ||
        element === GRIT ||
        element === SEALED ||
        element === WAX ||
        element === PEAT ||
        element === OBSIDIAN ||
        element === AMBER ||
        element === FULGURITE
    );
}

/** Cold enough that steam will bead on it and rime will grow against it. */
export function isCold(element: number): boolean {
    return element === BASALT || element === ICE || element === FROST || element === RIME || element === CRYSTAL;
}

/** Cold enough to set running wax. */
export function isChilling(element: number): boolean {
    return element === ICE || element === FROST || element === RIME || element === BASALT || element === CRYSTAL;
}
