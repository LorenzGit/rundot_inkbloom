/**
 * The Folio — torn sheets, kept.
 *
 * Tearing a sheet used to be the end of it. Now the scene hands a small JPEG
 * of any sheet with real work on it to this module before the tear, and the
 * last ten live in a gallery on the Record screen, shareable from there.
 *
 * Storage is a key of its own, deliberately separate from the progress save:
 * images are three orders of magnitude bigger than the rest of the save put
 * together, and a folio write that fails must never take the player's
 * discoveries down with it. Everything here is cosmetic — a lost folio is a
 * shrug, so every failure degrades to "the gallery is shorter than it could
 * be", never to an error the player sees.
 */
import {
    getRunCapabilities,
    readAppStorage,
    shareImageFile,
    writeAppStorage,
    type ShareImageResult,
} from "../sdk/runSdk.ts";
import { DISCOVERY_COUNT } from "../game/sim/discoveries.ts";
import { store } from "../state/store.ts";
import { t } from "./localization.ts";
import { runtimeServices } from "./runtimeServices.ts";

/** No dots in the key: RUN app storage silently rejects them. */
const FOLIO_KEY = "inkbloom-folio";
export const FOLIO_LIMIT = 10;
/**
 * Per-image ceiling, in characters of data URL.
 *
 * A sheet at capture resolution encodes to 30–90k; anything past this is a
 * runaway (or tampered local storage) and is dropped rather than allowed to
 * bloat every future write of the whole folio.
 */
const MAX_IMAGE_CHARS = 160_000;

export interface FolioEntry {
    /** JPEG data URL, produced by the scene at tear time. */
    readonly image: string;
    /** Which sheet this was — the pagesTorn counter at capture, 1-based. */
    readonly sheet: number;
    /** Secrets known when it was torn, for the caption. */
    readonly discoveries: number;
}

function usesRunStorage(): boolean {
    const capabilities = getRunCapabilities();
    return capabilities.host && !capabilities.mock;
}

function sanitize(raw: unknown): FolioEntry[] {
    if (!Array.isArray(raw)) return [];
    const entries: FolioEntry[] = [];
    for (const candidate of raw) {
        if (!candidate || typeof candidate !== "object") continue;
        const entry = candidate as Partial<FolioEntry>;
        if (
            typeof entry.image !== "string" ||
            !entry.image.startsWith("data:image/jpeg;base64,") ||
            entry.image.length > MAX_IMAGE_CHARS
        ) {
            continue;
        }
        entries.push({
            image: entry.image,
            sheet: Math.max(1, Math.floor(Number(entry.sheet) || 1)),
            discoveries: Math.max(0, Math.floor(Number(entry.discoveries) || 0)),
        });
        if (entries.length >= FOLIO_LIMIT) break;
    }
    return entries;
}

// One write in flight, one pending behind it — same shape as the save system,
// so an old write can never land after a newer one.
let pendingWrite: string | null = null;
let writeInFlight: Promise<void> | null = null;

async function persist(serialized: string): Promise<void> {
    pendingWrite = serialized;
    if (writeInFlight) return writeInFlight;
    writeInFlight = (async () => {
        while (pendingWrite !== null) {
            const next = pendingWrite;
            pendingWrite = null;
            if (usesRunStorage()) {
                await writeAppStorage(FOLIO_KEY, next);
            } else {
                try {
                    window.localStorage.setItem(FOLIO_KEY, next);
                } catch (error) {
                    console.warn("[folio] local write failed", error);
                }
            }
        }
    })().finally(() => {
        writeInFlight = null;
    });
    return writeInFlight;
}

export const folio = {
    /** Populate the store from storage. Called once at boot, after the save. */
    async load(): Promise<void> {
        let raw: string | null = null;
        if (usesRunStorage()) {
            const remote = await readAppStorage(FOLIO_KEY);
            raw = remote.ok ? remote.value : null;
        } else {
            try {
                raw = window.localStorage.getItem(FOLIO_KEY);
            } catch (error) {
                console.warn("[folio] local read failed", error);
            }
        }
        if (!raw) return;
        try {
            const entries = sanitize(JSON.parse(raw));
            if (entries.length > 0) store.patch({ folio: entries });
        } catch {
            // A corrupt folio is an empty folio, never a crash.
        }
    },

    /** Keep a just-captured sheet. Newest first, oldest falls off the end. */
    record(image: string): void {
        if (!image.startsWith("data:image/jpeg;base64,") || image.length > MAX_IMAGE_CHARS) return;
        const state = store.get();
        const entry: FolioEntry = {
            image,
            sheet: state.pagesTorn + 1,
            discoveries: state.discoveryCount,
        };
        const entries = [entry, ...state.folio].slice(0, FOLIO_LIMIT);
        store.patch({ folio: entries });
        void persist(JSON.stringify(entries));
    },

    /**
     * Share a kept sheet through the host share sheet (or the web fallbacks).
     *
     * Only ever called from a button press — sharing is one of the actions
     * that must always trace back to a direct player interaction.
     */
    async share(entry: FolioEntry): Promise<ShareImageResult> {
        const blob = blobFromDataUrl(entry.image);
        if (!blob) return "failed";
        const result = await shareImageFile({
            blob,
            filename: `inkbloom-sheet-${entry.sheet}.jpg`,
            title: "Inkbloom",
            text: t("FolioShareText")
                .replace("{found}", String(entry.discoveries))
                .replace("{total}", String(DISCOVERY_COUNT)),
        });
        runtimeServices.track("sheet_shared", { sheet: entry.sheet, result });
        return result;
    },
};

function blobFromDataUrl(dataUrl: string): Blob | null {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    try {
        const bytes = atob(dataUrl.slice(comma + 1));
        const buffer = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
        return new Blob([buffer], { type: "image/jpeg" });
    } catch {
        return null;
    }
}
