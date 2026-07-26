/**
 * Nudges.
 *
 * A nudge reveals the marginal note next to one still-unfound secret. It never
 * gives a recipe — it names the inks and leaves the arrangement to the player,
 * because a game about finding things out cannot sell the finding out.
 *
 * Where a nudge comes from, in the order the game tries:
 *   1. one free every day, for everybody;
 *   2. one more for keeping today's prompt;
 *   3. a rewarded video, up to three a day, always player-initiated;
 *   4. no limit at all, with the Illuminator's Kit.
 */
import { DISCOVERIES } from "../game/sim/discoveries.ts";
import { store } from "../state/store.ts";
import { saveSystem } from "./save.ts";
import { runtimeServices } from "./runtimeServices.ts";
import { inkAudio } from "../audio/inkAudio.ts";
import { nudgeAvailability, watchForNudge, type NudgeResult } from "./monetization.ts";
import { localDayKey, serverNow } from "./serverTime.ts";

export type NudgeSource = "free" | "prompt" | "kit" | "ad";

export interface NudgeOffer {
    /** A nudge can be spent right now without watching anything. */
    freeReady: boolean;
    /** Where a free nudge would come from, for the button's label. */
    freeSource: Exclude<NudgeSource, "ad"> | null;
    /** The rewarded control's state. */
    adVisible: boolean;
    adReady: boolean;
    adReason: string;
    adRemainingToday: number | null;
}

/** A nudge banked by keeping the daily prompt, spendable once. */
let promptNudgeBanked = false;

export function bankPromptNudge(): void {
    promptNudgeBanked = true;
}

export function hasUnrevealed(): boolean {
    const state = store.get();
    return DISCOVERIES.some(
        (entry) => !state.discoveries.includes(entry.id) && !state.revealedHints.includes(entry.id),
    );
}

export function offer(): NudgeOffer {
    const state = store.get();
    const availability = nudgeAvailability();

    let freeSource: Exclude<NudgeSource, "ad"> | null = null;
    if (state.ownsKit) freeSource = "kit";
    else if (!state.freeHintUsed) freeSource = "free";
    else if (promptNudgeBanked) freeSource = "prompt";

    return {
        freeReady: freeSource !== null && hasUnrevealed(),
        freeSource,
        adVisible: !state.ownsKit && availability.visible && hasUnrevealed(),
        adReady: availability.ready && hasUnrevealed(),
        adReason: availability.reason,
        adRemainingToday: availability.remainingToday,
    };
}

/** Spend a nudge the player already has. Returns false when there is none. */
export async function spendFreeNudge(discoveryId: string): Promise<boolean> {
    const state = store.get();
    if (state.discoveries.includes(discoveryId) || state.revealedHints.includes(discoveryId)) return false;

    const source = offer().freeSource;
    if (source === null) return false;

    const patch: Parameters<typeof store.patch>[0] = {
        revealedHints: [...state.revealedHints, discoveryId],
    };
    if (source === "free") {
        patch.freeHintUsed = true;
        patch.hintDay = localDayKey(serverNow());
    }
    if (source === "prompt") promptNudgeBanked = false;

    store.patch(patch);
    inkAudio.play("reward");
    void runtimeServices.haptic("light");
    runtimeServices.track("nudge_spent", { discovery_id: discoveryId, source });
    await saveSystem.flush();
    return true;
}

/** Watch a rewarded video, then reveal the note if the host confirms it played. */
export async function watchNudge(discoveryId: string): Promise<NudgeResult> {
    const state = store.get();
    if (state.discoveries.includes(discoveryId) || state.revealedHints.includes(discoveryId)) return "unavailable";

    const result = await watchForNudge();
    if (result !== "granted") return result;

    const current = store.get();
    store.patch({ revealedHints: [...current.revealedHints, discoveryId] });
    inkAudio.play("reward");
    void runtimeServices.haptic("success");
    runtimeServices.track("nudge_spent", { discovery_id: discoveryId, source: "ad" });
    await saveSystem.flush();
    return "granted";
}

export function isRevealed(discoveryId: string): boolean {
    return store.get().revealedHints.includes(discoveryId);
}
