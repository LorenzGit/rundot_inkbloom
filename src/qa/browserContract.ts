import packageJson from "../../package.json";
import { inkAudio } from "../audio/inkAudio.ts";
import { getRunCapabilities } from "../sdk/runSdk.ts";
import { store, type Overlay } from "../state/store.ts";

interface InkbloomQa {
    snapshot(): Record<string, unknown>;
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
