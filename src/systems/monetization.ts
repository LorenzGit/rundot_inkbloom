/**
 * Runtime monetization.
 *
 * Three hard rules, enforced here rather than in the UI:
 *
 *   1. **Ownership comes from the host.** `ownsKit` is only ever set from an
 *      entitlement quantity the host returned. A tapped button, a started
 *      checkout, and an analytics event grant nothing.
 *   2. **A failure is never a grant, and never a revocation.** If the host
 *      cannot be reached, the last known ownership is kept — an offline player
 *      does not lose the sheets they paid for — but a *new* grant is refused.
 *   3. **Every surface fails closed.** Unconfigured ids, absent LiveOps, or a
 *      missing capability leave the surface hidden or disabled with an honest
 *      message, never enabled with a local fallback reward.
 */
import { PLATFORM_IDS, isConfiguredPlatformId } from "../config/platform.ts";
import { createMonetizationTelemetry } from "../helpers/monetization/monetizationTelemetry.ts";
import { createPurchaseCoordinator, type PendingPurchaseIntent } from "../helpers/monetization/purchaseCoordinator.ts";
import type { MonetizationLiveOps } from "../helpers/monetization/monetizationLiveOps.ts";
import {
    classifyPurchaseError,
    findConfirmedOrder,
    getEntitlementQuantity,
    getShopItem,
    hasShop,
    shopPort,
} from "../sdk/runCommerce.ts";
import {
    getRunCapabilities,
    recordAnalytics,
    showVerifiedRewardedAd,
    type VerifiedActionResult,
} from "../sdk/runSdk.ts";
import { readPendingPurchase, saveSystem, writePendingPurchase } from "./save.ts";
import { localDayKey, serverNow } from "./serverTime.ts";
import { store } from "../state/store.ts";
import {
    createMonetizationLiveOps,
    FREE_NUDGE_DAILY_CAP,
    monetizationPlan,
    placements,
    PLACEMENT_MARGIN_NUDGE,
    PRODUCT_KIT,
    products,
} from "./monetizationConfig.ts";

const telemetry = createMonetizationTelemetry({
    analytics: { recordCustomEvent: (name, payload) => recordAnalytics(name, payload) },
    context: () => {
        const state = store.get();
        return {
            plan_version: monetizationPlan.version,
            discoveries: state.discoveryCount,
            owns_kit: state.ownsKit,
            paper: state.paper,
        };
    },
});

let liveOps: MonetizationLiveOps = createMonetizationLiveOps(null, false);
let catalogPrice: string | null = null;
let lastNudgeAt = 0;
let nudgesThisSession = 0;

/**
 * Idempotency keys are order identifiers, not gameplay randomness, so they use
 * Web Crypto. The vendored coordinator's fallback would reach for
 * `Math.random`, which this game does not use anywhere.
 */
function createOrderId(): string {
    try {
        if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
        // No Web Crypto means no safe unique key, so the order must not open.
        throw new Error("Secure identifier source unavailable");
    }
}

const coordinator = createPurchaseCoordinator({
    shop: shopPort,
    pending: {
        load: () => readPendingPurchase(),
        save: async (intent: PendingPurchaseIntent) => {
            writePendingPurchase(intent);
            await saveSystem.flush();
        },
        clear: async () => {
            writePendingPurchase(null);
            await saveSystem.flush();
        },
    },
    findConfirmedOrder: (history, intent) =>
        findConfirmedOrder(history as Awaited<ReturnType<typeof shopPort.getOrderHistory>>, intent.idempotencyKey),
    syncEntitlements: async () => {
        const owned = await syncKitOwnership("purchase");
        if (!owned) throw new Error("Entitlement not present yet");
    },
    classifyError: classifyPurchaseError,
    createId: createOrderId,
});

// ------------------------------------------------------------------ ownership

/**
 * Read ownership from the host.
 *
 * Returns the new ownership state, or the previous one when the host could not
 * answer. A `null` quantity is explicitly not treated as zero.
 */
