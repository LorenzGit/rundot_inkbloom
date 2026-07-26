/**
 * Screen router.
 *
 * Two phases. `menu` is the title and its three panels; `playing` mounts the
 * Pixi canvas with the header over it and, optionally, one panel over that.
 * The canvas is deliberately kept mounted while a panel is open — the page
 * keeps simulating behind Field Notes, which is how a player can watch their
 * daily brief tick over without closing the journal.
 */
import { lazy, Suspense, useEffect } from "react";
import { store, useStore } from "../state/store.ts";
import GameCanvas from "../game/GameCanvas.tsx";
import LoadingScreen from "./LoadingScreen.tsx";
import TitleScreen from "./TitleScreen.tsx";
import PageHeader from "./PageHeader.tsx";
import FieldNotesScreen from "./FieldNotesScreen.tsx";
import KitScreen from "./KitScreen.tsx";
import SettingsScreen from "./SettingsScreen.tsx";
import RecordScreen from "./RecordScreen.tsx";
import { applyRunSafeArea } from "../sdk/runSdk.ts";
import { t } from "../systems/localization.ts";

const DevelopmentTools = import.meta.env.DEV ? lazy(() => import("../dev/DevelopmentTools.tsx")) : null;

function useOrientationSafeArea(): void {
    useEffect(() => {
        const refresh = () => applyRunSafeArea();
        window.addEventListener("orientationchange", refresh);
        window.addEventListener("resize", refresh);
        return () => {
            window.removeEventListener("orientationchange", refresh);
            window.removeEventListener("resize", refresh);
        };
    }, []);
}

function closeToTitle(): void {
    store.patch({ menuScreen: "title" });
}

function closeOverlay(): void {
    store.patch({ overlay: "none" });
}

/**
 * The title always stays mounted and a panel layers over it, so closing one
 * reveals the screen it came from rather than cutting to it.
 */
function MenuRoute() {
    const screen = useStore((state) => state.menuScreen);
    return (
        <>
            <TitleScreen />
            {screen === "shop" && <KitScreen onClose={closeToTitle} />}
            {screen === "settings" && <SettingsScreen onClose={closeToTitle} />}
            {screen === "stats" && <RecordScreen onClose={closeToTitle} />}
        </>
    );
}

function PlayOverlay() {
    const overlay = useStore((state) => state.overlay);
    if (overlay === "notes") return <FieldNotesScreen onClose={closeOverlay} />;
    if (overlay === "shop") return <KitScreen onClose={closeOverlay} />;
    if (overlay === "settings") return <SettingsScreen onClose={closeOverlay} />;
    return null;
}

export default function App() {
    useOrientationSafeArea();
    const phase = useStore((state) => state.phase);
    const paused = useStore((state) => state.paused);

    return (
        <div id="app-frame">
            {phase === "loading" && <LoadingScreen />}
            {phase === "menu" && <MenuRoute />}
            {phase === "playing" && (
                <>
                    <GameCanvas />
                    <PageHeader />
                    <PlayOverlay />
                    {paused && (
                        <div className="pause-veil" role="status">
                            {t("Paused")}
                        </div>
                    )}
                </>
            )}
            <Toast />
            <DevelopmentToolsSlot />
        </div>
    );
}

function Toast() {
    const toast = useStore((state) => state.toast);
    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => store.patch({ toast: null }), 2_800);
        return () => window.clearTimeout(timer);
    }, [toast]);
    if (!toast) return null;
    return (
        <button type="button" className="toast" onClick={() => store.patch({ toast: null })}>
            {toast}
        </button>
    );
}

function DevelopmentToolsSlot() {
    if (!DevelopmentTools) return null;
    if (new URLSearchParams(window.location.search).get("debug") !== "1") return null;
    return (
        <Suspense fallback={null}>
            <DevelopmentTools />
        </Suspense>
    );
}
