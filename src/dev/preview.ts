import { store, type MenuScreen, type Overlay } from "../state/store.ts";

const MENU_SCREENS = new Set<MenuScreen>(["title", "shop", "stats", "settings"]);
const OVERLAYS = new Set<Overlay>(["notes", "shop", "settings"]);

/**
 * Development-only deep link for visual review and automated browser checks.
 *
 * `?screen=page` opens the sheet; `?screen=notes` opens the sheet with Field
 * Notes over it; anything else names a title-screen panel. The query changes
 * local in-memory navigation only — it never bypasses a RUN permission,
 * purchase, ad, entitlement, or other authoritative outcome.
 */
export function applyDevelopmentScreenPreview(): void {
    if (!import.meta.env.DEV) return;
    const requested = new URLSearchParams(window.location.search).get("screen");
    if (!requested) return;
    if (requested === "page") {
        store.patch({ phase: "playing", overlay: "none", paused: false });
        return;
    }
    if (OVERLAYS.has(requested as Overlay)) {
        store.patch({ phase: "playing", overlay: requested as Overlay, paused: false });
        return;
    }
    if (MENU_SCREENS.has(requested as MenuScreen)) {
        store.patch({ phase: "menu", menuScreen: requested as MenuScreen, paused: false });
        return;
    }
    console.warn(`[dev] Unknown screen preview "${requested}".`);
}
