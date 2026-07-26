/** Shop purchase intents with stable idempotency keys and resume reconciliation. */

export interface PendingPurchaseIntent {
    intentId: string;
    productId: string;
    catalogItemId: string;
    idempotencyKey: string;
    createdAtMs: number;
}

export interface PendingPurchaseStore {
    load(): PendingPurchaseIntent | null;
    save(intent: PendingPurchaseIntent): void | Promise<void>;
    clear(): void | Promise<void>;
}

export interface ShopPort<PurchaseResponse = unknown, OrderHistory = unknown> {
    purchase(itemId: string, idempotencyKey: string): Promise<PurchaseResponse>;
    getOrderHistory(options?: unknown): Promise<OrderHistory>;
}

export interface PurchaseCoordinatorConfig<PurchaseResponse, OrderHistory> {
    shop: ShopPort<PurchaseResponse, OrderHistory>;
    pending: PendingPurchaseStore;
    findConfirmedOrder(history: OrderHistory, intent: PendingPurchaseIntent): unknown | null;
    syncEntitlements(): Promise<void>;
    classifyError?(error: unknown): "cancelled" | "failed" | "unknown";
    createId?: () => string;
    now?: () => number;
}

export type PurchaseOutcome<PurchaseResponse = unknown> =
    | { status: "confirmed"; intent: PendingPurchaseIntent; response?: PurchaseResponse; reconciledOrder?: unknown }
    | { status: "cancelled" | "failed"; intent: PendingPurchaseIntent; error: unknown }
    | { status: "unknown"; intent: PendingPurchaseIntent; error: unknown };

export interface PurchaseCoordinator<PurchaseResponse = unknown> {
    purchase(productId: string, catalogItemId: string): Promise<PurchaseOutcome<PurchaseResponse>>;
    reconcilePending(): Promise<PurchaseOutcome<PurchaseResponse> | null>;
    pendingIntent(): PendingPurchaseIntent | null;
}

export function createPurchaseCoordinator<PurchaseResponse = unknown, OrderHistory = unknown>(
    config: PurchaseCoordinatorConfig<PurchaseResponse, OrderHistory>,
): PurchaseCoordinator<PurchaseResponse> {
    const createId = config.createId ?? defaultId;
    const now = config.now ?? Date.now;
    let inFlight: Promise<PurchaseOutcome<PurchaseResponse>> | null = null;

    async function confirm(
        intent: PendingPurchaseIntent,
        response?: PurchaseResponse,
        order?: unknown,
    ): Promise<PurchaseOutcome<PurchaseResponse>> {
        await config.syncEntitlements();
        await config.pending.clear();
        const outcome: PurchaseOutcome<PurchaseResponse> = { status: "confirmed", intent };
        if (response !== undefined) outcome.response = response;
        if (order !== undefined) outcome.reconciledOrder = order;
        return outcome;
    }

    async function reconcile(
        intent: PendingPurchaseIntent,
        cause: unknown,
    ): Promise<PurchaseOutcome<PurchaseResponse>> {
        try {
            const history = await config.shop.getOrderHistory();
            const order = config.findConfirmedOrder(history, intent);
            if (order) return confirm(intent, undefined, order);
        } catch {
            /* preserve the pending intent for the next safe resume */
        }
        return { status: "unknown", intent, error: cause };
    }

    async function handleFailure(
        intent: PendingPurchaseIntent,
        error: unknown,
    ): Promise<PurchaseOutcome<PurchaseResponse>> {
        const status = config.classifyError?.(error) ?? "unknown";
        if (status === "unknown") return reconcile(intent, error);
        await config.pending.clear();
        return { status, intent, error };
    }

    async function attempt(intent: PendingPurchaseIntent): Promise<PurchaseOutcome<PurchaseResponse>> {
        try {
            const response = await config.shop.purchase(intent.catalogItemId, intent.idempotencyKey);
            return await confirm(intent, response);
        } catch (error) {
            return handleFailure(intent, error);
        }
    }

    async function runNew(productId: string, catalogItemId: string): Promise<PurchaseOutcome<PurchaseResponse>> {
        const existing = config.pending.load();
        if (existing) {
            const reconciled = await reconcile(existing, new Error("A purchase outcome is still pending"));
            if (reconciled.status === "confirmed") return reconciled;
            if (existing.productId === productId && existing.catalogItemId === catalogItemId) {
                // This is a new explicit player tap for the same logical order.
                // Retrying its idempotency key cannot create a duplicate charge.
                return attempt(existing);
            }
            return reconciled;
        }

        // ADAPT: persist this slice in the host save before opening checkout.
        const intentId = createId();
        const intent: PendingPurchaseIntent = {
            intentId,
            productId,
            catalogItemId,
            idempotencyKey: `run-game:${productId}:${intentId}`,
            createdAtMs: now(),
        };
        await config.pending.save(intent);
        return attempt(intent);
    }

    return {
        purchase(productId, catalogItemId) {
            if (!inFlight)
                inFlight = runNew(productId, catalogItemId).finally(() => {
                    inFlight = null;
                });
            return inFlight;
        },
        async reconcilePending() {
            const intent = config.pending.load();
            return intent ? reconcile(intent, new Error("Pending purchase requires reconciliation")) : null;
        },
        pendingIntent: () => config.pending.load(),
    };
}

/**
 * LOCAL DEVIATION from the shared helper: upstream falls back to a
 * `Math.random()` id when Web Crypto is missing. An idempotency key is an order
 * identifier, so this game refuses rather than weakens it — and Inkbloom
 * injects its own `createId` regardless, leaving this path unused.
 */
function defaultId(): string {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
