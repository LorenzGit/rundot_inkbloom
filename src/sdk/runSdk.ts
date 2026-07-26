/**
 * Typed RUN boundary. SDK 5.24 initializes on import; this facade waits only
 * for a bounded host handshake and keeps platform calls out of game/UI code.
 *
 * Posture (applies to ALL SDK usage): every RundotGameAPI call can reject,
 * and an unhandled rejection crashes the game — so everything here is
 * try/catch'd, and outside the RUN host (plain `vite dev` in a browser) the
 * app must boot and run anyway.
 */
import RundotGameAPI from "@series-inc/rundot-game-sdk/api";
import { inkAudio } from "../audio/inkAudio.ts";
// Type-only import from the package root (the /api entry doesn't re-export it);
// erased at build time, so no extra runtime code is pulled in.
import { HapticFeedbackStyle } from "@series-inc/rundot-game-sdk";
import type { IdentityChangedEvent, Subscription } from "@series-inc/rundot-game-sdk";

let _ready = false;

export interface RunCapabilities {
    host: boolean;
    mock: boolean;
    storage: boolean;
    analytics: boolean;
    liveops: boolean;
    notifications: boolean;
    haptics: boolean;
    ads: boolean;
    purchases: boolean;
    subscriptions: boolean;
}

const OFFLINE_CAPABILITIES: RunCapabilities = {
    host: false,
    mock: false,
    storage: false,
    analytics: false,
    liveops: false,
    notifications: false,
    haptics: false,
    ads: false,
    purchases: false,
    subscriptions: false,
};

let capabilities: RunCapabilities = OFFLINE_CAPABILITIES;

function sdkNamespace(name: string): boolean {
    return typeof (RundotGameAPI as unknown as Record<string, unknown>)[name] === "object";
}

function snapshotCapabilities(): RunCapabilities {
    if (!_ready) return OFFLINE_CAPABILITIES;
    const environment = RundotGameAPI._environmentData?.capabilities;
    return {
        host: true,
        mock: RundotGameAPI.isMock(),
        storage: sdkNamespace("appStorage"),
        analytics: sdkNamespace("analytics"),
        liveops: sdkNamespace("liveops"),
        notifications: sdkNamespace("notifications"),
        // PITFALL: there is NO runtime RundotGameAPI.haptics namespace (the
        // HapticsApi interface in the .d.ts is types-only). Support comes
        // from DeviceInfo, and the trigger lives on the API root.
        haptics: (() => {
            try {
                const device = RundotGameAPI.system.getDevice();
                return device?.haptics?.supported === true && device?.haptics?.enabled === true;
            } catch {
                return false;
            }
        })(),
        ads: environment?.ads === true,
        purchases: environment?.purchases === true,
        subscriptions: environment?.subscriptions === true,
    };
}

export function getRunCapabilities(): Readonly<RunCapabilities> {
    return capabilities;
}

export interface RunSafeArea {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

const ZERO_SAFE_AREA: Readonly<RunSafeArea> = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

export function getRunSafeArea(): Readonly<RunSafeArea> {
    if (!_ready) return ZERO_SAFE_AREA;
    try {
        const area = RundotGameAPI.system.getSafeArea();
        return {
            top: Math.max(0, Number(area.top) || 0),
            right: Math.max(0, Number(area.right) || 0),
            bottom: Math.max(0, Number(area.bottom) || 0),
            left: Math.max(0, Number(area.left) || 0),
        };
    } catch {
        return ZERO_SAFE_AREA;
    }
}

/** Publish host insets as CSS variables without coupling UI code to the SDK. */
export function applyRunSafeArea(): Readonly<RunSafeArea> {
    const area = getRunSafeArea();
    const root = document.documentElement;
    if (import.meta.env.DEV) {
        const count = Number(root.dataset.safeAreaRefreshCount ?? 0);
        root.dataset.safeAreaRefreshCount = String(count + 1);
    }
    // Outside RUN, leave the stylesheet's env(safe-area-inset-*) fallbacks
    // intact. Publishing zero-valued host data would erase real browser insets.
    if (!_ready) return area;
    root.style.setProperty("--safe-top", `${area.top}px`);
    root.style.setProperty("--safe-right", `${area.right}px`);
    root.style.setProperty("--safe-bottom", `${area.bottom}px`);
    root.style.setProperty("--safe-left", `${area.left}px`);
    return area;
}

export async function withTimeout<T>(operation: Promise<T>, timeoutMs = 2_000, label = "RUN operation"): Promise<T> {
    let timeoutId = 0;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    });
    try {
        return await Promise.race([operation, timeout]);
    } finally {
        window.clearTimeout(timeoutId);
    }
}

