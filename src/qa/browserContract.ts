import packageJson from "../../package.json";
import { inkAudio } from "../audio/inkAudio.ts";
import { getRunCapabilities } from "../sdk/runSdk.ts";
import { store, type Overlay } from "../state/store.ts";

/**
 * A shelf control's box, in **CSS pixels relative to the canvas**.
 *
 * Deliberately not design units: every consumer is an automation script that
 * needs to dispatch a pointer event, and making each of them re-derive the
 * design scale is how they end up hard-coding coordinates that rot the next
 * time the layout changes.
 */
export interface QaShelfSlot {
    kind: string;
    /** Ink slot index, or -1 for a tool. */
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface InkbloomQa {
    snapshot(): Record<string, unknown>;
    /** Live shelf geometry, or an empty list when the page is not open. */
    shelfSlots(): QaShelfSlot[];
    openPage(): void;
    openPanel(overlay: Overlay): void;
    returnToTitle(): void;
}

declare global {
    // Development-only semantic browser contract. Never present in production.
    var __gameQa: InkbloomQa | undefined;
}

/**
 * A stable surface for headless visual QA to drive the game without hunting for
 * pixels. It may set up local navigation state and nothing else: it can never
 * fabricate a discovery, a purchase, an ad reward, or an entitlement.
 */
let shelfSlotSource: (() => QaShelfSlot[]) | null = null;

/**
 * Let the Pixi scene publish its shelf geometry for automated checks.
 *
 * Overlapping controls are invisible to a screenshot diff and obvious to
 * arithmetic, so the layout exposes its boxes rather than relying on someone
 * noticing. A no-op unless the QA contract is installed.
 */
export function publishShelfSlots(source: (() => QaShelfSlot[]) | null): void {
    shelfSlotSource = source;
}

export function installBrowserQaContract(): void {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get("qa") !== "1") return;
    document.documentElement.dataset.qaContract = "ready";
    globalThis.__gameQa = {
        snapshot() {
            const state = store.get();
            return {
                version: packageJson.version,
                phase: state.phase,
                menuScreen: state.menuScreen,
                overlay: state.overlay,
                paused: state.paused,
                discoveries: state.discoveryCount,
                selectedInk: state.selectedInk,
                paper: state.paper,
                ownsKit: state.ownsKit,
                renderer: document.documentElement.dataset.renderer ?? "pending",
                host: getRunCapabilities().host,
                audio: inkAudio.debugSnapshot(),
            };
        },
        shelfSlots() {
            return shelfSlotSource?.() ?? [];
        },
        openPage() {
            store.patch({ phase: "playing", overlay: "none" });
        },
        openPanel(overlay) {
            store.patch({ phase: "playing", overlay });
        },
        returnToTitle() {
            store.patch({ phase: "menu", menuScreen: "title", overlay: "none" });
        },
    };
}