async function syncKitOwnership(source: string): Promise<boolean> {
    const previous = store.get().ownsKit;
    if (!isConfiguredPlatformId(PLATFORM_IDS.illuminatorsKitEntitlement)) return previous;

    const quantity = await getEntitlementQuantity(PLATFORM_IDS.illuminatorsKitEntitlement);
    if (quantity === null) return previous;

    const owned = quantity > 0;
    if (owned !== previous) {
        const patch: Parameters<typeof store.patch>[0] = { ownsKit: owned };
        // Losing the Kit (a refund) must also take back its benefits, or the
        // player keeps a sheet and a tool they no longer own.
        if (!owned) {
            patch.paper = "rag";
            patch.mirrorBrush = false;
        }
        store.patch(patch);
        await saveSystem.flush();
    }
    telemetry.record("entitlement_synced", {
        entitlement_id: PLATFORM_IDS.illuminatorsKitEntitlement,
        owned,
        source,
    });
    return owned;
}

// ---------------------------------------------------------------- eligibility

/** Has the player reached the point where the Kit is a real want? */
export function kitOfferUnlocked(): boolean {
    const state = store.get();
    if (state.ownsKit) return false;
    return state.discoveryCount >= (monetizationPlan.firstExposure.minProgression ?? 0);
}

/** Is the Kit actually purchasable right now? */
export function kitPurchasable(): boolean {
    return (
        liveOps.purchasesEnabled &&
        liveOps.products[PRODUCT_KIT]?.enabled === true &&
        hasShop() &&
        isConfiguredPlatformId(PLATFORM_IDS.illuminatorsKitItem)
    );
}

/** The live catalog price, or null when the catalog has not answered. */
export function kitPrice(): string | null {
    return catalogPrice;
}

export interface NudgeAvailability {
    /** Show the rewarded control at all. */
    visible: boolean;
    /** It can be tapped right now. */
    ready: boolean;
    /** Honest reason when it cannot, for the disabled label. */
    reason: string;
    /** Free nudges left today, or null when the Kit removed the limit. */
    remainingToday: number | null;
}

export function nudgeAvailability(): NudgeAvailability {
    const state = store.get();
    if (state.ownsKit) {
        return { visible: true, ready: true, reason: "", remainingToday: null };
    }

    const placement = placements.get(PLACEMENT_MARGIN_NUDGE);
    const remote = liveOps.placements[PLACEMENT_MARGIN_NUDGE];
    if (!placement || !liveOps.rewardedAdsEnabled || remote?.enabled !== true) {
        return { visible: false, ready: false, reason: "", remainingToday: 0 };
    }
    if (!isConfiguredPlatformId(PLATFORM_IDS.marginNudgeRewarded)) {
        return { visible: false, ready: false, reason: "", remainingToday: 0 };
    }
    // Outside a RUN host the surface still shows — hiding it in development
    // means nobody ever sees it until production — but it says so plainly and
    // cannot be tapped into a reward.
    if (!getRunCapabilities().ads) {
        return { visible: true, ready: false, reason: "no video here — RUN only", remainingToday: 0 };
    }
    if (state.discoveryCount < placement.unlock.minProgression) {
        return { visible: false, ready: false, reason: "", remainingToday: 0 };
    }

    const dailyCap = Math.min(remote.dailyCap, FREE_NUDGE_DAILY_CAP);
    const remaining = Math.max(0, dailyCap - state.hintsWatchedToday);
    if (remaining <= 0) {
        return { visible: true, ready: false, reason: "no more nudges today", remainingToday: 0 };
    }
    if (nudgesThisSession >= remote.sessionCap) {
        return { visible: true, ready: false, reason: "enough for one sitting", remainingToday: remaining };
    }
    const waited = (Date.now() - lastNudgeAt) / 1_000;
    if (lastNudgeAt > 0 && waited < remote.cooldownSeconds) {
        return {
            visible: true,
            ready: false,
            reason: `ready in ${Math.ceil(remote.cooldownSeconds - waited)}s`,
            remainingToday: remaining,
        };
    }
    return { visible: true, ready: true, reason: "", remainingToday: remaining };
}

// -------------------------------------------------------------------- actions

export type NudgeResult = "granted" | "unavailable" | "cancelled" | "failed";

/**
 * Watch a rewarded video for one nudge.
 *
 * The caller only gets `granted` when the host said the ad completed. There is
 * no local fallback path that hands out a nudge — that is the whole point of
 * the placement existing.
 */
