/**
 * Versioned progress.
 *
 * RUN app storage when the host is attached, `localStorage` otherwise, and a
 * playable game either way. Every field is re-validated on load rather than
 * trusted: a save is player-adjacent data and a corrupt one must degrade to
 * defaults, never to a crash or an unearned entitlement.
 *
 * What is deliberately NOT saved: the page itself. A sheet is a working
 * surface, not a document — it is cheaper, calmer, and much more in keeping
 * with the game to open on clean paper than to restore thirty thousand cells.
 * What is saved is everything the player earned by using it.
 */
import { getRunCapabilities, readAppStorage, writeAppStorage } from "../sdk/runSdk.ts";
import { store, type AppState } from "../state/store.ts";
import { DISCOVERIES } from "../game/sim/discoveries.ts";
import { INKS } from "../game/sim/elements.ts";
import { PAPERS, type PaperId } from "../game/constants.ts";
import type { PendingPurchaseIntent } from "../helpers/monetization/purchaseCoordinator.ts";

const SAVE_KEY = "inkbloom-save";
export const SAVE_VERSION = 1;

const DISCOVERY_IDS: readonly string[] = DISCOVERIES.map((entry) => entry.id);

export interface InkbloomSaveV1 {
    version: 1;
    settings: Pick<
        AppState,
        | "musicEnabled"
        | "musicVolume"
        | "sfxEnabled"
        | "sfxVolume"
        | "notificationsEnabled"
        | "notificationsOptOut"
        | "notificationsConsent"
        | "hapticsEnabled"
        | "reducedMotion"
        | "locale"
        | "quality"
    >;
    progress: Pick<
        AppState,
        "discoveries" | "pagesTorn" | "strokes" | "selectedInk" | "largeBrush" | "mirrorBrush" | "colophonSeen"
    >;
    hints: Pick<AppState, "revealedHints" | "hintDay" | "freeHintUsed" | "hintsWatchedToday">;
    prompt: Pick<AppState, "promptDay" | "promptId" | "promptSolved" | "promptLastKeptDay" | "promptStreak">;
    /**
     * `potNudges` is a cache of the server's consumable balance, kept only so a
     * cold boot can render a number before the host answers. It is overwritten
     * by the first real entitlement read and is never spent from.
     *
     * A *borrowed* ink is deliberately absent: a loan that survived a reinstall
     * would be an ink the player owns, which is not what was offered.
     */
    commerce: Pick<AppState, "ownsKit" | "paper" | "kitOfferSeen" | "potNudges" | "borrowDay" | "borrowsToday"> & {
        /** An order that was started but never confirmed, for resume on next boot. */
        pendingPurchase: PendingPurchaseIntent | null;
    };
}

export type SaveSource = "run" | "local" | "defaults";

// -------------------------------------------------------------- field guards

function booleanOr(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function clamp01(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function counter(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : fallback;
}

function dayKeyOrNull(value: unknown): string | null {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Only ids this build actually knows about survive a load. */
function knownIds(value: unknown, allowed: readonly string[]): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of value) {
        if (typeof entry !== "string" || !allowed.includes(entry) || seen.has(entry)) continue;
        seen.add(entry);
        result.push(entry);
    }
    return result;
}

function pendingIntent(value: unknown): PendingPurchaseIntent | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PendingPurchaseIntent>;
    if (
        typeof candidate.intentId !== "string" ||
        typeof candidate.productId !== "string" ||
        typeof candidate.catalogItemId !== "string" ||
        typeof candidate.idempotencyKey !== "string" ||
        typeof candidate.createdAtMs !== "number" ||
        !Number.isFinite(candidate.createdAtMs)
    ) {
        return null;
    }
    return {
        intentId: candidate.intentId.slice(0, 120),
        productId: candidate.productId.slice(0, 120),
        catalogItemId: candidate.catalogItemId.slice(0, 120),
        idempotencyKey: candidate.idempotencyKey.slice(0, 200),
        createdAtMs: candidate.createdAtMs,
    };
}

// ------------------------------------------------------------------ snapshot

let cachedPendingPurchase: PendingPurchaseIntent | null = null;

export function readPendingPurchase(): PendingPurchaseIntent | null {
    return cachedPendingPurchase;
}

export function writePendingPurchase(intent: PendingPurchaseIntent | null): void {
    cachedPendingPurchase = intent;
}

