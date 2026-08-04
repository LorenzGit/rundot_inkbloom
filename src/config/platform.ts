/**
 * Every platform-side identifier this game uses, in one place.
 *
 * Where each one comes from:
 *   - `gameId` — written by `rundot init`, mirrored in `game.config.prod.json`.
 *   - ad placement ids — self-authored strings passed as `adDisplayId`. There is
 *     no dashboard step; they simply have to be stable forever once shipped.
 *   - shop item and entitlement ids — self-authored in `rundot/shop.config.json`,
 *     registered with the catalog at deploy. These strings must match exactly.
 *
 * An untouched `REPLACE_WITH_` value fails closed: the surface that depends on
 * it stays hidden rather than appearing broken or, worse, granting for free.
 * LiveOps gating is a second, independent switch — real ids alone do not turn
 * a surface on.
 */
export const PLATFORM_IDS = Object.freeze({
    gameId: "gCoSWVsu7MchgqeaLNrM",

    /** Rewarded video that buys one nudge toward a still-unfound secret. */
    marginNudgeRewarded: "inkbloom_margin_nudge_rewarded",
    /** Rewarded video that lends the next locked ink for the current sheet. */
    borrowInkRewarded: "inkbloom_borrow_ink_rewarded",

    /** The Illuminator's Kit — the durable tier. */
    illuminatorsKitItem: "inkbloom_illuminators_kit",
    illuminatorsKitEntitlement: "inkbloom_illuminators_kit",

    /**
     * A Pot of Ink — the consumable tier.
     *
     * The item and the entitlement are deliberately *not* the same string: the
     * item is one purchase of a pot, the entitlement is the nudge balance it
     * pours into, and a second purchase adds to the same balance.
     */
    potOfInkItem: "inkbloom_pot_of_ink",
    nudgeEntitlement: "inkbloom_nudges",
});

export function isConfiguredPlatformId(value: string): boolean {
    return value.length > 0 && !value.startsWith("REPLACE_WITH_");
}
