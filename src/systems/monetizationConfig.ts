/**
 * The monetization decisions, made once and kept in typed configuration.
 *
 * The whole design follows from one constraint: **Inkbloom is a game about
 * finding things out, so nothing may be sold that makes finding things out
 * easier to skip.** All twenty secrets, all ten inks, the sandbox, and the
 * daily prompt are free forever. What is sold is a different *surface* to work
 * on and a tool to work with — and patience, in the form of not having to wait
 * a day between nudges.
 *
 * There is exactly one product and exactly one ad placement. A calm sandbox has
 * no natural break that an interstitial could occupy without damaging it, so
 * none is defined; the rewarded nudge is always player-initiated, from a panel
 * the player opened themselves.
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
export const PLACEMENT_MARGIN_NUDGE = "margin_nudge";

/** Rewarded nudges a free player may watch per day, before the Kit removes the cap. */
export const FREE_NUDGE_DAILY_CAP = 3;

export const monetizationPlan = createMonetizationPlan({
    model: "hybrid",
    nonPayerPromise:
        "Every one of the twenty secrets, all ten inks, the daily prompt, and one free nudge each day are available " +
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
    primaryKpis: ["kit_offer_conversion", "rewarded_nudge_completion_rate", "d7_retention_by_exposure_cohort"],
    guardrails: {
        retention: "D1/D7 retention split by whether the player was ever shown the Kit offer.",
        sessionHealth: "Session length and page-tear rate after an offer or ad, versus before it.",
        economyHealth: "Share of discoveries that were hinted at all, and the ratio of free to rewarded nudges.",
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
    },
    products: { [PRODUCT_KIT]: { enabled: true } },
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
