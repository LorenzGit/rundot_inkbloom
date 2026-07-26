/**
 * The title.
 *
 * Kept to one screen with one obvious action. A returning player's discovery
 * count is the only progression shown, because it is the only progression there
 * is — and it is the thing that makes opening the page again feel like picking
 * up unfinished work rather than starting over.
 */
import packageJson from "../../package.json";
import { GAME_NAME } from "../game/constants.ts";
import { DISCOVERY_COUNT } from "../game/sim/discoveries.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { store, useStore, type MenuScreen } from "../state/store.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { saveSystem } from "../systems/save.ts";
import { t } from "../systems/localization.ts";
import { kitOfferUnlocked } from "../systems/monetization.ts";

export default function TitleScreen() {
    useStore((state) => state.locale);
    const discoveries = useStore((state) => state.discoveryCount);
    const ownsKit = useStore((state) => state.ownsKit);

    const activate = async (action: () => void) => {
        await inkAudio.unlock();
        inkAudio.play("tap");
        void runtimeServices.haptic("light");
        action();
    };

    const open = () =>
        void activate(() => {
            runtimeServices.funnel(1, "title_opened", "inkbloom_first_session", 1);
            store.patch({ phase: "playing", overlay: "none" });
            void saveSystem.flush();
        });

    const goTo = (screen: MenuScreen) => () => void activate(() => store.patch({ menuScreen: screen }));

    return (
        <main className="title-screen">
            <div>
                <h1 className="title-mark">{GAME_NAME}</h1>
                <p className="title-tagline">{t("Tagline")}</p>
            </div>

            <p className="title-blurb">{t("TitleBlurb")}</p>

            {discoveries > 0 ? (
                <p className="title-count">
                    <span className="gilt-star" aria-hidden="true">
                        ✦
                    </span>
                    <strong>
                        {discoveries}/{DISCOVERY_COUNT}
                    </strong>
                    <span>{t("DiscoveriesLabel")}</span>
                </p>
            ) : null}

            <button type="button" className="primary-button" onClick={open}>
                {t("ButtonOpenPage")}
            </button>

            <nav className="title-links" aria-label={GAME_NAME}>
                <button type="button" onClick={goTo("stats")}>
                    {t("MenuStats")}
                </button>
                {ownsKit || kitOfferUnlocked() ? (
                    <button type="button" onClick={goTo("shop")}>
                        {t("MenuShop")}
                    </button>
                ) : null}
                <button type="button" onClick={goTo("settings")}>
                    {t("MenuSettings")}
                </button>
            </nav>

            <p className="version-stamp">v{packageJson.version}</p>
        </main>
    );
}
