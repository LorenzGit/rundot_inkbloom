/**
 * The only DOM chrome over the page.
 *
 * The counter is the game's whole navigation: it shows what you have, and
 * tapping it opens what you have not. It bumps when the count changes, which
 * is the visual link between "something happened on the page" and "the journal
 * now says something new".
 *
 * The header is pointer-events-none except for its own controls, so a stroke
 * that starts near the top of the screen still reaches the canvas.
 */
import { useEffect, useRef, useState } from "react";
import { GAME_NAME } from "../game/constants.ts";
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
        const timer = window.setTimeout(() => setBumped(false), 460);
        return () => window.clearTimeout(timer);
    }, [discoveries]);

    // A dot on the notes button when there is something worth opening it for:
    // an unkept prompt, or a nudge sitting unspent.
    const prompt = promptView();
    const attention = (prompt.available && !prompt.solved) || nudgeOffer().freeReady;

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
            <div className="header-mark">
                <strong>{GAME_NAME}</strong>
                <span>{t("Tagline")}</span>
            </div>

            <div className="header-actions">
                <button
                    type="button"
                    className="counter-chip"
                    data-bumped={bumped}
                    data-attention={attention}
                    onClick={openNotes}
                    aria-label={`${t("MenuFieldNotes")} — ${discoveries} of ${DISCOVERY_COUNT} ${t("DiscoveriesLabel")}`}
                >
                    <span className="gilt-star" aria-hidden="true">
                        ✦
                    </span>
                    <span>
                        <span className="count">
                            {discoveries}/{DISCOVERY_COUNT}
                        </span>
                        <span className="caption">notes</span>
                    </span>
                </button>
                <button type="button" className="icon-button" onClick={leave} aria-label={t("ButtonBack")}>
                    ‹
                </button>
            </div>
        </header>
    );
}
