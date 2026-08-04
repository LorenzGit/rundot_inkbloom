/**
 * The monetization decisions, made once and kept in typed configuration.
 *
 * The whole design follows from one constraint: **Inkbloom is a game about
 * finding things out, so nothing may be sold that makes finding things out
 * easier to skip.** All sixty secrets, all eighteen inks, the sandbox, and the
 * daily prompt are free forever. What is sold is a different *surface* to work
 * on and a tool to work with — and patience, in the form of not having to wait
 * a day between nudges.
 *
 * Two products and two rewarded placements. A calm sandbox has no natural break
 * that an interstitial could occupy without damaging it, so none is defined;
 * every placement is player-initiated, from a control the player reached for.
 *
 * **Why there is no larger nudge pack.** The Kit already gives unlimited
 * nudges at 400 RB, so any pack priced above roughly a third of it is
 * dominated by the Kit for exactly the player it would target. A dominated
 * tier is a trap, not a ladder, so the pot is the only pack.
 *
 * Full brief, pricing evidence, and rollback signals: `docs/monetization.md`.
 */
import { createMonetizationPlan } from "../helpers/monetization/monetizationPlan.ts";
import { createPlacementRegistry } from "../helpers/monetization/placementRegistry.ts";
import { createProductRegistry } from "../helpers/monetization/productRegistry.ts";
import {
    normalizeMonetizationLiveOps,
    type MonetizationLiveOps,
    type MonetizationLiveOpsInput,
} from "../helpers/monetization/monetizationLiveOps.ts";
import { PLATFORM_IDS } from "../config/platform.ts";

export const PRODUCT_KIT = "illuminators_kit";
export const PRODUCT_POT = "pot_of_ink";
export const PLACEMENT_MARGIN_NUDGE = "margin_nudge";
export const PLACEMENT_BORROW_INK = "borrow_ink";

/** Nudges one pot pours into the balance. Must match `rundot/shop.config.json`. */
export const POT_NUDGE_QUANTITY = 10;

/** Rewarded nudges a free player may watch per day, before the Kit removes the cap. */
export const FREE_NUDGE_DAILY_CAP = 3;

export const monetizationPlan = createMonetizationPlan({
    model: "hybrid",
    nonPayerPromise:
        "Every one of the sixty secrets, all eighteen inks, the daily prompt, and one free nudge each day are available " +
        "without spending anything. No ad is ever required to play, and none is shown unprompted.",
    purchaseArchitecture: "shop-entitlements",
    architectureRationale:
        "The Kit is a permanent, cross-device benefit, so it uses the server catalog with idempotent orders, " +
        "refund support, and authoritative entitlement reconciliation rather than a client-owned flag.",
    firstExposure: {
        valueMoment:
            "The player has found four secrets and watched the shelf hand them a new ink for it — the moment the " +
            "loop is legible and a second sheet becomes a genuine want.",
        minCompletedSessions: 0,
        minProgression: 4,
    },
    // Three is the cap the plan validator enforces. Both placements are folded
    // into one completion-rate KPI and split by `placement_id` in the query;
    // retention by exposure cohort lives in the guardrails below.
    primaryKpis: ["kit_offer_conversion", "pot_offer_conversion", "rewarded_completion_rate"],
    guardrails: {
        retention:
            "D1/D7 retention split by whether the player was ever shown the Kit offer, and by whether they ever " +
            "borrowed an ink — a loan that raises play but lowers retention is a loan that replaced the reward.",
        sessionHealth: "Session length and page-tear rate after an offer or ad, versus before it.",
        economyHealth:
            "Share of discoveries that were hinted at all, the ratio of free to bought to rewarded nudges, and the " +
            "share of ink unlocks a player had already borrowed.",
        reliability: "Checkout and rewarded-ad error rates, excluding player cancellation.",
    },
});

