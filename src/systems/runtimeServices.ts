/**
 * Background services: remote configuration, trusted time, telemetry, haptics,
 * and the one local notification this game sends.
 *
 * Everything here is fire-and-forget and failure-tolerant. Losing LiveOps means
 * falling back to safe defaults; losing trusted time means daily surfaces
 * label themselves non-authoritative; losing analytics means nothing at all.
 * None of it may block boot or throw into gameplay.
 */
import packageJson from "../../package.json";
import {
    fetchLiveOps,
    getRunCapabilities,
    rearmLocalNotification,
    recordAnalytics,
    recordFunnelStep,
    triggerHaptic,
    type HapticStyle,
} from "../sdk/runSdk.ts";
import { refreshServerTime } from "./serverTime.ts";
import { store } from "../state/store.ts";
import { t } from "./localization.ts";
import { monetization } from "./monetization.ts";

export interface RuntimeConfig {
    /** Daily prompt surface, killable from LiveOps without a build. */
    dailyPromptEnabled: boolean;
    /** How long after leaving before the reminder fires. */
    notificationDelaySeconds: number;
}

const DEFAULTS: Readonly<RuntimeConfig> = Object.freeze({
    dailyPromptEnabled: true,
    notificationDelaySeconds: 86_400,
});

const RETURN_REMINDER_ID = "inkbloom-return-reminder";

let config: RuntimeConfig = { ...DEFAULTS };
let refreshTimer = 0;

function clearScheduledRefresh(): void {
    if (!refreshTimer) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = 0;
}

function normalize(values: Record<string, unknown>): RuntimeConfig {
    const root =
        values.inkbloom_runtime && typeof values.inkbloom_runtime === "object"
            ? (values.inkbloom_runtime as Record<string, unknown>)
            : values;
    const delay = Number(root.notificationDelaySeconds);
    return {
        dailyPromptEnabled: typeof root.dailyPromptEnabled === "boolean" ? root.dailyPromptEnabled : true,
        notificationDelaySeconds: Number.isFinite(delay)
            ? Math.max(3_600, Math.min(delay, 604_800))
            : DEFAULTS.notificationDelaySeconds,
    };
}

async function refreshLiveOps(): Promise<void> {
    clearScheduledRefresh();
    const snapshot = await fetchLiveOps();
    if (!snapshot) {
        config = { ...DEFAULTS };
        // Outside a RUN host (plain `npm run dev`), monetization surfaces use
        // development defaults so they are visible and testable. Inside a host
        // that returned nothing, they fail closed.
        monetization.applyLiveOps(null, !getRunCapabilities().host);
        store.patch({ runtimeReady: true, runtimeConfigVersion: null });
        return;
    }
    config = normalize(snapshot.values);
    monetization.applyLiveOps(snapshot.values, false);
    store.patch({ runtimeReady: true, runtimeConfigVersion: snapshot.configVersion });
    if (snapshot.nextChangeAt) {
        const delay = Math.max(1_000, Math.min(snapshot.nextChangeAt - Date.now() + 500, 2_147_000_000));
        refreshTimer = window.setTimeout(() => startRefreshCycle(), delay);
    }
}

async function refreshTime(): Promise<void> {
    store.patch({ trustedTimeReady: await refreshServerTime() });
}

async function rearmNotifications(): Promise<void> {
    const state = store.get();
    if (!state.notificationsEnabled || state.notificationsConsent !== "granted") return;
    await rearmLocalNotification({
        id: RETURN_REMINDER_ID,
        title: t("NotificationTitle"),
        body: t("NotificationReEngagementBody"),
        delaySeconds: config.notificationDelaySeconds,
    });
}

async function refreshRuntime(): Promise<void> {
    await Promise.allSettled([refreshTime(), refreshLiveOps()]);
    await monetization.bootstrap();
    await rearmNotifications();
}

function startRefreshCycle(): void {
    void refreshRuntime().catch((error) => {
        console.warn("[runtime] background refresh failed", error);
    });
}

export const runtimeServices = {
    get config(): Readonly<RuntimeConfig> {
        return config;
    },

    bootstrap(): void {
        startRefreshCycle();
        this.track("game_boot", {
            version: packageJson.version,
            host: getRunCapabilities().host,
            discoveries: store.get().discoveryCount,
        });
    },

    resume(): void {
        startRefreshCycle();
        void monetization.resume().catch(() => undefined);
    },

    rearmNotifications(): void {
        void rearmNotifications().catch((error) => {
            console.warn("[runtime] notification refresh failed", error);
        });
    },

    track(eventName: string, payload: Record<string, unknown> = {}): void {
        void recordAnalytics(eventName, { ...payload, build_version: packageJson.version });
    },

    funnel(step: number, name: string, funnel: string, funnelOrder = 0): void {
        void recordFunnelStep(step, name, funnel, funnelOrder);
    },

    async haptic(style: HapticStyle): Promise<boolean> {
        return store.get().hapticsEnabled ? triggerHaptic(style) : false;
    },
};
