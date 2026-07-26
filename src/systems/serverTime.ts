import { getRunCapabilities, requestServerEpochMs } from "../sdk/runSdk.ts";

let serverBaseMs: number | null = null;
let monotonicBaseMs: number | null = null;

export async function refreshServerTime(): Promise<boolean> {
    const epochMs = await requestServerEpochMs();
    if (epochMs === null) return false;
    serverBaseMs = epochMs;
    monotonicBaseMs = performance.now();
    return true;
}

export function hasServerTime(): boolean {
    return serverBaseMs !== null && monotonicBaseMs !== null;
}

/**
 * Trusted while a RUN sample exists. Local development intentionally uses the
 * device clock; host-side reward grants must additionally require
 * `hasServerTime()` so a failed host clock cannot become authoritative.
 */
export function serverNow(): number {
    if (serverBaseMs !== null && monotonicBaseMs !== null) {
        return serverBaseMs + (performance.now() - monotonicBaseMs);
    }
    return Date.now();
}

export function canUseTimeGates(): boolean {
    return !getRunCapabilities().host || hasServerTime();
}

export function localDayKey(epochMs: number): string {
    const date = new Date(epochMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function msUntilNextLocalMidnight(epochMs: number): number {
    const next = new Date(epochMs);
    next.setHours(24, 0, 0, 0);
    return Math.max(0, next.getTime() - epochMs);
}

export function formatCountdown(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(durationMs / 1_000));
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
