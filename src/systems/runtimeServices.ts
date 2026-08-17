/**
 * Background services: remote configuration, trusted time, telemetry, haptics,
 * and the return-reminder cadence re-arm.
 *
 * Everything here is fire-and-forget and failure-tolerant. Losing LiveOps means
 * falling back to safe defaults; losing trusted time means daily surfaces
 * label themselves non-authoritative; losing analytics means nothing at all.
 * None of it may block boot or throw into gameplay.
 */
import packageJson from "../../package.json";
import {
    cancelLocalNotification,
    fetchLiveOps,
    getRunCapabilities,
    recordAnalytics,
    recordFunnelStep,
    triggerHaptic,
    type HapticStyle,
} from "../sdk/runSdk.ts";
import { refreshServerTime } from "./serverTime.ts";
import { store } from "../state/store.ts";
import { returnReminders } from "./retention/retentionConfig.ts";
import { monetization } from "./monetization.ts";

export interface RuntimeConfig {
    /** Daily prompt surface, killable from LiveOps without a build. */
    dailyPromptEnabled: boolean;
}

// The return-reminder cadence is deliberately NOT remoteable: it is fixed at
// 24/48/72h in returnReminders.ts. A parsed-but-unused delay knob sat here for
// a while and misled LiveOps operators into "tuning" a value nothing read.
const DEFAULTS: Readonly<RuntimeConfig> = Object.freeze({
    dailyPromptEnabled: true,
});

const LEGACY_RETURN_REMINDER_ID = "inkbloom-return-reminder";

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
    return {
        dailyPromptEnabled: typeof root.dailyPromptEnabled === "boolean" ? root.dailyPromptEnabled : true,
    };
}

async function refreshLiveOps(): Promise<void> {
    clearScheduledRefresh();
    const snapshot = await fetchLiveOps();
    if (!snapshot) {
        // KEEP the live config on a failed fetch: resetting to DEFAULTS here
        // yanked an enabled monetization surface for the rest of the session
        // on a single resume-time network blip. Boot stays fail-closed via the
        // initial state; retry only where a host could actually answer —
        // without the capability this null is permanent.
        if (!getRunCapabilities().host) {
            // Outside a RUN host (plain `npm run dev`), monetization surfaces
            // use development defaults so they are visible and testable.
            monetization.applyLiveOps(null, true);
        }
        store.patch({ runtimeReady: true });
        if (getRunCapabilities().liveops) {
            refreshTimer = window.setTimeout(() => startRefreshCycle(), 60_000);
        }
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

/**
 * Re-anchor the whole 24/48/72h return cadence to now.
 *
 * This replaced a single 24h reminder. One ping gives a player exactly one
 * chance to come back; a short cadence gives three without becoming spam, and
 * stopping at 72h is deliberate — a fourth converts nobody and costs the
 * notification permission the first three depend on.
 */
async function rearmNotifications(): Promise<void> {
    const state = store.get();
    if (!state.notificationsEnabled || state.notificationsConsent !== "granted") return;
    // The pre-cadence reminder used its own id; leave it scheduled and the
    // player gets the old generic ping alongside the new specific ones.
    await cancelLocalNotification(LEGACY_RETURN_REMINDER_ID);
    await returnReminders.refreshAll();
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
        // Canonical core-loop name RUN's query filters on. The `game_loaded`
        // funnel step keeps its shipped name; this is the queryable event.
        this.track("game_opened", { version: packageJson.version });
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
