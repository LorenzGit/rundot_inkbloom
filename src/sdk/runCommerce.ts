/**
 * The commerce and score half of the RUN boundary.
 *
 * Kept separate from `runSdk.ts` (lifecycle, storage, ads, haptics) because
 * these are the calls where being wrong costs a player money or an
 * unearned grant. The rules here are absolute:
 *
 *   - ownership is **read from the host**, never inferred from a UI action;
 *   - a purchase is only ever confirmed by a host reply or a reconciled order;
 *   - every call is bounded, try/caught, and fails closed to "unavailable",
 *     which the UI renders as a disabled surface rather than a free grant.
 */
import RundotGameAPI from "@series-inc/rundot-game-sdk/api";
import type { ShopOrderHistoryResponse, ShopPurchaseResponse, StorefrontItem } from "@series-inc/rundot-game-sdk";
import { getRunCapabilities, withHostOverlay, withTimeout } from "./runSdk.ts";
import {
    checkoutErrorCode,
    verdictForCode,
    verdictForMessage,
} from "../helpers/monetization/checkoutClassification.ts";

function namespace(name: string): boolean {
    return typeof (RundotGameAPI as unknown as Record<string, unknown>)[name] === "object";
}

export function hasEntitlements(): boolean {
    return getRunCapabilities().host && namespace("entitlements");
}

export function hasShop(): boolean {
    return getRunCapabilities().purchases && namespace("shop");
}

export function hasLeaderboard(): boolean {
    return getRunCapabilities().host && namespace("leaderboard");
}

/**
 * How many of an entitlement the player owns.
 *
 * `null` means "the host could not tell us", which is materially different
 * from `0`: callers must keep whatever they last knew rather than revoking a
 * paid benefit because a request timed out.
 */
export async function getEntitlementQuantity(entitlementId: string): Promise<number | null> {
    if (!hasEntitlements()) return null;
    try {
        const quantity = await withTimeout(
            RundotGameAPI.entitlements.getQuantity(entitlementId),
            4_000,
            "entitlements.getQuantity",
        );
        return typeof quantity === "number" && Number.isFinite(quantity) ? quantity : null;
    } catch (error) {
        console.warn("[commerce] entitlement read failed", error);
        return null;
    }
}

/**
 * Spend from a consumable entitlement.
 *
 * Returns the balance the server reports afterwards, or `null` when the host
 * could not be reached. `null` is not "it worked" and not "it failed" — the
 * caller must not hand out the thing that was paid for, and must not decrement
 * anything locally either.
 *
 * A referenceId is captured from the first attempt and reused on the retry, so
 * a failure between the consume and the grant cannot charge the player twice.
 */
export async function consumeEntitlement(
    entitlementId: string,
    quantity: number,
    reason: string,
): Promise<number | null> {
    if (!hasEntitlements()) return null;
    let referenceId: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const entitlement = await withTimeout(
                RundotGameAPI.entitlements.consumeEntitlement(
                    entitlementId,
                    quantity,
                    (_result, reference) => {
                        referenceId = reference;
                    },
                    reason,
                    referenceId,
                ),
                6_000,
                "entitlements.consumeEntitlement",
            );
            const left = (entitlement as { quantity?: unknown } | null)?.quantity;
            return typeof left === "number" && Number.isFinite(left) ? left : 0;
        } catch (error) {
            if (attempt === 1 || referenceId === undefined) {
                console.warn("[commerce] entitlement consume failed", error);
                return null;
            }
        }
    }
    return null;
}

/** Live catalog entry, used so the shop shows the real price and never a guess. */
export async function getShopItem(itemId: string): Promise<StorefrontItem | null> {
    if (!hasShop()) return null;
    try {
        return await withTimeout(RundotGameAPI.shop.getItemDetail(itemId), 6_000, "shop.getItemDetail");
    } catch (error) {
        console.warn("[commerce] catalog read failed", error);
        return null;
    }
}

