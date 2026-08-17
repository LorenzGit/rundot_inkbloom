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
    consumeEntitlement,
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
    PLACEMENT_BORROW_INK,
    PLACEMENT_MARGIN_NUDGE,
    PRODUCT_KIT,
    PRODUCT_POT,
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
let potPriceText: string | null = null;
let lastNudgeAt = 0;
let nudgesThisSession = 0;
let lastBorrowAt = 0;
let borrowsThisSession = 0;

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

/**
 * Read the bought-nudge balance from the host.
 *
 * Same rule as ownership: a `null` quantity is "the host could not tell us",
 * not zero, and the last known balance is kept. The difference is that a stale
 * balance can only ever cause a *refused* spend, never a granted one — the
 * spend itself goes through `consumeEntitlement` and is authoritative.
 */
async function syncPotBalance(source: string): Promise<number> {
    const previous = store.get().potNudges;
    if (!isConfiguredPlatformId(PLATFORM_IDS.nudgeEntitlement)) return previous;

    const quantity = await getEntitlementQuantity(PLATFORM_IDS.nudgeEntitlement);
    if (quantity === null) return previous;

    const balance = Math.max(0, Math.floor(quantity));
    if (balance !== previous) {
        store.patch({ potNudges: balance });
        await saveSystem.flush();
    }
    telemetry.record("entitlement_synced", {
        entitlement_id: PLATFORM_IDS.nudgeEntitlement,
        quantity: balance,
        source,
    });
    return balance;
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

/**
 * Is a pot purchasable right now?
 *
 * Unlike the Kit this is never "already owned": a pot is a consumable and a
 * second one adds to the same balance.
 */
export function potPurchasable(): boolean {
    return (
        liveOps.purchasesEnabled &&
        liveOps.products[PRODUCT_POT]?.enabled === true &&
        hasShop() &&
        isConfiguredPlatformId(PLATFORM_IDS.potOfInkItem)
    );
}

/** The pot is worth offering once the player knows what a nudge is for. */
export function potOfferUnlocked(): boolean {
    return store.get().discoveryCount >= 1;
}

export function potPrice(): string | null {
    return potPriceText;
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

export interface BorrowAvailability {
    visible: boolean;
    ready: boolean;
    reason: string;
    remainingToday: number | null;
}

/**
 * Can the player borrow the next locked ink right now?
 *
 * Deliberately shaped like `nudgeAvailability`, including the "visible but
 * disabled with an honest reason" state outside a RUN host: a surface nobody
 * sees until production is a surface nobody tests.
 */
export function borrowAvailability(): BorrowAvailability {
    const state = store.get();
    const placement = placements.get(PLACEMENT_BORROW_INK);
    const remote = liveOps.placements[PLACEMENT_BORROW_INK];
    if (!placement || !liveOps.rewardedAdsEnabled || remote?.enabled !== true) {
        return { visible: false, ready: false, reason: "", remainingToday: 0 };
    }
    if (!isConfiguredPlatformId(PLATFORM_IDS.borrowInkRewarded)) {
        return { visible: false, ready: false, reason: "", remainingToday: 0 };
    }
    if (state.discoveryCount < placement.unlock.minProgression) {
        return { visible: false, ready: false, reason: "", remainingToday: 0 };
    }
    if (!getRunCapabilities().ads) {
        return { visible: true, ready: false, reason: "no video here — RUN only", remainingToday: 0 };
    }
    // One loan at a time. Two borrowed bottles would be a shelf the player did
    // not earn, which is the thing the gates exist to prevent.
    if (state.borrowedInk !== null) {
        return { visible: true, ready: false, reason: "one bottle on loan already", remainingToday: null };
    }

    const day = localDayKey(serverNow());
    const usedToday = state.borrowDay === day ? state.borrowsToday : 0;
    const remaining = Math.max(0, remote.dailyCap - usedToday);
    if (remaining <= 0) {
        return { visible: true, ready: false, reason: "no more loans today", remainingToday: 0 };
    }
    if (borrowsThisSession >= remote.sessionCap) {
        return { visible: true, ready: false, reason: "enough for one sitting", remainingToday: remaining };
    }
    const waited = (Date.now() - lastBorrowAt) / 1_000;
    if (lastBorrowAt > 0 && waited < remote.cooldownSeconds) {
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
    telemetry.record("reward_claimed", { placement_id: PLACEMENT_MARGIN_NUDGE, reward_id: "margin_nudge", amount: 1 });
    // Income side of currency_spent, which fires when a nudge is used.
    telemetry.record("currency_earned", {
        currency: "nudges",
        amount: 1,
        source: "ad_reward",
        placement_id: PLACEMENT_MARGIN_NUDGE,
    });
    return "granted";
}

export type BorrowResult = "granted" | "unavailable" | "cancelled" | "failed";

/**
 * Watch a rewarded video to borrow a shelf slot for the current sheet.
 *
 * The loan is granted only on a verified completion, and only for the slot the
 * caller asked about — which the shelf guarantees is the *next* locked one.
 */
export async function watchToBorrow(slot: number): Promise<BorrowResult> {
    if (!borrowAvailability().ready) return "unavailable";

    telemetry.record("ad_requested", { placement_id: PLACEMENT_BORROW_INK, slot });
    const outcome: VerifiedActionResult = await showVerifiedRewardedAd(PLATFORM_IDS.borrowInkRewarded, "Borrow an Ink");
    telemetry.record("ad_result", { placement_id: PLACEMENT_BORROW_INK, outcome, slot });

    if (outcome !== "verified") {
        return outcome === "cancelled" ? "cancelled" : outcome === "unavailable" ? "unavailable" : "failed";
    }

    lastBorrowAt = Date.now();
    borrowsThisSession += 1;
    const day = localDayKey(serverNow());
    const current = store.get();
    store.patch({
        borrowedInk: slot,
        borrowOffer: null,
        borrowDay: day,
        borrowsToday: current.borrowDay === day ? current.borrowsToday + 1 : 1,
    });
    await saveSystem.flush();
    telemetry.record("reward_claimed", { placement_id: PLACEMENT_BORROW_INK, reward_id: "borrow_ink", amount: 1 });
    return "granted";
}

/** The loan lasts as long as the sheet does. A new sheet is a new shelf. */
export function endBorrow(): void {
    if (store.get().borrowedInk === null) return;
    store.patch({ borrowedInk: null, borrowOffer: null });
    void saveSystem.flush();
}

export type PotSpendResult = "spent" | "empty" | "unavailable";

/**
 * Spend one bought nudge.
 *
 * The server decides. There is no path here that decrements the local cache
 * and hopes — a host that cannot be reached returns `unavailable`, the caller
 * reveals nothing, and the player still has their pot.
 */
export async function spendPotNudge(): Promise<PotSpendResult> {
    if (store.get().potNudges <= 0) return "empty";
    if (!isConfiguredPlatformId(PLATFORM_IDS.nudgeEntitlement)) return "unavailable";

    const left = await consumeEntitlement(PLATFORM_IDS.nudgeEntitlement, 1, "currency_spent");
    if (left === null) return "unavailable";

    store.patch({ potNudges: Math.max(0, left) });
    await saveSystem.flush();
    telemetry.record("reward_claimed", { product_id: PRODUCT_POT, reward_id: "pot_nudge", amount: 1, remaining: left });
    return "spent";
}

export type PotPurchaseResult = "bought" | "unavailable" | "cancelled" | "failed" | "pending";

/** Open checkout for a Pot of Ink. */
export async function purchasePot(): Promise<PotPurchaseResult> {
    if (!potPurchasable()) return "unavailable";

    telemetry.record("offer_clicked", { product_id: PRODUCT_POT });
    telemetry.record("iap_purchase_started", { product_id: PRODUCT_POT, price: potPriceText });
    try {
        const outcome = await coordinator.purchase(PRODUCT_POT, PLATFORM_IDS.potOfInkItem);
        telemetry.record(outcome.status === "confirmed" ? "iap_purchase_complete" : "iap_purchase_failed", {
            product_id: PRODUCT_POT,
            status: outcome.status,
        });
        if (outcome.status === "confirmed") {
            await syncPotBalance("purchase");
            return "bought";
        }
        if (outcome.status === "cancelled") return "cancelled";
        if (outcome.status === "unknown") {
            // Ambiguous: the balance is the only honest answer, so re-read it.
            await syncPotBalance("purchase-unknown");
            return "pending";
        }
        return "failed";
    } catch (error) {
        telemetry.record("iap_purchase_failed", { product_id: PRODUCT_POT, status: "threw" });
        console.warn("[monetization] pot checkout failed", error);
        return "failed";
    }
}

export type KitPurchaseResult = "owned" | "unavailable" | "cancelled" | "failed" | "pending";

/** Open checkout for the Illuminator's Kit. */
export async function purchaseKit(): Promise<KitPurchaseResult> {
    if (store.get().ownsKit) return "owned";
    if (!kitPurchasable()) return "unavailable";

    telemetry.record("offer_clicked", { product_id: PRODUCT_KIT });
    telemetry.record("iap_purchase_started", { product_id: PRODUCT_KIT, price: catalogPrice });
    try {
        const outcome = await coordinator.purchase(PRODUCT_KIT, PLATFORM_IDS.illuminatorsKitItem);
        telemetry.record(outcome.status === "confirmed" ? "iap_purchase_complete" : "iap_purchase_failed", {
            product_id: PRODUCT_KIT,
            status: outcome.status,
        });
        if (outcome.status === "confirmed") return "owned";
        if (outcome.status === "cancelled") return "cancelled";
        if (outcome.status === "unknown") return "pending";
        return "failed";
    } catch (error) {
        telemetry.record("iap_purchase_failed", { product_id: PRODUCT_KIT, status: "threw" });
        console.warn("[monetization] checkout failed", error);
        return "failed";
    }
}

/**
 * The shop screen was opened. Separate from `markOfferSeen`, which is a
 * once-ever state change: the store impression must be recorded on every visit
 * or the monetization funnel has no denominator.
 */
export function recordStoreOpened(): void {
    telemetry.record("store_opened", { placement: "kit_screen" });
    telemetry.record("offer_shown", { product_id: PRODUCT_KIT, price: catalogPrice });
    if (potOfferUnlocked()) telemetry.record("offer_shown", { product_id: PRODUCT_POT, price: potPrice() });
}

/** Mark the offer as seen so it stops being pushed and becomes a menu entry. */
export function markOfferSeen(): void {
    if (store.get().kitOfferSeen) return;
    store.patch({ kitOfferSeen: true });
    telemetry.record("offer_shown", { product_id: PRODUCT_KIT, price: catalogPrice });
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
        await syncPotBalance("boot");

        if (potPurchasable()) {
            const pot = await getShopItem(PLATFORM_IDS.potOfInkItem);
            potPriceText = pot?.price
                ? `${pot.price.value} ${pot.price.type === "bucks" ? "RB" : pot.price.type}`
                : null;
        }

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
        await syncPotBalance("resume");
    },

    /** Reset per-day counters when the trusted day rolls over. */
    rolloverDay(day: string): void {
        const state = store.get();
        if (state.hintDay === day) return;
        store.patch({
            hintDay: day,
            hintsWatchedToday: 0,
            freeHintUsed: false,
            borrowDay: day,
            borrowsToday: 0,
        });
        void saveSystem.flush();
    },
};
