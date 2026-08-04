/**
 * The title.
 *
 * One screen, one obvious action. The hero is painted key art: three ink
 * bottles on a shelf above a page where pigment is mid-bloom — the fantasy
 * a player gets in the time they give a store listing.
 *
 * A returning player's progress meter sits directly above the button, because
 * "seventeen of sixty" is the reason to press it.
 */
import heroArt from "/title-hero.jpg";
import packageJson from "../../package.json";
import { GAME_NAME } from "../game/constants.ts";
import { DISCOVERY_COUNT } from "../game/sim/discoveries.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { store, useStore, type MenuScreen } from "../state/store.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { saveSystem } from "../systems/save.ts";
import { t } from "../systems/localization.ts";
import { kitOfferUnlocked } from "../systems/monetization.ts";

/**
 * The hero.
 *
 * Painted key art, shipped as `public/title-hero.jpg` (master in
 * `src/assets/art/title-hero.jpg`). Matched to the store tile: craft-table
 * teal, wooden shelf, living pigment on rag paper — no wordmark here, the
 * screen already has one.
 *
 * Framed as a rounded card rather than blended into the background: the art
 * carries its own opaque teal, and a card is both honest about that and the
 * same raised-surface language every other control on the screen uses.
 */
function TitleHero() {
    return (
        <div className="title-hero">
            <img src={heroArt} alt="" width={1152} height={864} decoding="async" fetchPriority="high" />
        </div>
    );
}

export default function TitleScreen() {
    useStore((state) => state.locale);
    const discoveries = useStore((state) => state.discoveryCount);
    const ownsKit = useStore((state) => state.ownsKit);
    const percent = Math.round((discoveries / DISCOVERY_COUNT) * 100);

    const activate = async (action: () => void) => {
        // Act first — a suspended AudioContext can leave resume() pending and
        // must never gate navigation.
        action();
        void inkAudio.unlock().then(() => {
            inkAudio.play("tap");
            void runtimeServices.haptic("light");
        });
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
            <TitleHero />

            <h1 className="title-mark">{GAME_NAME}</h1>
            <p className="title-tagline">{t("Tagline")}</p>

            <div className="title-progress">
                <span className="title-progress-row">
                    <span className="star" aria-hidden="true">
                        ✦
                    </span>
                    <strong>
                        {discoveries}/{DISCOVERY_COUNT}
                    </strong>
                    <span>{t("DiscoveriesLabel")}</span>
                </span>
                <span className="meter" aria-hidden="true">
                    <span style={{ width: `${percent}%` }} />
                </span>
            </div>

            <button type="button" className="cta" onClick={open}>
                {discoveries > 0 ? t("ButtonContinuePage") : t("ButtonOpenPage")}
            </button>

            <nav className="title-links" aria-label={GAME_NAME}>
                <button type="button" className="pill" onClick={goTo("stats")}>
                    {t("MenuStats")}
                </button>
                {ownsKit || kitOfferUnlocked() ? (
                    <button type="button" className="pill" onClick={goTo("shop")}>
                        {t("MenuShop")}
                    </button>
                ) : null}
                <button type="button" className="pill" onClick={goTo("settings")}>
                    {t("MenuSettings")}
                </button>
            </nav>

            <p className="version-stamp">v{packageJson.version}</p>
        </main>
    );
}
