/**
 * The sheet every overlay is written on.
 *
 * One component so all four panels share the torn top edge, the scroll
 * behaviour, and — importantly — the dismissal rules: tapping the scrim closes,
 * tapping the sheet does not, and Escape always closes. The panel body is the
 * only scrollable region in the game, so it opts back into vertical panning
 * that the rest of the app deliberately blocks.
 */
import { useEffect, type ReactNode } from "react";
import { inkAudio } from "../audio/inkAudio.ts";
import { t } from "../systems/localization.ts";

export default function Panel({
    title,
    kicker,
    onClose,
    children,
}: {
    title: string;
    kicker?: string;
    onClose: () => void;
    children: ReactNode;
}) {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const close = () => {
        inkAudio.play("tap");
        onClose();
    };

    return (
        <div
            className="overlay"
            role="presentation"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) close();
            }}
        >
            <section className="panel" role="dialog" aria-modal="true" aria-label={title}>
                <header className="panel-header">
                    <div>
                        {kicker ? <p className="eyebrow">{kicker}</p> : null}
                        <h2>{title}</h2>
                    </div>
                    <button type="button" className="panel-close" onClick={close} aria-label={t("ButtonClose")}>
                        ✕
                    </button>
                </header>
                <div className="panel-body" data-testid="panel-scroll-region">
                    {children}
                </div>
            </section>
        </div>
    );
}