/** Ports handed to the purchase coordinator, which owns retry and reconciliation. */
export const shopPort = {
    async purchase(itemId: string, idempotencyKey: string): Promise<ShopPurchaseResponse> {
        if (!hasShop()) throw new PurchaseUnavailableError();
        // A checkout is user-mediated and may legitimately take a long time.
        // Bounding it too tightly turns a completed order into an "unknown".
        const response = await withHostOverlay(() => RundotGameAPI.shop.purchase(itemId, idempotencyKey));
        // `success` only reports that the host accepted the request, and
        // replaying an idempotency key returns the ORIGINAL order verbatim —
        // so an order still in `pending_payment` also arrives as
        // `success: true`. Confirming on that would grant an unpaid purchase.
        if (!response.success || response.order?.status !== "fulfilled") {
            throw new UnsettledOrderError(response.order?.status);
        }
        return response;
    },
    async getOrderHistory(): Promise<ShopOrderHistoryResponse> {
        if (!hasShop()) throw new PurchaseUnavailableError();
        return withTimeout(RundotGameAPI.shop.getOrderHistory({ limit: 25 }), 8_000, "shop.getOrderHistory");
    },
};

/** The host accepted the order but has not settled it — outcome still open. */
export class UnsettledOrderError extends Error {
    constructor(status: string | undefined) {
        super(`RUN shop returned order status "${status ?? "none"}"`);
        this.name = "UnsettledOrderError";
    }
}

export class PurchaseUnavailableError extends Error {
    constructor() {
        super("RUN shop is unavailable");
        this.name = "PurchaseUnavailableError";
    }
}

/**
 * Did this order actually go through?
 *
 * Matched on the idempotency key rather than the item, so a second purchase of
 * the same product can never be mistaken for the pending one.
 */
export function findConfirmedOrder(history: ShopOrderHistoryResponse, idempotencyKey: string): unknown | null {
    if (!history?.success || !Array.isArray(history.orders)) return null;
    const settled = new Set(["completed", "fulfilled", "succeeded", "granted"]);
    for (const order of history.orders) {
        if (order.idempotencyKey !== idempotencyKey) continue;
        if (settled.has(String(order.status).toLowerCase())) return order;
    }
    return null;
}

/**
 * Classify a failed checkout.
 *
 * `cancelled` and `failed` are terminal and clear the intent. Anything we do
 * not recognise — a bridge timeout, an unknown host error — stays `unknown`,
 * because an order may still be in flight and must remain reconcilable.
 */
export function classifyPurchaseError(error: unknown): "cancelled" | "failed" | "unknown" {
    // The checkout never opened — nothing can have been charged.
    if (error instanceof PurchaseUnavailableError) return "failed";
    // An order the host never settled may already have taken the money.
    if (error instanceof UnsettledOrderError) return "unknown";
    // The host names most declines outright; that code is the only reliable way
    // to tell a clean, uncharged refusal from an ambiguous failure.
    const code = checkoutErrorCode(error);
    if (code) {
        const verdict = verdictForCode(code);
        if (verdict !== "unknown") return verdict;
    }
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (!message) return "unknown";
    // Inkbloom's own host phrasings, then the shared fallback.
    const text = message.toLowerCase();
    if (text.includes("dismiss") || text.includes("abort")) return "cancelled";
    if (text.includes("not found") || text.includes("inactive") || text.includes("invalid item")) return "failed";
    return verdictForMessage(message);
}

let scoreSubmitInFlight = false;
let lastSubmittedScore = -1;
const sessionStartedAt = Date.now();

/**
 * Publish the discovery count to the RUN leaderboard.
 *
 * Discoveries are the only score this game has, and they only ever go up, so a
 * submission is skipped unless it beats what was already sent this session.
 */
export async function submitDiscoveryScore(count: number): Promise<boolean> {
    if (!hasLeaderboard() || count <= lastSubmittedScore || scoreSubmitInFlight) return false;
    scoreSubmitInFlight = true;
    try {
        const token = await withTimeout(RundotGameAPI.leaderboard.createScoreToken(), 4_000, "leaderboard.token");
        // RUN accepts durations between 10 s and one hour. A discovery found in
        // the first few seconds is real, so the value is clamped rather than
        // the submission dropped.
        const elapsedSeconds = Math.round((Date.now() - sessionStartedAt) / 1_000);
        const result = await withTimeout(
            RundotGameAPI.leaderboard.submitScore({
                token: token?.token,
                score: count,
                duration: Math.min(3_600, Math.max(10, elapsedSeconds)),
            }),
            6_000,
            "leaderboard.submitScore",
        );
        if (result?.accepted) lastSubmittedScore = count;
        return result?.accepted === true;
    } catch (error) {
        console.warn("[commerce] score submission failed", error);
        return false;
    } finally {
        scoreSubmitInFlight = false;
    }
}
