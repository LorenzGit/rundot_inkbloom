/**
 * The splash.
 *
 * Deliberately the same object the game is about: a sheet of rag paper on the
 * desk with four inks already bleeding into it. The progress rule sits under
 * the sheet rather than on it, so the artwork is never interrupted by chrome.
 * Everything is CSS — no image asset, so it paints the instant the bundle does.
 */
import { GAME_NAME } from "../game/constants.ts";
import { useStore } from "../state/store.ts";
import { t } from "../systems/localization.ts";

export default function LoadingScreen() {
    const progress = useStore((state) => state.loadProgress);
    const percent = Math.round(progress * 100);
    return (
        <main className="splash">
            <div className="splash-sheet" aria-hidden="true">
                <h1 className="splash-mark">{GAME_NAME}</h1>
                <p className="splash-tagline">{t("Tagline")}</p>
            </div>
            <div
                className="splash-progress"
                role="progressbar"
                aria-label={t("LoadingLine")}
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <span style={{ width: `${percent}%` }} />
            </div>
            <p className="splash-status">{t("LoadingLine")}</p>
        </main>
    );
}