export async function watchForNudge(): Promise<NudgeResult> {
    const state = store.get();
    if (state.ownsKit) return "granted";

    const availability = nudgeAvailability();
    if (!availability.ready) return "unavailable";

    telemetry.record("ad_requested", { placement_id: PLACEMENT_MARGIN_NUDGE });
    const outcome: VerifiedActionResult = await showVerifiedRewardedAd(
        PLATFORM_IDS.marginNudgeRewarded,
        "A Nudge from the Margin",
    );
    telemetry.record("ad_result", { placement_id: PLACEMENT_MARGIN_NUDGE, outcome });

    if (outcome !== "verified") {
        return outcome === "cancelled" ? "cancelled" : outcome === "unavailable" ? "unavailable" : "failed";
    }

    lastNudgeAt = Date.now();
    nudgesThisSession += 1;
    const day = localDayKey(serverNow());
    const current = store.get();
    store.patch({
        hintDay: day,
        hintsWatchedToday: current.hintDay === day ? current.hintsWatchedToday + 1 : 1,
    });
    await saveSystem.flush();
    telemetry.record("reward_granted", { placement_id: PLACEMENT_MARGIN_NUDGE, reward_id: "margin_nudge", amount: 1 });
    return "granted";
}

export type KitPurchaseResult = "owned" | "unavailable" | "cancelled" | "failed" | "pending";

/** Open checkout for the Illuminator's Kit. */
export async function purchaseKit(): Promise<KitPurchaseResult> {
    if (store.get().ownsKit) return "owned";
    if (!kitPurchasable()) return "unavailable";

    telemetry.record("purchase_tapped", { product_id: PRODUCT_KIT });
    telemetry.record("checkout_started", { product_id: PRODUCT_KIT, price: catalogPrice });
    try {
        const outcome = await coordinator.purchase(PRODUCT_KIT, PLATFORM_IDS.illuminatorsKitItem);
        telemetry.record("checkout_result", { product_id: PRODUCT_KIT, status: outcome.status });
        if (outcome.status === "confirmed") return "owned";
        if (outcome.status === "cancelled") return "cancelled";
        if (outcome.status === "unknown") return "pending";
        return "failed";
    } catch (error) {
        telemetry.record("checkout_result", { product_id: PRODUCT_KIT, status: "threw" });
        console.warn("[monetization] checkout failed", error);
        return "failed";
    }
}

/** Mark the offer as seen so it stops being pushed and becomes a menu entry. */
export function markOfferSeen(): void {
    if (store.get().kitOfferSeen) return;
    store.patch({ kitOfferSeen: true });
    telemetry.record("offer_viewed", { product_id: PRODUCT_KIT, price: catalogPrice });
    void saveSystem.flush();
}

// ------------------------------------------------------------------ lifecycle

export const monetization = {
    plan: monetizationPlan,

    /** Feed the host's LiveOps values. Absent or malformed input fails closed. */
    applyLiveOps(values: unknown, useDevelopmentDefaults: boolean): void {
        const scoped =
            values && typeof values === "object"
                ? (values as Record<string, unknown>).inkbloom_monetization
                : undefined;
        liveOps = createMonetizationLiveOps(scoped, useDevelopmentDefaults);
    },

    /**
     * Boot work: recover an interrupted order, then read real ownership, then
     * read the live catalog so the price shown is the price charged.
     */
    async bootstrap(): Promise<void> {
        try {
            const pending = coordinator.pendingIntent();
            if (pending) {
                const recovered = await coordinator.reconcilePending();
                telemetry.record("checkout_result", {
                    product_id: pending.productId,
                    status: recovered?.status ?? "none",
                    recovered: true,
                });
            }
        } catch (error) {
            console.warn("[monetization] pending order reconciliation failed", error);
        }

        await syncKitOwnership("boot");

        if (kitPurchasable()) {
            const item = await getShopItem(PLATFORM_IDS.illuminatorsKitItem);
            catalogPrice = item?.price
                ? `${item.price.value} ${item.price.type === "bucks" ? "RB" : item.price.type}`
                : null;
            const issues = products.validateCatalog(
                item
                    ? [
                          {
                              id: item.itemId,
                              active: item.active,
                              price: item.price,
                              entitlements: item.entitlements,
                          },
                      ]
                    : [],
            );
            for (const issue of issues) {
                console.warn(`[monetization] catalog ${issue.severity}: ${issue.productId} — ${issue.message}`);
            }
        }
    },

    /** Re-read ownership after a resume, in case it changed on another device. */
    async resume(): Promise<void> {
        await syncKitOwnership("resume");
    },

    /** Reset per-day counters when the trusted day rolls over. */
    rolloverDay(day: string): void {
        const state = store.get();
        if (state.hintDay === day) return;
        store.patch({ hintDay: day, hintsWatchedToday: 0, freeHintUsed: false });
        void saveSystem.flush();
    },
};