function snapshot(): InkbloomSaveV1 {
    const state = store.get();
    return {
        version: SAVE_VERSION,
        settings: {
            musicEnabled: state.musicEnabled,
            musicVolume: state.musicVolume,
            sfxEnabled: state.sfxEnabled,
            sfxVolume: state.sfxVolume,
            notificationsEnabled: state.notificationsEnabled,
            notificationsOptOut: state.notificationsOptOut,
            notificationsConsent: state.notificationsConsent,
            hapticsEnabled: state.hapticsEnabled,
            reducedMotion: state.reducedMotion,
            locale: state.locale,
            quality: state.quality,
        },
        progress: {
            discoveries: state.discoveries,
            pagesTorn: state.pagesTorn,
            strokes: state.strokes,
            selectedInk: state.selectedInk,
            largeBrush: state.largeBrush,
            mirrorBrush: state.mirrorBrush,
            colophonSeen: state.colophonSeen,
        },
        hints: {
            revealedHints: state.revealedHints,
            hintDay: state.hintDay,
            freeHintUsed: state.freeHintUsed,
            hintsWatchedToday: state.hintsWatchedToday,
        },
        prompt: {
            promptDay: state.promptDay,
            promptId: state.promptId,
            promptSolved: state.promptSolved,
            promptLastKeptDay: state.promptLastKeptDay,
            promptStreak: state.promptStreak,
        },
        commerce: {
            ownsKit: state.ownsKit,
            paper: state.paper,
            kitOfferSeen: state.kitOfferSeen,
            potNudges: state.potNudges,
            borrowDay: state.borrowDay,
            borrowsToday: state.borrowsToday,
            pendingPurchase: cachedPendingPurchase,
        },
    };
}

function migrate(raw: unknown): InkbloomSaveV1 | null {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<InkbloomSaveV1> & { version?: number };
    if (candidate.version !== SAVE_VERSION) return null;

    const defaults = snapshot();
    const settings = candidate.settings ?? defaults.settings;
    const progress = candidate.progress ?? defaults.progress;
    const hints = candidate.hints ?? defaults.hints;
    const prompt = candidate.prompt ?? defaults.prompt;
    const commerce = candidate.commerce ?? defaults.commerce;

    const discoveries = knownIds(progress.discoveries, DISCOVERY_IDS);
    const ownsKit = booleanOr(commerce.ownsKit, false);
    const paper = enumOr<PaperId>(commerce.paper, PAPERS, "rag");

    return {
        version: SAVE_VERSION,
        settings: {
            musicEnabled: booleanOr(settings.musicEnabled, defaults.settings.musicEnabled),
            musicVolume: clamp01(settings.musicVolume, defaults.settings.musicVolume),
            sfxEnabled: booleanOr(settings.sfxEnabled, defaults.settings.sfxEnabled),
            sfxVolume: clamp01(settings.sfxVolume, defaults.settings.sfxVolume),
            notificationsConsent: enumOr(
                settings.notificationsConsent,
                ["unknown", "granted", "denied"] as const,
                defaults.settings.notificationsConsent,
            ),
            // Additive back-fill: "absent" must mean "has not opted out", or the
            // flag would re-silence every existing player.
            notificationsOptOut: booleanOr(settings.notificationsOptOut, false),
            // Re-derived from the live host permission on the first refresh;
            // restored only so Settings paints something sane before then.
            notificationsEnabled: booleanOr(settings.notificationsEnabled, false),
            hapticsEnabled: booleanOr(settings.hapticsEnabled, defaults.settings.hapticsEnabled),
            reducedMotion: booleanOr(settings.reducedMotion, defaults.settings.reducedMotion),
            locale: enumOr(settings.locale, ["English", "PortugueseBR", "SpanishLA"] as const, "English"),
            quality: enumOr(settings.quality, ["high", "low"] as const, defaults.settings.quality),
        },
        progress: {
            discoveries,
            pagesTorn: counter(progress.pagesTorn),
            strokes: counter(progress.strokes),
            selectedInk: Math.min(INKS.length - 1, counter(progress.selectedInk)),
            largeBrush: booleanOr(progress.largeBrush, false),
            // A Kit-only tool cannot survive in a save that does not own the Kit.
            mirrorBrush: ownsKit && booleanOr(progress.mirrorBrush, false),
            // The ceremony flag only means anything alongside a full journal.
            colophonSeen: discoveries.length >= DISCOVERY_IDS.length && booleanOr(progress.colophonSeen, false),
        },
        hints: {
            revealedHints: knownIds(hints.revealedHints, DISCOVERY_IDS),
            hintDay: dayKeyOrNull(hints.hintDay),
            freeHintUsed: booleanOr(hints.freeHintUsed, false),
            hintsWatchedToday: Math.min(24, counter(hints.hintsWatchedToday)),
        },
        prompt: {
            promptDay: dayKeyOrNull(prompt.promptDay),
            promptId: typeof prompt.promptId === "string" ? prompt.promptId.slice(0, 60) : null,
            promptSolved: booleanOr(prompt.promptSolved, false),
            promptLastKeptDay: dayKeyOrNull(prompt.promptLastKeptDay),
            promptStreak: Math.min(9_999, counter(prompt.promptStreak)),
        },
        commerce: {
            ownsKit,
            // A locked sheet in the save falls back to rag rather than granting it.
            paper: ownsKit || paper === "rag" ? paper : "rag",
            kitOfferSeen: booleanOr(commerce.kitOfferSeen, false),
            potNudges: Math.min(9_999, counter(commerce.potNudges)),
            borrowDay: dayKeyOrNull(commerce.borrowDay),
            borrowsToday: Math.min(99, counter(commerce.borrowsToday)),
            pendingPurchase: pendingIntent(commerce.pendingPurchase),
        },
    };
}

