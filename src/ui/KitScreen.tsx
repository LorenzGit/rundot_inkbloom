/**
 * The shop.
 *
 * Two products, stated plainly, with the non-payer promise printed on the same
 * screen as the prices — because a game about honest discovery should not be
 * coy about what money does and does not buy here.
 *
 * The pot is the entry tier and stays visible after the Kit is bought only if
 * the player does not own the Kit, because the Kit already gives unlimited
 * nudges: selling a pot to someone who has that would be selling them nothing.
 *
 * Every control fails closed. Outside a RUN host, or with LiveOps disabled, the
 * button is disabled with an honest reason rather than hidden or, worse,
 * silently granting.
 */
import { useEffect, useState } from "react";
import { PAPERS, type PaperId } from "../game/constants.ts";
import { PAPER_STYLES } from "../game/scene/papers.ts";
import { store, useStore } from "../state/store.ts";
import { t } from "../systems/localization.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { saveSystem } from "../systems/save.ts";
import {
    kitPrice,
    kitPurchasable,
    markOfferSeen,
    potOfferUnlocked,
    potPrice,
    potPurchasable,
    purchaseKit,
    purchasePot,
} from "../systems/monetization.ts";
import Panel from "./Panel.tsx";

const BENEFITS = [
    "Three more sheets — vellum, nocturne, and blueprint. On the dark two, every ink becomes a light.",
    "The mirror nib: paint one side, get both.",
    "Nudges whenever you want one, with no daily limit and no video.",
] as const;

export default function KitScreen({ onClose }: { onClose: () => void }) {
    const ownsKit = useStore((state) => state.ownsKit);
    const paper = useStore((state) => state.paper);
    const potNudges = useStore((state) => state.potNudges);
    const [busy, setBusy] = useState(false);
    const [potBusy, setPotBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        markOfferSeen();
    }, []);

    const purchasable = kitPurchasable();
    const price = kitPrice();

    const buy = async () => {
        if (busy) return;
        setBusy(true);
        setNotice(null);
        try {
            const result = await purchaseKit();
            if (result === "owned") {
                inkAudio.play("unlock");
                void runtimeServices.haptic("success");
                store.patch({ toast: t("ToastKitThanks") });
            } else if (result === "pending") {
                setNotice(t("KitPending"));
            } else if (result === "unavailable") {
                setNotice(t("KitUnavailable"));
            } else if (result === "failed") {
                setNotice(t("ToastAdFailed"));
            }
        } finally {
            setBusy(false);
        }
    };

    const buyPot = async () => {
        if (potBusy) return;
        setPotBusy(true);
        setNotice(null);
        try {
            const result = await purchasePot();
            if (result === "bought") {
                inkAudio.play("unlock");
                void runtimeServices.haptic("success");
                store.patch({ toast: t("ToastPotThanks") });
            } else if (result === "pending") {
                setNotice(t("KitPending"));
            } else if (result === "unavailable") {
                setNotice(t("KitUnavailable"));
            } else if (result === "failed") {
                setNotice(t("ToastAdFailed"));
            }
        } finally {
            setPotBusy(false);
        }
    };

    const chooseSheet = (id: PaperId) => () => {
        const style = PAPER_STYLES[id];
        if (id !== "rag" && !ownsKit) return;
        inkAudio.play("select");
        void runtimeServices.haptic("light");
        store.patch({ paper: id });
        runtimeServices.track("sheet_selected", { paper: id, owns_kit: ownsKit });
        void saveSystem.flush();
        void style;
    };

    return (
        <Panel title={t("KitTitle")} kicker={ownsKit ? t("KitOwned") : "TWO WAYS IN"} onClose={onClose}>
            {ownsKit ? null : (
                <article className="kit-hero">
                    <ul className="kit-benefits">
                        {BENEFITS.map((benefit) => (
                            <li key={benefit}>{benefit}</li>
                        ))}
                    </ul>
                    {price ? <span className="kit-price">{price}</span> : null}
                    <button
                        type="button"
                        className="buy-button"
                        disabled={!purchasable || busy}
                        onClick={() => void buy()}
                    >
                        {busy ? "…" : purchasable ? t("KitPurchase") : t("KitUnavailable")}
                    </button>
                    {notice ? <p className="safety-note">{notice}</p> : null}
                </article>
            )}

            {ownsKit ? null : (
                <article className="pot-card">
                    <div className="pot-copy">
                        <strong>{t("PotTitle")}</strong>
                        <span>{t("PotBlurb")}</span>
                        {potNudges > 0 ? (
                            <em className="pot-held">{t("PotHeld").replace("{n}", String(potNudges))}</em>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        className="pot-buy"
                        disabled={!potPurchasable() || !potOfferUnlocked() || potBusy}
                        onClick={() => void buyPot()}
                    >
                        {potBusy ? "…" : (potPrice() ?? t("PotBuy"))}
                    </button>
                </article>
            )}

            <h3 style={{ margin: "0 0 0.4rem", fontWeight: 400 }}>{t("PapersTitle")}</h3>
            <div className="papers-grid">
                {PAPERS.map((id) => {
                    const style = PAPER_STYLES[id];
                    const locked = id !== "rag" && !ownsKit;
                    return (
                        <button
                            key={id}
                            type="button"
                            className="paper-swatch"
                            data-active={paper === id}
                            data-locked={locked}
                            disabled={locked}
                            onClick={chooseSheet(id)}
                            aria-label={`${style.name} — ${locked ? t("PapersLocked") : style.blurb}`}
                        >
                            <span className="paper-chip" style={{ background: style.base }} />
                            <strong>{style.name}</strong>
                            <span>{locked ? t("PapersLocked") : style.blurb}</span>
                        </button>
                    );
                })}
            </div>

            <p className="safety-note">
                All sixty secrets, all eighteen inks, and the daily page are free to everyone, forever. The Kit changes
                what you work on, never what you can find.
            </p>
        </Panel>
    );
}
