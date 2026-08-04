/**
 * The record — four numbers, none of them a score to beat — and the Folio.
 *
 * Sheets used and marks made are here because in a sandbox they are the honest
 * measure of time spent, and seeing them climb is quietly satisfying in a way
 * a leaderboard rank is not. Below them, the last ten torn sheets: tearing a
 * page used to destroy the painting, and now it files it.
 */
import { useState } from "react";
import { DISCOVERY_COUNT } from "../game/sim/discoveries.ts";
import { store, useStore } from "../state/store.ts";
import { folio, type FolioEntry } from "../systems/folio.ts";
import { t } from "../systems/localization.ts";
import Panel from "./Panel.tsx";

function folioCaption(entry: FolioEntry): string {
    return t("FolioCaption").replace("{n}", String(entry.sheet)).replace("{found}", String(entry.discoveries));
}

export default function RecordScreen({ onClose }: { onClose: () => void }) {
    const state = useStore((value) => value);
    const [open, setOpen] = useState<FolioEntry | null>(null);
    const [sharing, setSharing] = useState(false);

    const entries: Array<[string, string]> = [
        [t("StatsDiscoveries"), `${state.discoveryCount}/${DISCOVERY_COUNT}`],
        [t("StatsPagesTorn"), String(state.pagesTorn + 1)],
        [t("StatsStrokes"), state.strokes.toLocaleString()],
        [t("StatsStreak"), String(state.promptStreak)],
    ];

    async function share(entry: FolioEntry): Promise<void> {
        if (sharing) return;
        setSharing(true);
        try {
            const result = await folio.share(entry);
            if (result === "shared") store.patch({ toast: t("FolioShared") });
            else if (result !== "cancelled") store.patch({ toast: t("FolioShareFailed") });
        } finally {
            setSharing(false);
        }
    }

    return (
        <Panel title={t("MenuStats")} onClose={onClose}>
            <div className="record-grid">
                {entries.map(([label, value]) => (
                    <article key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                    </article>
                ))}
            </div>

            {state.discoveryCount >= DISCOVERY_COUNT && (
                <p className="colophon-record-line">{t("ColophonRecordLine")}</p>
            )}

            <h3 className="folio-title">{t("FolioTitle")}</h3>
            {state.folio.length === 0 ? (
                <p className="panel-copy">{t("FolioEmpty")}</p>
            ) : (
                <ul className="folio-grid">
                    {/* The image bytes are the identity: sheet numbers can repeat
                        (a sheet kept on exit and its successor share a count). */}
                    {state.folio.map((entry) => (
                        <li key={`${entry.sheet}-${entry.image.length}-${entry.image.slice(-24)}`}>
                            <button
                                type="button"
                                className="folio-thumb"
                                onClick={() => setOpen(entry)}
                                aria-label={folioCaption(entry)}
                            >
                                <img src={entry.image} alt="" loading="lazy" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {open && (
                <div className="folio-lightbox" role="dialog" aria-modal="true">
                    <img src={open.image} alt={folioCaption(open)} />
                    <p className="folio-caption">{folioCaption(open)}</p>
                    <div className="folio-actions">
                        <button type="button" className="pill" disabled={sharing} onClick={() => void share(open)}>
                            {t("FolioShare")}
                        </button>
                        <button type="button" className="pill" onClick={() => setOpen(null)}>
                            {t("ButtonClose")}
                        </button>
                    </div>
                </div>
            )}
        </Panel>
    );
}
