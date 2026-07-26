/**
 * The title.
 *
 * One screen, one obvious action. The hero is the game's own store tile —
 * rendered by the simulation, so the first thing a player sees is a real page
 * rather than an illustration of one.
 *
 * A returning player's progress meter sits directly above the button, because
 * "seventeen of twenty" is the reason to press it.
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

/**
 * The hero.
 *
 * Three ink bottles and a drip, drawn as SVG in the same language as the shelf.
 *
 * This replaced a crop of the store tile, which at hero size was an unreadable
 * green-and-orange smear: a screenshot of a simulation is not an illustration,
 * and it told a new player nothing about what the game is. Bottles say "ink"
 * instantly, and they are the thing you actually touch first.
 */
function TitleHero() {
    const bottles = [
        { x: 34, colour: "#3E7CB8", light: "#7FB4E0", height: 74 },
        { x: 100, colour: "#D9A441", light: "#F2C979", height: 92 },
        { x: 166, colour: "#3F7D45", light: "#79BA7F", height: 74 },
    ];
    return (
        <div className="title-hero" aria-hidden="true">
            <svg viewBox="0 0 234 140" role="presentation">
                <title>Three ink bottles</title>
                {bottles.map((bottle) => {
                    const width = 52;
                    const top = 128 - bottle.height;
                    return (
                        <g key={bottle.x}>
                            <ellipse cx={bottle.x + width / 2} cy={131} rx={26} ry={5} fill="rgba(0,0,0,0.22)" />
                            <rect
                                x={bottle.x + width / 2 - 9}
                                y={top - 15}
                                width={18}
                                height={17}
                                rx={4}
                                fill="#b08753"
                            />
                            <rect
                                x={bottle.x}
                                y={top}
                                width={width}
                                height={bottle.height}
                                rx={13}
                                fill={bottle.colour}
                            />
                            <rect
                                x={bottle.x}
                                y={top + bottle.height * 0.45}
                                width={width}
                                height={bottle.height * 0.55}
                                rx={13}
                                fill="rgba(0,0,0,0.18)"
                            />
                            <rect
                                x={bottle.x + 7}
                                y={top + 11}
                                width={7}
                                height={bottle.height - 26}
                                rx={3.5}
                                fill="rgba(255,255,255,0.4)"
                            />
                            <rect
                                x={bottle.x}
                                y={top}
                                width={width}
                                height={bottle.height}
                                rx={13}
                                fill="none"
                                stroke="rgba(255,255,255,0.6)"
                                strokeWidth={3}
                            />
                        </g>
                    );
                })}
                {/* A drop mid-fall from the middle bottle, so the mark reads as
                    something happening rather than a still life. */}
                <circle cx={126} cy={24} r={7} fill="#F2C979" />
                <circle cx={126} cy={24} r={7} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={2.5} />
            </svg>
        </div>
    );
}

export default function TitleScreen() {
    useStore((state) => state.locale);
    const discoveries = useStore((state) => state.discoveryCount);
    const ownsKit = useStore((state) => state.ownsKit);
    const percent = Math.round((discoveries / DISCOVERY_COUNT) * 100);

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
