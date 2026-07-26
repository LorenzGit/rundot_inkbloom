/**
 * The in-game HUD.
 *
 * One progress chip and two round buttons. The chip is the whole navigation:
 * it shows what you have, fills as you find things, punches when it changes,
 * and opens Field Notes when tapped — so the reward, the goal and the way to
 * the journal are the same object.
 *
 * The bar is pointer-events-none except for its own controls, so a stroke that
 * starts near the top of the screen still reaches the canvas.
 */
import { useEffect, useRef, useState } from "react";
import { DISCOVERY_COUNT } from "../game/sim/discoveries.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { store, useStore } from "../state/store.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { saveSystem } from "../systems/save.ts";
import { t } from "../systems/localization.ts";
import { view as promptView } from "../systems/dailyPrompt.ts";
import { offer as nudgeOffer } from "../systems/hints.ts";

export default function PageHeader() {
    const discoveries = useStore((state) => state.discoveryCount);
    const [bumped, setBumped] = useState(false);
    const previous = useRef(discoveries);

    useEffect(() => {
        if (previous.current === discoveries) return;
        previous.current = discoveries;
        setBumped(true);
        const timer = window.setTimeout(() => setBumped(false), 500);
        return () => window.clearTimeout(timer);
    }, [discoveries]);

    // A dot on the notes button when there is something worth opening it for:
    // an unkept prompt, or a nudge sitting unspent.
    const prompt = promptView();
    const attention = (prompt.available && !prompt.solved) || nudgeOffer().freeReady;
    const percent = Math.round((discoveries / DISCOVERY_COUNT) * 100);

    const openNotes = () => {
        inkAudio.play("tap");
        void runtimeServices.haptic("light");
        store.patch({ overlay: "notes" });
        runtimeServices.track("field_notes_opened", { discoveries });
    };

    const leave = () => {
        inkAudio.play("tap");
        store.patch({ phase: "menu", menuScreen: "title", overlay: "none" });
        void saveSystem.flush();
    };

    return (
        <header className="page-header">
            <button
                type="button"
                className="progress-chip"
                data-bumped={bumped}
                onClick={openNotes}
                aria-label={`${t("MenuFieldNotes")} — ${discoveries} of ${DISCOVERY_COUNT} ${t("DiscoveriesLabel")}`}
            >
                <span className="star" aria-hidden="true">
                    ✦
                </span>
                <span className="body">
                    <span className="count">
                        {discoveries}
                        <em>/{DISCOVERY_COUNT}</em> {t("DiscoveriesLabel")}
                    </span>
                    <span className="meter" aria-hidden="true">
                        <span style={{ width: `${percent}%` }} />
                    </span>
                </span>
            </button>

            <button
                type="button"
                className="icon-button"
                data-attention={attention}
                onClick={openNotes}
                aria-label={t("MenuFieldNotes")}
            >
                ☰
            </button>
            <button type="button" className="icon-button" onClick={leave} aria-label={t("ButtonBack")}>
                ✕
            </button>
        </header>
    );
}
