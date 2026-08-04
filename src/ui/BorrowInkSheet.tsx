/**
 * The borrow offer.
 *
 * Opened by tapping a locked bottle on the shelf — and only the *next* locked
 * one, so the shelf still arrives in the order the game intends. Before this
 * existed, that tap answered with a shake and a number, which is the game
 * declining a request the player had just made as clearly as they could.
 *
 * What is on offer is the material, never the answer: a borrowed ink still has
 * to be poured into something to find out what it does, and the loan ends with
 * the sheet. Nothing here can be reached without a rewarded video the host
 * confirmed, and every failure path leaves the bottle locked.
 */
import { useState } from "react";
import { INKS } from "../game/sim/elements.ts";
import { store, useStore } from "../state/store.ts";
import { t } from "../systems/localization.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { borrowAvailability, watchToBorrow } from "../systems/monetization.ts";

export default function BorrowInkSheet() {
    const slot = useStore((state) => state.borrowOffer);
    const [busy, setBusy] = useState(false);

    if (slot === null) return null;
    const ink = INKS[slot];
    if (!ink) return null;

    const availability = borrowAvailability();

    const close = () => {
        inkAudio.play("tap");
        store.patch({ borrowOffer: null });
    };

    const watch = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const result = await watchToBorrow(slot);
            if (result === "granted") {
                inkAudio.play("unlock");
                void runtimeServices.haptic("success");
                store.patch({ toast: t("ToastBorrowed").replace("{name}", ink.name) });
            } else if (result !== "cancelled") {
                store.patch({ borrowOffer: null, toast: t("ToastAdFailed") });
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="borrow-scrim" role="dialog" aria-modal="true" aria-label={t("BorrowTitle")}>
            <button type="button" className="borrow-dismiss" onClick={close} aria-label={t("BorrowDecline")} />
            <section className="borrow-sheet">
                <span
                    className="borrow-bottle"
                    style={{ background: `#${ink.colour.toString(16).padStart(6, "0")}` }}
                />
                <h2>{t("BorrowTitle")}</h2>
                <p className="borrow-name">{ink.name}</p>
                <p className="borrow-line">{ink.unlockLine}</p>
                <p className="borrow-blurb">{t("BorrowBlurb")}</p>
                <button
                    type="button"
                    className="buy-button"
                    disabled={!availability.ready || busy}
                    onClick={() => void watch()}
                >
                    {busy ? "…" : availability.ready ? t("BorrowWatch") : availability.reason || t("KitUnavailable")}
                </button>
                <button type="button" className="borrow-decline" onClick={close}>
                    {t("BorrowDecline")}
                </button>
                <p className="safety-note">
                    {ink.unlockAt} discoveries opens this bottle for good — the loan only lends it for this sheet.
                </p>
            </section>
        </div>
    );
}