/** True once the import-initialized SDK reports an attached host/mock. */
export function sdkReady(): boolean {
    return _ready;
}

/**
 * SDK 5.24 initializes on import. In a RUN iframe, allow a short bounded
 * handshake; in ordinary local development return immediately.
 */
export async function initSdk(): Promise<boolean> {
    const embedded = window.parent !== window;
    const deadline = performance.now() + (embedded ? 1_500 : 0);
    do {
        try {
            if (RundotGameAPI.isAvailable() || RundotGameAPI.isMock()) {
                _ready = true;
                break;
            }
        } catch {
            break;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    } while (performance.now() < deadline);

    capabilities = snapshotCapabilities();
    if (!_ready) {
        console.info("[runSdk] RUN host unavailable; using local non-authoritative fallbacks");
    }
    return _ready;
}

export async function readAppStorage(key: string): Promise<{ ok: boolean; value: string | null }> {
    if (!capabilities.storage) return { ok: false, value: null };
    try {
        const value = await withTimeout(RundotGameAPI.appStorage.getItem(key), 2_000, "appStorage.getItem");
        return { ok: true, value };
    } catch (error) {
        console.warn("[runSdk] appStorage read failed", error);
        return { ok: false, value: null };
    }
}

export async function writeAppStorage(key: string, value: string): Promise<boolean> {
    if (!capabilities.storage) return false;
    try {
        await withTimeout(RundotGameAPI.appStorage.setItem(key, value), 2_000, "appStorage.setItem");
        return true;
    } catch (error) {
        console.warn("[runSdk] appStorage write failed", error);
        return false;
    }
}

export async function requestServerEpochMs(): Promise<number | null> {
    if (!_ready) return null;
    try {
        const result = await withTimeout(RundotGameAPI.requestTimeAsync(), 2_000, "requestTimeAsync");
        return typeof result.serverTime === "number" ? result.serverTime : null;
    } catch (error) {
        console.warn("[runSdk] trusted time unavailable", error);
        return null;
    }
}

export type NotificationPreferenceResult = "enabled" | "disabled" | "unavailable" | "failed";

export async function setNotificationPreference(enabled: boolean): Promise<NotificationPreferenceResult> {
    if (!capabilities.notifications) return "unavailable";
    try {
        await withTimeout(
            RundotGameAPI.notifications.setLocalNotificationsEnabled(enabled),
            4_000,
            "notifications.setLocalNotificationsEnabled",
        );
        const actual = await withTimeout(
            RundotGameAPI.notifications.isLocalNotificationsEnabled(),
            2_000,
            "notifications.isLocalNotificationsEnabled",
        );
        if (actual !== enabled) return "failed";
        return enabled ? "enabled" : "disabled";
    } catch (error) {
        console.warn("[runSdk] notification preference failed", error);
        return "failed";
    }
}

export type HapticStyle = "light" | "medium" | "heavy" | "success" | "warning" | "error";

export async function triggerHaptic(style: HapticStyle): Promise<boolean> {
    if (capabilities.haptics) {
        try {
            const map: Record<HapticStyle, HapticFeedbackStyle> = {
                light: HapticFeedbackStyle.Light,
                medium: HapticFeedbackStyle.Medium,
                heavy: HapticFeedbackStyle.Heavy,
                success: HapticFeedbackStyle.Success,
                warning: HapticFeedbackStyle.Warning,
                error: HapticFeedbackStyle.Error,
            };
            await withTimeout(RundotGameAPI.triggerHapticAsync(map[style]), 1_000, "triggerHapticAsync");
            return true;
        } catch {
            // fall through to the web-vibration fallback
        }
    }
    // Outside a haptics-capable host: navigator.vibrate covers Android web;
    // iOS Safari has no vibration API, so this is a silent no-op there.
    try {
        const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
        if (typeof nav.vibrate === "function") {
            const patterns: Record<HapticStyle, number | number[]> = {
                light: 10,
                medium: 20,
                heavy: 40,
                success: [15, 40, 15],
                warning: [25, 40, 25],
                error: [35, 50, 35],
            };
            return nav.vibrate(patterns[style]);
        }
    } catch {
        // no vibration surface — fine
    }
    return false;
}

export interface RunLiveOpsSnapshot {
    values: Record<string, unknown>;
    configVersion: string;
    nextChangeAt: number | null;
    activeOverrideIds: string[];
}

export async function fetchLiveOps(): Promise<RunLiveOpsSnapshot | null> {
    if (!capabilities.liveops) return null;
    try {
        const result = await withTimeout(RundotGameAPI.liveops.getConfigAsync(), 3_000, "liveops.getConfigAsync");
        return {
            values: result.values,
            configVersion: result.configVersion,
            nextChangeAt: result.nextChangeAt,
            activeOverrideIds: result.activeOverrideIds,
        };
    } catch (error) {
        console.warn("[runSdk] LiveOps unavailable; defaults retained", error);
        return null;
    }
}

export async function recordAnalytics(eventName: string, payload: Record<string, unknown> = {}): Promise<boolean> {
    if (!capabilities.analytics) return false;
    try {
        await withTimeout(
            RundotGameAPI.analytics.recordCustomEvent(eventName, payload),
            1_500,
            "analytics.recordCustomEvent",
        );
        return true;
    } catch {
        return false;
    }
}

export async function recordFunnelStep(step: number, name: string, funnel: string, funnelOrder = 0): Promise<boolean> {
    if (!capabilities.analytics) return false;
    try {
        await withTimeout(
            RundotGameAPI.analytics.trackFunnelStep(step, name, funnel, funnelOrder),
            1_500,
            "analytics.trackFunnelStep",
        );
        return true;
    } catch {
        return false;
    }
}

export async function rearmLocalNotification(input: {
    id: string;
    legacyIds?: readonly string[];
    title: string;
    body: string;
    delaySeconds: number;
}): Promise<boolean> {
    if (!capabilities.notifications) return false;
    try {
        for (const id of new Set([input.id, ...(input.legacyIds ?? [])])) {
            await withTimeout(RundotGameAPI.notifications.cancelNotification(id), 1_500, "notifications.cancel");
        }
        const result = await withTimeout(
            RundotGameAPI.notifications.submitMessageAsync({
                channels: ["local"],
                title: input.title,
                body: input.body,
                delaySeconds: Math.max(60, input.delaySeconds),
                notificationId: input.id,
                collapseKey: input.id,
            }),
            3_000,
            "notifications.submitMessage",
        );
        return result.results.some((channel) => channel.channel === "local" && channel.status === "scheduled");
    } catch (error) {
        console.warn("[runSdk] notification re-arm failed", error);
        return false;
    }
}

export type VerifiedActionResult = "verified" | "unavailable" | "cancelled" | "failed";

export async function showVerifiedRewardedAd(id: string, name: string): Promise<VerifiedActionResult> {
    if (!capabilities.ads) return "unavailable";
    try {
        const ready = await withTimeout(RundotGameAPI.ads.isRewardedAdReadyAsync(), 2_000, "ads.ready");
        if (!ready) return "unavailable";
        inkAudio.setAdVisible(true);
        let completed = false;
        try {
            // Do not timeout a user-mediated overlay: the audio interruption
            // must last until the host tells us it has actually closed.
            completed = await RundotGameAPI.ads.showRewardedAdAsync({ adDisplayId: id, adDisplayName: name });
        } finally {
            inkAudio.setAdVisible(false);
        }
        return completed === true ? "verified" : "cancelled";
    } catch {
        return "failed";
    }
}

export async function showVerifiedInterstitialAd(id: string, name: string): Promise<VerifiedActionResult> {
    if (!capabilities.ads) return "unavailable";
    try {
        const ready = await withTimeout(
            RundotGameAPI.ads.isInterstitialAdReadyAsync(),
            2_000,
            "ads.interstitial.ready",
        );
        if (!ready) return "unavailable";
        inkAudio.setAdVisible(true);
        let displayed = false;
        try {
            displayed = await RundotGameAPI.ads.showInterstitialAd({ adDisplayId: id, adDisplayName: name });
        } finally {
            inkAudio.setAdVisible(false);
        }
        return displayed === true ? "verified" : "unavailable";
    } catch {
        return "failed";
    }
}

export async function purchaseVerifiedShopItem(itemId: string, idempotencyKey: string): Promise<VerifiedActionResult> {
    if (!capabilities.purchases || !sdkNamespace("shop")) return "unavailable";
    try {
        const result = await withTimeout(RundotGameAPI.shop.purchase(itemId, idempotencyKey), 90_000, "shop.purchase");
        return result.success === true ? "verified" : "failed";
    } catch {
        return "failed";
    }
}

/** Continue Android back navigation once the template's own stack is empty. */
export async function requestHostExit(reason = "template-root-back"): Promise<boolean> {
    if (!_ready) return false;
    try {
        return await withTimeout(RundotGameAPI.requestPopOrQuit({ reason }), 4_000, "requestPopOrQuit");
    } catch (error) {
        console.warn("[runSdk] host exit request failed", error);
        return false;
    }
}

/**
 * Lifecycle callbacks are `() => void` per the SDK types. Async handlers are
 * fine to pass: a Promise-returning function is assignable where a void
 * return is expected (the SDK just won't await it).
 */
export type LifecycleCallback = () => void;

/** All seven hooks are optional. See registerLifecycles for what each means. */
export interface LifecycleConfig {
    onPause?: LifecycleCallback;
    onResume?: LifecycleCallback;
    onSleep?: LifecycleCallback;
    onAwake?: LifecycleCallback;
    onQuit?: LifecycleCallback;
    onBackButton?: LifecycleCallback;
    onIdentityChanged?: (event: IdentityChangedEvent) => void;
}

/**
 * Register host lifecycle callbacks. All seven hooks are optional; each SDK
 * hook returns an { unsubscribe() } handle, collected so hot-reload / scene
 * swaps can detach cleanly.
 *
 * Hook meanings (SDK docs):
 *   onPause/onResume — host overlay or brief focus loss: pause/resume loops + audio
 *   onSleep/onAwake  — long background suspend: persist progress / refresh stale data
 *   onQuit           — host teardown: last-chance flush (may NOT fire on hard close)
 *   onBackButton     — Android back button (no-op elsewhere); without a handler the
 *                      host quits by default — call RundotGameAPI.requestPopOrQuit()
 *                      yourself when your in-game back navigation is exhausted
 */
export function registerLifecycles({
    onPause,
    onResume,
    onSleep,
    onAwake,
    onQuit,
    onBackButton,
    onIdentityChanged,
}: LifecycleConfig = {}): { unsubscribeAll(): void } {
    const subs: Subscription[] = [];
    const hook = (name: keyof LifecycleConfig, cb: LifecycleCallback | undefined) => {
        if (!cb) return;
        try {
            subs.push(RundotGameAPI.lifecycles[name](cb));
        } catch (err) {
            console.warn(`[runSdk] lifecycles.${name} registration failed`, err);
        }
    };
    hook("onPause", onPause);
    hook("onResume", onResume);
    hook("onSleep", onSleep);
    hook("onAwake", onAwake);
    hook("onQuit", onQuit);
    hook("onBackButton", onBackButton);
    if (onIdentityChanged) {
        try {
            subs.push(RundotGameAPI.lifecycles.onIdentityChanged(onIdentityChanged));
        } catch (error) {
            console.warn("[runSdk] lifecycles.onIdentityChanged registration failed", error);
        }
    }
    return {
        unsubscribeAll() {
            for (const s of subs) {
                try {
                    s?.unsubscribe?.();
                } catch {
                    /* already gone */
                }
            }
            subs.length = 0;
        },
    };
}