function parse(raw: string | null): InkbloomSaveV1 | null {
    if (!raw) return null;
    try {
        return migrate(JSON.parse(raw));
    } catch {
        return null;
    }
}

function apply(save: InkbloomSaveV1): void {
    cachedPendingPurchase = save.commerce.pendingPurchase;
    store.patch({
        ...save.settings,
        ...save.progress,
        ...save.hints,
        ...save.prompt,
        ownsKit: save.commerce.ownsKit,
        paper: save.commerce.paper,
        kitOfferSeen: save.commerce.kitOfferSeen,
        potNudges: save.commerce.potNudges,
        borrowDay: save.commerce.borrowDay,
        borrowsToday: save.commerce.borrowsToday,
        discoveryCount: save.progress.discoveries.length,
    });
}

// -------------------------------------------------------------- persistence

let lastSaved = "";
let pendingSave: string | null = null;
let flushInFlight: Promise<boolean> | null = null;

function usesRunStorage(): boolean {
    const capabilities = getRunCapabilities();
    return capabilities.host && !capabilities.mock;
}

async function persist(serialized: string): Promise<boolean> {
    if (usesRunStorage()) return writeAppStorage(SAVE_KEY, serialized);
    try {
        window.localStorage.setItem(SAVE_KEY, serialized);
        return true;
    } catch (error) {
        console.warn("[save] local fallback write failed", error);
        return false;
    }
}

export const saveSystem = {
    async load(): Promise<SaveSource> {
        if (!usesRunStorage()) {
            let stored: string | null = null;
            try {
                stored = window.localStorage.getItem(SAVE_KEY);
            } catch (error) {
                console.warn("[save] local fallback read failed", error);
            }
            const save = parse(stored);
            if (save) apply(save);
            lastSaved = JSON.stringify(snapshot());
            return save ? "local" : "defaults";
        }

        const remote = await readAppStorage(SAVE_KEY);
        const save = remote.ok ? parse(remote.value) : null;
        if (save) apply(save);
        lastSaved = JSON.stringify(snapshot());
        return save ? "run" : "defaults";
    },

    /**
     * Coalesced write. Rapid changes collapse into one remote round trip, and
     * an older RPC can never land after and clobber a newer one.
     */
    async flush(): Promise<boolean> {
        const serialized = JSON.stringify(snapshot());
        if (serialized === lastSaved && pendingSave === null) return true;
        pendingSave = serialized;
        if (flushInFlight) return flushInFlight;

        flushInFlight = (async () => {
            let allSucceeded = true;
            while (pendingSave !== null) {
                const next = pendingSave;
                pendingSave = null;
                if (next === lastSaved) continue;
                const saved = await persist(next);
                if (saved) lastSaved = next;
                else allSucceeded = false;
            }
            return allSucceeded;
        })().finally(() => {
            flushInFlight = null;
        });
        return flushInFlight;
    },
};