export const placements = createPlacementRegistry([
    {
        id: PLACEMENT_MARGIN_NUDGE,
        displayName: "A Nudge from the Margin",
        type: "rewarded",
        enabledByDefault: true,
        // A nudge is meaningless before the player has found anything, and
        // insulting before they have tried: one discovery is the gate.
        unlock: { minCompletedSessions: 0, minProgression: 1, requireValueMoment: false },
        cooldownSeconds: 45,
        sessionCap: 6,
        dailyCap: FREE_NUDGE_DAILY_CAP,
        // Kit owners never see this placement at all — they already have
        // unlimited nudges, so offering them an ad would be nonsense.
        subscriberPolicy: "instant-reward",
        noAdFallback: "disable-with-message",
        rewardId: "margin_nudge",
        rewardAmount: 1,
    },
    {
        id: PLACEMENT_BORROW_INK,
        displayName: "Borrow an Ink",
        type: "rewarded",
        enabledByDefault: true,
        // Tapping a bottle you cannot have is the clearest statement of intent
        // in the game, and until now it answered with a shake and a number.
        // The offer is only ever the *next* locked bottle, so the shelf still
        // arrives in the order the game intends and the loan previews the
        // reward rather than replacing it.
        unlock: { minCompletedSessions: 0, minProgression: 1, requireValueMoment: false },
        cooldownSeconds: 60,
        sessionCap: 4,
        dailyCap: 6,
        // The Kit sells sheets and tools, never inks — so Kit owners see this
        // placement on exactly the same terms as everyone else.
        subscriberPolicy: "same-as-free",
        noAdFallback: "disable-with-message",
        rewardId: "borrow_ink",
        rewardAmount: 1,
    },
]);

export const products = createProductRegistry([
    {
        id: PRODUCT_KIT,
        catalogItemId: PLATFORM_IDS.illuminatorsKitItem,
        kind: "durable",
        expectedEntitlementIds: [PLATFORM_IDS.illuminatorsKitEntitlement],
        unique: true,
        unlockDescription:
            "Offered from Field Notes once four secrets are known, and from the title screen thereafter. " +
            "Grants three additional sheets, the mirror nib, and nudges without a daily limit.",
    },
    {
        id: PRODUCT_POT,
        catalogItemId: PLATFORM_IDS.potOfInkItem,
        kind: "consumable",
        expectedEntitlementIds: [PLATFORM_IDS.nudgeEntitlement],
        // Repeatable on purpose: a pot is a pot, and a second one adds to the
        // same balance rather than being refused as already owned.
        unique: false,
        unlockDescription:
            "Offered in the Kit panel beside the Kit, once one secret is known. Pours ten nudges into a " +
            "balance the server keeps, spent one at a time and never expiring.",
    },
]);

/**
 * Local development controls.
 *
 * These are used ONLY when there is no host LiveOps config to read, so the
 * surfaces are visible and testable in `npm run dev`. In production, absent or
 * malformed config fails closed and every surface stays dark.
 */
const developmentControls: MonetizationLiveOpsInput = {
    enabled: true,
    purchasesEnabled: true,
    rewardedAdsEnabled: true,
    interstitialAdsEnabled: false,
    placements: {
        [PLACEMENT_MARGIN_NUDGE]: {
            enabled: true,
            cooldownSeconds: 45,
            sessionCap: 6,
            dailyCap: FREE_NUDGE_DAILY_CAP,
            rewardMultiplier: 1,
        },
        [PLACEMENT_BORROW_INK]: {
            enabled: true,
            cooldownSeconds: 60,
            sessionCap: 4,
            dailyCap: 6,
            rewardMultiplier: 1,
        },
    },
    products: { [PRODUCT_KIT]: { enabled: true }, [PRODUCT_POT]: { enabled: true } },
};

export function createMonetizationLiveOps(input: unknown, useDevelopmentDefaults: boolean): MonetizationLiveOps {
    const selected =
        input && typeof input === "object"
            ? (input as MonetizationLiveOpsInput)
            : useDevelopmentDefaults
              ? developmentControls
              : undefined;
    return normalizeMonetizationLiveOps(selected);
}
