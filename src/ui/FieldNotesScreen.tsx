/**
 * Field Notes — the journal, and the only place a nudge can be spent.
 *
 * Every unfound secret is shown as a blank line rather than hidden, so the
 * player always knows exactly how much is left. A nudge attaches a marginal
 * note to one specific blank line, chosen by the player: no one is ever handed
 * a hint about something they did not ask about.
 */
import { useState } from "react";
import { DISCOVERIES, DISCOVERY_COUNT } from "../game/sim/discoveries.ts";
import { store, useStore } from "../state/store.ts";
import { t } from "../systems/localization.ts";
import { offer, spendFreeNudge, watchNudge } from "../systems/hints.ts";
import { evaluate as evaluatePrompt, view as promptView } from "../systems/dailyPrompt.ts";
import { kitOfferUnlocked, markOfferSeen } from "../systems/monetization.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import Panel from "./Panel.tsx";

export default function FieldNotesScreen({ onClose }: { onClose: () => void }) {
    const found = useStore((state) => state.discoveries);
    const revealed = useStore((state) => state.revealedHints);
    const ownsKit = useStore((state) => state.ownsKit);
    useStore((state) => state.hintsWatchedToday);
    useStore((state) => state.freeHintUsed);
    const [busyId, setBusyId] = useState<string | null>(null);

    const nudges = offer();
    const prompt = promptView();
    // Re-check the brief whenever the journal is opened, so a page that was
    // finished while a panel was closed is credited immediately.
    if (prompt.available && !prompt.solved) evaluatePrompt();

    const spend = (discoveryId: string) => async () => {
        setBusyId(discoveryId);
        try {
            if (nudges.freeReady) {
                await spendFreeNudge(discoveryId);
                return;
            }
            const result = await watchNudge(discoveryId);
            if (result === "cancelled") store.patch({ toast: t("ToastAdCancelled") });
            else if (result === "failed" || result === "unavailable") store.patch({ toast: t("ToastAdFailed") });
        } finally {
            setBusyId(null);
        }
    };

    const openKit = () => {
        inkAudio.play("tap");
        markOfferSeen();
        store.patch({ overlay: "shop" });
    };

    // One line explains the budget; each blank line then carries only a small
    // mark to spend it on. Fourteen full-width buttons would make the screen
    // look like a store rather than a journal.
    const budgetLine = ownsKit
        ? t("NudgeKit")
        : nudges.freeReady
          ? t("NudgeFree")
          : nudges.adVisible
            ? nudges.adReady
                ? t("NudgeWatch")
                : nudges.adReason
            : t("NudgeSpentToday");

    return (
        <Panel title={t("FieldNotesTitle")} kicker={`${found.length} / ${DISCOVERY_COUNT}`} onClose={onClose}>
            {prompt.available && prompt.prompt ? (
                <article className="prompt-card" data-kept={prompt.solved}>
                    <h3>{t("PromptTitle")}</h3>
                    <p className="prompt-brief">{prompt.prompt.brief}</p>
                    {prompt.solved ? null : (
                        <div className="prompt-progress">
                            <span style={{ width: `${Math.round((prompt.progress / prompt.target) * 100)}%` }} />
                        </div>
                    )}
                    <div className="prompt-meta">
                        <span>{prompt.solved ? t("PromptKept") : `${prompt.progress} / ${prompt.target}`}</span>
                        {prompt.streak > 0 ? <span>{t("PromptStreak", { n: prompt.streak })}</span> : null}
                        {prompt.authoritative ? null : <span>{t("PromptLocalClock")}</span>}
                    </div>
                </article>
            ) : (
                <p className="panel-copy">{prompt.reason}</p>
            )}

            {found.length < DISCOVERY_COUNT ? (
                <p className="nudge-budget">
                    <span>{budgetLine}</span>
                    {nudges.adVisible && nudges.adRemainingToday !== null ? (
                        <span>{nudges.adRemainingToday} left today</span>
                    ) : null}
                </p>
            ) : null}

            <ul className="notes-list">
                {DISCOVERIES.map((entry) => {
                    const isFound = found.includes(entry.id);
                    const isHinted = revealed.includes(entry.id);
                    const canNudge = !isFound && !isHinted && (nudges.freeReady || nudges.adReady);
                    return (
                        <li key={entry.id}>
                            <div className="note-entry" data-found={isFound} data-hinted={isHinted}>
                                <span
                                    className="mark"
                                    aria-hidden="true"
                                    style={{ color: `#${entry.colour.toString(16).padStart(6, "0")}` }}
                                >
                                    {isFound ? "✦" : "·"}
                                </span>
                                <span className="body">
                                    <strong>{isFound ? entry.name : t("FieldNotesUnfound")}</strong>
                                    <span>{isFound ? entry.note : isHinted ? entry.hint : ""}</span>
                                </span>
                                {isFound || isHinted ? null : (
                                    <button
                                        type="button"
                                        className="note-nudge"
                                        disabled={!canNudge || busyId !== null}
                                        onClick={spend(entry.id)}
                                        aria-label={`${budgetLine} — reveal a nudge for this entry`}
                                    >
                                        {busyId === entry.id ? "…" : "?"}
                                    </button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>

            <p className="notes-footnote">{t("FieldNotesUnlockLine")}</p>

            {ownsKit ? (
                <p className="notes-footnote">{t("NudgeKit")}</p>
            ) : nudges.adRemainingToday !== null && kitOfferUnlocked() ? (
                <button type="button" className="buy-button" onClick={openKit}>
                    {t("KitTitle")}
                </button>
            ) : null}
        </Panel>
    );
}
