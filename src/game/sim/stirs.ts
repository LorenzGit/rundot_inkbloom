/**
 * When the page stirs.
 *
 * For every secret, the elements that must be on the sheet at the same time
 * for the reaction to be possible at all. While any *unfound* secret's
 * elements are all present, the page "stirs" — a faint breathing shimmer on
 * the rule border. It never says which secret, and never where: it is warm /
 * cold for the mixing game, not a recipe. Field Notes nudges stay the only
 * thing that names inks.
 *
 * Entries are keyed by discovery id, not index, so this table cannot be
 * reordered out from under the save format. `verify-sim.mjs` proves the table
 * covers every discovery and names only real elements.
 *
 * Each entry is a list of alternative element sets: the page stirs when every
 * element of ANY one set is present. Alternatives exist because some
 * reactions accept several reagents (molten wax sets against anything
 * chilling; acid scours anything green). A route missing from this table only
 * costs a shimmer, never the discovery itself — so favour the routes a player
 * can actually stage over exhaustive coverage.
 */
import {
    ACID,
    AMALGAM,
    BASALT,
    BLOSSOM,
    BRIAR,
    BRINE,
    CRYSTAL,
    EMBER,
    FROST,
    FUME,
    GLASS,
    GRIT,
    GUST,
    HAZE,
    ICE,
    MAGMA,
    MOLTEN,
    MOSS,
    PEAT,
    PITCH,
    QUICK,
    RESIN,
    RILL,
    RIME,
    SALT,
    SILT,
    SPORE,
    STEAM,
    VOLT,
    WAX,
} from "./elements.ts";

type ElementSet = readonly number[];

/** Shorthand: one alternative per partner, all sharing a first reagent. */
function oneOf(first: number, partners: readonly number[]): readonly ElementSet[] {
    return partners.map((partner) => [first, partner]);
}

export const STIRS: ReadonlyMap<string, readonly ElementSet[]> = new Map<string, readonly ElementSet[]>([
    ["silt", [[GRIT, RILL]]],
    ["steam", oneOf(EMBER, [RILL, BRINE])],
    ["deep-drink", [[BRIAR, RILL]]],
    ["blossom", [[BRIAR, RILL]]],
    ["wildfire", [[BRIAR, EMBER]]],
    ["flashpoint", [[PITCH, EMBER]]],
    ["slick", [[PITCH, RILL]]],
    ["fire-on-water", [[PITCH, RILL, EMBER]]],
    ["glass", [[GRIT, EMBER]]],
    ["dew", [[STEAM, BASALT]]],
    ["rain", [[HAZE]]],
    ["sprout", [[SPORE]]],
    ["ashfall", [[BRIAR, EMBER]]],
    ["ice", [[FROST, RILL]]],
    ["thaw", oneOf(ICE, [EMBER, MAGMA])],
    ["brine", [[SALT, RILL]]],
    ["salt-flat", [[BRINE]]],
    ["withered", [[BRINE, BRIAR]]],
    ["glowmote", [[EMBER, BLOSSOM]]],
    ["rime", [[FROST, STEAM]]],
    ["melt", oneOf(WAX, [EMBER, MAGMA])],
    ["seal", oneOf(MOLTEN, [ICE, FROST, RIME, BASALT, CRYSTAL])],
    ["quench", [[MOLTEN, RILL]]],
    ["taper", [[MOLTEN, EMBER]]],
    ["wick", [[MOLTEN, BRIAR]]],
    ["creep", [[MOSS]]],
    ["verdant", [[MOSS, RILL]]],
    ["scorch", [[MOSS, EMBER]]],
    ["peat", [[MOSS, SILT]]],
    ["bogfire", [[PEAT, EMBER]]],
    ["fume", [[ACID, BASALT]]],
    ["firedamp", [[FUME, EMBER]]],
    ["etched", [[ACID, GLASS]]],
    ["neutral", [[ACID, SALT]]],
    ["scour", oneOf(ACID, [BRIAR, BLOSSOM, MOSS, SPORE])],
    ["quickbead", [[QUICK, RILL]]],
    ["sinkhole", [[QUICK, GRIT]]],
    ["quicksand", [[QUICK, SILT]]],
    ["amalgam", [[QUICK, GRIT]]],
    ["mirrorstone", [[AMALGAM, ACID]]],
    ["kindle", oneOf(MAGMA, [BRIAR, PITCH, BLOSSOM, SPORE, MOSS, PEAT, RESIN])],
    ["basaltflow", [[MAGMA]]],
    ["obsidian", oneOf(MAGMA, [RILL, BRINE])],
    ["crucible", [[MAGMA, GRIT]]],
    ["smelt", [[MAGMA, AMALGAM]]],
    ["resinset", [[RESIN]]],
    ["inclusion", [[RESIN, BLOSSOM]]],
    ["sapfire", [[RESIN, EMBER]]],
    ["stuck", [[RESIN, GRIT]]],
    ["arc", [[VOLT, QUICK]]],
    ["brinearc", [[VOLT, BRINE]]],
    ["fulgurite", [[VOLT, GRIT]]],
    ["electrolysis", [[VOLT, RILL]]],
    ["shockbloom", [[VOLT, BRIAR]]],
    ["welded", [[VOLT, AMALGAM]]],
    ["scatter", oneOf(GUST, [GRIT, SALT])],
    ["fanned", [[GUST, EMBER]]],
    ["snuffed", [[GUST, EMBER]]],
    ["drift", [[GUST, SPORE]]],
    ["dustdevil", [[GUST, SILT]]],
]);

/**
 * Whether any unfound secret is currently possible on this sheet.
 *
 * `found` is index-aligned to DISCOVERIES (the sim's own array); `present`
 * is per-element cell counts. Order of checks is unfound-first because after
 * the early game most secrets are found and skipping them is the whole cost.
 */
export function pageStirs(
    discoveryIds: readonly { readonly id: string }[],
    found: Uint8Array,
    present: Uint32Array,
): boolean {
    for (let index = 0; index < discoveryIds.length; index++) {
        if ((found[index] ?? 0) !== 0) continue;
        const sets = STIRS.get(discoveryIds[index]?.id ?? "");
        if (!sets) continue;
        for (const set of sets) {
            let complete = true;
            for (const element of set) {
                if ((present[element] ?? 0) === 0) {
                    complete = false;
                    break;
                }
            }
            if (complete) return true;
        }
    }
    return false;
}
