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
import { getRunCapabilities, withTimeout } from "./runSdk.ts";

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
        return RundotGameAPI.shop.purchase(itemId, idempotencyKey);
    },
    async getOrderHistory(): Promise<ShopOrderHistoryResponse> {
        if (!hasShop()) throw new PurchaseUnavailableError();
        return withTimeout(RundotGameAPI.shop.getOrderHistory({ limit: 25 }), 8_000, "shop.getOrderHistory");
    },
};

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
    if (error instanceof PurchaseUnavailableError) return "failed";
    const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
    if (!message) return "unknown";
    if (message.includes("cancel") || message.includes("dismiss") || message.includes("abort")) return "cancelled";
    if (message.includes("not found") || message.includes("inactive") || message.includes("invalid item")) {
        return "failed";
    }
    if (message.includes("insufficient")) return "failed";
    return "unknown";
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
