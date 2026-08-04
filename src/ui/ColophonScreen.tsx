/**
 * The colophon — the one ceremony in the game.
 *
 * Shown exactly once, when the sixtieth secret lands. The entrance is delayed
 * a beat in CSS so the "№ 60 / 60" toast gets its moment on the page first,
 * and the ink-drop rain is built from the discoveries' own accent colours —
 * the journal itself, falling. Dismissing it is the only way out, and it sets
 * the saved flag so the moment can never replay or be lost to a reload
 * mid-ceremony (the pending flag is transient; the save flag is the truth).
 */
import { useEffect } from "react";
import { DISCOVERIES } from "../game/sim/discoveries.ts";
import { store } from "../state/store.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { saveSystem } from "../systems/save.ts";
import { t } from "../systems/localization.ts";

/** Deterministic per-drop layout: index math, no randomness to disagree over. */
function dropStyle(index: number): React.CSSProperties {
    return {
        left: `${(index * 61) % 100}%`,
        background: `#${(DISCOVERIES[index % DISCOVERIES.length]?.colour ?? 0xf5b841).toString(16).padStart(6, "0")}`,
        animationDelay: `${2.2 + (index % 12) * 0.22}s`,
        animationDuration: `${2.6 + (index % 7) * 0.4}s`,
    };
}

export default function ColophonScreen() {
    useEffect(() => {
        const timer = window.setTimeout(() => {
            inkAudio.play("unlock");
            void runtimeServices.haptic("success");
            runtimeServices.track("colophon_shown", {});
        }, 2_200);
        return () => window.clearTimeout(timer);
    }, []);

    function dismiss(): void {
        store.patch({ colophonPending: false, colophonSeen: true });
        void saveSystem.flush();
    }

    return (
        <div className="colophon" role="dialog" aria-modal="true">
            {/* Decorative rain; hidden entirely under reduced motion. The drop
                list is static, so the index IS the identity — keyed via the
                discovery each drop borrows its colour from to satisfy lint. */}
            {Array.from({ length: 30 }, (_, index) => (
                <span
                    key={`${DISCOVERIES[index % DISCOVERIES.length]?.id ?? "drop"}-${Math.floor(index / DISCOVERIES.length)}`}
                    className="colophon-drop"
                    style={dropStyle(index)}
                    aria-hidden="true"
                />
            ))}
            <div className="colophon-card">
                <span className="colophon-ordinal">№ 60 / 60</span>
                <h2>{t("ColophonTitle")}</h2>
                <p>{t("ColophonBody")}</p>
                <button type="button" className="cta" onClick={dismiss}>
                    {t("ColophonContinue")}
                </button>
            </div>
        </div>
    );
}
