/**
 * The record — four numbers, none of them a score to beat.
 *
 * Sheets used and marks made are here because in a sandbox they are the honest
 * measure of time spent, and seeing them climb is quietly satisfying in a way
 * a leaderboard rank is not.
 */
import { DISCOVERY_COUNT } from "../game/sim/discoveries.ts";
import { useStore } from "../state/store.ts";
import { t } from "../systems/localization.ts";
import Panel from "./Panel.tsx";

export default function RecordScreen({ onClose }: { onClose: () => void }) {
    const state = useStore((value) => value);
    const entries: Array<[string, string]> = [
        [t("StatsDiscoveries"), `${state.discoveryCount}/${DISCOVERY_COUNT}`],
        [t("StatsPagesTorn"), String(state.pagesTorn + 1)],
        [t("StatsStrokes"), state.strokes.toLocaleString()],
        [t("StatsStreak"), String(state.promptStreak)],
    ];
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
        </Panel>
    );
}
